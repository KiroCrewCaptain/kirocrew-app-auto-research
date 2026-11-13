"""Where Research Lab meets the gateway: the App Kit seams and what happens without them.

The built-in imported its collaborators straight from Kiro Crew; this copy reads
the public seams off its hook context (``ctx.scrub``, ``ctx.audit``,
``ctx.lifecycle``, ``ctx.http_app``, ``ctx.health``, ``ctx.sdk_level``) and
resolves the services that have no seam yet by name, in ``backend/_host.py``.
Each case below pins one of those touch points, and above all its fallback:
never more permissive than the host. Text is masked when there is no scrubber, a
campaign stands down when the context has no lifecycle seam to say the app is
enabled, and agent mode launches no worker without the gateway's AutoNudge
service.

Also here, because they are new in the external copy: the registration of the
app's answer to core's stopped-loop seam, the suspension of research loops in
``on_shutdown``, and the ``GET /models`` route. The campaigns database's
location and its one-time copy are ``test_auto_research_db_location.py``.
"""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from aiohttp import web
from aiohttp.test_utils import make_mocked_request

from backend import _compat, _host
from backend import handlers as h
from backend.campaign import agent_mode, storage, untrusted
from harness import FakeCtx, make_ctx

_SECRET = "token ghp_abcdefghijklmnopqrstuvwxyz0123456789AB here"


def _authed(method: str, path: str, *, app: web.Application | None = None) -> web.Request:
    req = make_mocked_request(method, path, app=app or web.Application())
    req["user"] = "test-user"
    return req


def _without(monkeypatch: pytest.MonkeyPatch, *missing: tuple[str, str]) -> None:
    """Model a gateway that does not provide each ``(module, name)``."""
    real = _host._host_attr
    gone = set(missing)

    def _attr(module: str, name: str) -> Any:
        return None if (module, name) in gone else real(module, name)

    monkeypatch.setattr(_host, "_host_attr", _attr)


# ── health: what an older or partial gateway is told ───────────────────────


class TestCapabilityReport:
    def test_a_full_level_2_host_reports_nothing(self, bound_ctx: FakeCtx) -> None:
        bound_ctx.http_app = web.Application()
        assert _host.capability_issues(bound_ctx) == []

    def test_each_missing_seam_is_named_with_its_consequence(
        self, bound_ctx: FakeCtx, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _without(monkeypatch, ("kiro_crew.autonudge", "get_instance"), ("kiro_crew.artifacts", "ArtifactStore"))
        ctx = FakeCtx(data_dir=bound_ctx.data_dir, sdk_level=0, scrub=None, http_app=None)
        issues = _host.capability_issues(ctx)
        assert any("App Kit level 0" in i for i in issues)
        assert any("findings are masked" in i for i in issues)
        assert any("not watched" in i for i in issues)
        assert any("agent-mode campaigns cannot run" in i for i in issues)
        assert any("report export is refused" in i for i in issues)
        assert any("campaigns stand down" in i for i in issues)

    def test_register_routes_reports_through_ctx_health(self, bound_ctx: FakeCtx) -> None:
        ctx = FakeCtx(data_dir=bound_ctx.data_dir, sdk_level=0, scrub=None)
        records = h.register_routes(ctx)
        assert len(records) == len(h.ROUTES)
        assert ctx.health.status == "degraded"
        assert ctx.health.issues == _host.capability_issues(ctx)

    def test_a_bool_is_not_a_seam_level(self) -> None:
        assert _host.sdk_level(SimpleNamespace(sdk_level=True)) == 0
        assert _host.sdk_level(SimpleNamespace()) == 0
        assert _host.sdk_level(SimpleNamespace(sdk_level=1)) == 1


# ── redaction (ctx.scrub) ───────────────────────────────────────────────────


class TestRedaction:
    def test_the_hosts_scrubber_redacts_a_credential(self) -> None:
        out = untrusted._redact_finding({"summary": _SECRET, "n": 3})
        assert "ghp_" not in out["summary"]
        assert out["n"] == 3

    def test_no_bound_context_masks_every_string(self) -> None:
        _host.unbind()
        out = untrusted._redact_finding({"summary": "plain words", "nested": ["a", {"b": "c"}]})
        assert out == {"summary": "[REDACTED]", "nested": ["[REDACTED]", {"b": "[REDACTED]"}]}

    def test_a_context_without_a_scrubber_masks_every_string(self, bound_ctx: FakeCtx) -> None:
        bound_ctx.scrub = None
        assert untrusted._redact_finding({"v": "plain"}) == {"v": "[REDACTED]"}

    def test_a_scrubber_that_raises_masks_instead_of_leaking(self, bound_ctx: FakeCtx) -> None:
        class _Broken:
            def outbound(self, text: str) -> Any:
                raise RuntimeError("companion did not compose")

        bound_ctx.scrub = _Broken()
        assert untrusted._redact_finding({"v": _SECRET}) == {"v": "[REDACTED]"}

    def test_a_scrubber_returning_no_text_masks(self, bound_ctx: FakeCtx) -> None:
        bound_ctx.scrub = SimpleNamespace(outbound=lambda text: SimpleNamespace(text=None))
        assert untrusted._redact_finding({"v": "x"}) == {"v": "[REDACTED]"}

    def test_the_tree_and_campaign_readers_share_the_fail_closed_path(self, bound_ctx: FakeCtx) -> None:
        bound_ctx.scrub = None
        assert untrusted._redact_tree_node("x") == "[REDACTED]"
        assert storage._redact_campaign({"name": "n", "question": "q"})["name"] == "[REDACTED]"


# ── audit (ctx.audit) ───────────────────────────────────────────────────────


class TestAudit:
    def test_rows_go_to_ctx_audit_with_the_extras_in_resources(self, bound_ctx: FakeCtx) -> None:
        rows: list[tuple] = []
        bound_ctx.audit = SimpleNamespace(record=lambda *a, **k: rows.append((a, k)))
        h._audit("campaign_forked", "abcd1234", parent="00ff00ff")
        assert rows == [(("campaign_forked", "success"), {"resources": "abcd1234 parent=00ff00ff"})]

    def test_no_audit_seam_is_a_warning_never_a_failure(
        self, bound_ctx: FakeCtx, caplog: pytest.LogCaptureFixture
    ) -> None:
        bound_ctx.audit = None
        with caplog.at_level(logging.WARNING, logger="kirocrew.app.auto-research"):
            h._audit("campaign_list", "*")
        assert "SEL audit failed for campaign_list" in caplog.text


# ── the data home and the database location ─────────────────────────────────


class TestDataLocation:
    def test_the_data_home_comes_from_the_contexts_data_dir(self, bound_ctx: FakeCtx) -> None:
        assert _host.data_home() == bound_ctx.data_dir.parents[2]

    @pytest.mark.parametrize(
        "data_dir",
        ["elsewhere/data", "apps/other-app/data", "apps/auto-research/state"],
    )
    def test_an_unexpected_layout_is_refused_not_guessed(self, tmp_path: Path, data_dir: str) -> None:
        _host.bind(FakeCtx(data_dir=tmp_path / data_dir))
        with pytest.raises(_host.HostCapabilityMissing):
            _host.data_home()

    def test_no_bound_context_has_no_data_home(self) -> None:
        _host.unbind()
        with pytest.raises(_host.HostCapabilityMissing):
            _host.data_home()
        with pytest.raises(_host.HostCapabilityMissing):
            _host.app_data_dir()

    def test_the_database_lives_in_the_data_dir_and_campaigns_where_the_agent_writes(
        self, bound_ctx: FakeCtx, _isolated_home: Path
    ) -> None:
        assert storage.db_path() == bound_ctx.data_dir / "campaigns.db"
        assert storage.legacy_db_path() == _isolated_home / "apps" / "auto-research" / "campaigns.db"
        assert storage.research_dir() == _isolated_home / "workspace" / "research"


# ── core's stopped-loop seam ────────────────────────────────────────────────


@pytest.fixture
def seam_registry(monkeypatch: pytest.MonkeyPatch):
    """Core's seam registry, restored afterwards (it is process-global)."""
    from kiro_crew.apps import seams as core_seams

    core_seams.provider(core_seams.SEAM_STOPPED_LOOP_TOMBSTONE)  # load the builtin providers first
    monkeypatch.setattr(core_seams, "_providers", dict(core_seams._providers))
    return core_seams


class TestStoppedLoopSeam:
    @pytest.mark.asyncio
    async def test_on_startup_answers_the_seam_for_this_apps_worker_slots(
        self, bound_ctx: FakeCtx, seam_registry: Any
    ) -> None:
        from backend import seams

        await h.on_startup(bound_ctx)
        try:
            provider = seam_registry.stopped_loop_tombstone()
            assert isinstance(provider, seams.StoppedLoopTombstone)
            assert provider.keeps_stopped_loop("research-abcd1234", "auto-research") is True
            # A person's slot named the same way, or another app's, keeps nothing.
            assert provider.keeps_stopped_loop("research-abcd1234", "") is False
            assert provider.keeps_stopped_loop("research-abcd1234", "other-app") is False
            assert provider.keeps_stopped_loop("research-xyz", "auto-research") is False
        finally:
            await h.on_shutdown(bound_ctx)
        # It keeps answering once the app is off, as the built-in's did.
        assert isinstance(seam_registry.stopped_loop_tombstone(), seams.StoppedLoopTombstone)

    def test_a_gateway_without_the_seam_registers_nothing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from backend import seams

        _without(monkeypatch, ("kiro_crew.apps.seams", "register"))
        assert seams.register() is False

    def test_a_seam_another_app_holds_is_left_to_it(
        self, seam_registry: Any, caplog: pytest.LogCaptureFixture
    ) -> None:
        from backend import seams

        held = object()
        seam_registry._providers[seam_registry.SEAM_STOPPED_LOOP_TOMBSTONE] = ("other-app", held)
        with caplog.at_level(logging.WARNING, logger="kirocrew.app.auto-research"):
            assert seams.register() is False
        assert seam_registry.stopped_loop_tombstone() is held
        assert "another app holds" in caplog.text


# ── services without a seam ─────────────────────────────────────────────────


class TestServicesWithoutASeam:
    def test_no_autonudge_service_launches_no_worker(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        _without(monkeypatch, ("kiro_crew.autonudge", "get_instance"))
        assert _host.autonudge_instance() is None

    @pytest.mark.asyncio
    async def test_agent_mode_without_autonudge_logs_and_creates_no_slot(
        self, _isolate: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        monkeypatch.setattr(h, "_autonudge_instance", lambda: None)
        cid = h.create_campaign({"question": "A question long enough to start with"})["id"]
        created: list[Any] = []
        state = SimpleNamespace(get_or_create_slot=lambda **kw: created.append(kw))
        app = web.Application()
        app["state"] = state
        with caplog.at_level(logging.WARNING, logger="kirocrew.app.auto-research"):
            await agent_mode._launch_loop(_authed("PATCH", "/x", app=app), cid)
        assert created == []
        assert "autonudge/state unavailable" in caplog.text

    def test_a_context_without_the_lifecycle_seam_reads_as_disabled(self, bound_ctx: FakeCtx) -> None:
        bound_ctx.lifecycle = None
        assert _host.is_app_enabled("auto-research") is False
        _host.unbind()
        assert _host.is_app_enabled("auto-research") is False

    def test_the_enabled_switch_is_the_lifecycle_seams_answer(self, bound_ctx: FakeCtx) -> None:
        answers = iter([True, False])
        bound_ctx.lifecycle = SimpleNamespace(is_enabled=lambda: next(answers))
        assert _host.is_app_enabled("auto-research") is True
        assert _host.is_app_enabled("auto-research") is False

    def test_another_apps_name_is_never_answered(self, bound_ctx: FakeCtx) -> None:
        bound_ctx.lifecycle = SimpleNamespace(is_enabled=lambda: True)
        assert _host.is_app_enabled("other-app") is False

    def test_the_hosts_seam_reads_the_install_record(self, bound_ctx: FakeCtx) -> None:
        """The real ``AppLifecycleSDK``: no install record in a test home is "off"."""
        from kiro_crew.apps.lifecycle_sdk import AppLifecycleSDK

        assert isinstance(bound_ctx.lifecycle, AppLifecycleSDK)
        assert bound_ctx.lifecycle.app_name == "auto-research"
        assert _host.is_app_enabled("auto-research") is False

    def test_the_switch_is_never_read_from_the_private_manager(
        self, bound_ctx: FakeCtx, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        asked: list[tuple[str, str]] = []
        real = _host._host_attr
        monkeypatch.setattr(_host, "_host_attr", lambda m, n: asked.append((m, n)) or real(m, n))
        bound_ctx.lifecycle = SimpleNamespace(is_enabled=lambda: True)
        assert _host.is_app_enabled("auto-research") is True
        _host.capability_issues(bound_ctx)
        assert [a for a in asked if a[0] == "kiro_crew.apps.manager"] == []

    def test_trust_is_revoked_by_the_hosts_rule(self) -> None:
        from kiro_crew.dashboard import chat_utils_slots

        assert _host._host_attr(
            "kiro_crew.dashboard.chat_utils_slots", "revoke_slot_trust"
        ) is chat_utils_slots.revoke_slot_trust

    def test_without_the_hosts_rule_the_trust_flag_is_still_cleared(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _without(monkeypatch, ("kiro_crew.dashboard.chat_utils_slots", "revoke_slot_trust"))
        slot = SimpleNamespace(key="research-abcd1234", _trust=True)
        _host.revoke_slot_trust(SimpleNamespace(_slots={}), slot)
        assert slot._trust is False

    def test_a_worker_grant_stores_the_policy_on_the_hosts_session_key(self) -> None:
        from kiro_crew.dashboard import chat_utils_slots

        from backend.campaign import agent_mode

        assert _host._host_attr(
            "kiro_crew.dashboard.chat_utils_slots", "effective_session_key"
        ) is chat_utils_slots.effective_session_key
        stored: list[tuple[str, str]] = []
        state = SimpleNamespace(
            sessions=SimpleNamespace(set_approval_policy=lambda k, p: stored.append((k, p)))
        )
        slot = SimpleNamespace(key="research-abcd1234", linked_session_key="", _trust=False)
        agent_mode.grant_worker_trust(state, slot.key, slot)
        assert slot._trust is True
        assert stored == [(chat_utils_slots.effective_session_key(slot), "auto")]
        agent_mode._held_worker_trust.pop(slot.key, None)

    def test_without_the_hosts_session_key_a_grant_stores_no_policy(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from backend.campaign import agent_mode

        _without(monkeypatch, ("kiro_crew.dashboard.chat_utils_slots", "effective_session_key"))
        stored: list[tuple[str, str]] = []
        state = SimpleNamespace(
            sessions=SimpleNamespace(set_approval_policy=lambda k, p: stored.append((k, p)))
        )
        slot = SimpleNamespace(key="research-abcd1234", _trust=False)
        agent_mode.grant_worker_trust(state, slot.key, slot)
        assert slot._trust is True and stored == []
        agent_mode._held_worker_trust.pop(slot.key, None)

    def test_the_pending_reason_is_the_knowledge_stores(self) -> None:
        from kiro_crew.knowledge import store

        assert _host.PENDING_REASON_PROP == store.PENDING_REASON_PROP
        assert _host.PENDING_REASON_IMPORT_BUDGET == store.PENDING_REASON_IMPORT_BUDGET

    def test_slot_history_key_without_the_host_rule_is_refused(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _without(monkeypatch, ("kiro_crew.dashboard.chat_utils", "slot_history_key"))
        with pytest.raises(_host.HostCapabilityMissing):
            _host.slot_history_key(SimpleNamespace(key="research-abcd1234"))

    def test_the_sleep_aware_clock_is_the_hosts_and_falls_back_to_monotonic(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from kiro_crew import platform_compat

        assert _compat.awake_now is _host.awake_now
        monkeypatch.setattr(platform_compat, "awake_now", lambda: 12345.0)
        assert _host.awake_now() == 12345.0
        _without(monkeypatch, ("kiro_crew.platform_compat", "awake_now"))
        assert isinstance(_host.awake_now(), float)

    def test_stop_reason_constants_are_the_hosts(self) -> None:
        from kiro_crew import autonudge

        assert agent_mode.AUTONUDGE_STOP_REASON == autonudge.AUTONUDGE_STOP_REASON
        assert agent_mode.FAILURE_STANDDOWN_REASONS == {
            autonudge.CONSECUTIVE_FAILURE_REASON,
            autonudge.SESSION_START_FAILURE_REASON,
        }


@pytest.fixture
def _isolate(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(h, "DB_PATH", tmp_path / "t.db")
    monkeypatch.setattr(h, "RESEARCH_DIR", tmp_path / "r")
    return tmp_path


# ── lifecycle hooks ─────────────────────────────────────────────────────────


class TestShutdownSuspendsResearchLoops:
    @pytest.mark.asyncio
    async def test_on_shutdown_deactivates_every_research_loop_and_clears_trust(
        self, tmp_path: Path, bound_ctx: FakeCtx, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Disable runs this BEFORE the enabled flag flips, so it cannot wait for
        the watchdog's disabled branch: the watchdog is the thing it stops."""
        from kiro_crew.autonudge import AutoNudgeService

        svc = AutoNudgeService(base_dir=tmp_path / "autonudge")
        await svc.start()
        try:
            await svc.add(slot_key="research-abcd1234", message="go", idle_secs=60)
            await svc.add(slot_key="user-chat", message="hi", idle_secs=60)
            slot = SimpleNamespace(_trust=True)
            app = web.Application()
            app["state"] = SimpleNamespace(_slots={"research-abcd1234": slot})
            bound_ctx.http_app = app
            monkeypatch.setattr(h, "_autonudge_instance", lambda: svc)

            await h.on_shutdown(bound_ctx)

            assert svc.get_by_slot("research-abcd1234").active is False
            # Not a reason the watchdog settles a campaign on, so its next poll
            # after a start re-arms the loop (the built-in's disabled path too).
            reason = str(getattr(svc.get_by_slot("research-abcd1234"), "stopped_reason", "") or "")
            assert reason != agent_mode.AUTONUDGE_STOP_REASON
            assert reason not in agent_mode.FAILURE_STANDDOWN_REASONS
            assert svc.get_by_slot("user-chat").active is True
            assert slot._trust is False
        finally:
            svc.stop()

    @pytest.mark.asyncio
    async def test_on_shutdown_without_the_gateway_application_still_stops(
        self, bound_ctx: FakeCtx, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(h, "_autonudge_instance", lambda: None)
        bound_ctx.http_app = None
        await h.on_shutdown(bound_ctx)
        assert h._watchdog_task is None


# ── GET /models ─────────────────────────────────────────────────────────────


class TestModelsRoute:
    @pytest.mark.asyncio
    async def test_answers_with_the_hosts_own_handler(self, monkeypatch: pytest.MonkeyPatch) -> None:
        seen: list[web.Request] = []

        async def _api_models(request: web.Request) -> web.Response:
            seen.append(request)
            return web.json_response([{"name": "auto"}, {"name": "model-x"}])

        monkeypatch.setattr(_host, "models_handler", lambda: _api_models)
        req = _authed("GET", "/api/apps/auto-research/models?backend=kiro")
        resp = await h._handle_models(req)
        assert json.loads(resp.body) == [{"name": "auto"}, {"name": "model-x"}]
        assert seen == [req]

    @pytest.mark.asyncio
    async def test_without_the_host_handler_only_the_default_is_offered(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(_host, "models_handler", lambda: None)
        resp = await h._handle_models(_authed("GET", "/api/apps/auto-research/models"))
        assert json.loads(resp.body) == [{"name": "auto", "description": ""}]

    @pytest.mark.asyncio
    async def test_unauthenticated_is_refused_before_the_host_is_asked(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def _never() -> None:
            raise AssertionError("host asked for an unauthenticated caller")

        monkeypatch.setattr(_host, "models_handler", _never)
        resp = await h._handle_models(make_mocked_request("GET", "/api/apps/auto-research/models"))
        assert resp.status == 401

    def test_the_host_handler_is_the_dashboards(self) -> None:
        from kiro_crew.dashboard import handlers as dashboard_handlers

        assert _host.models_handler() is dashboard_handlers.api_models


def test_make_ctx_matches_the_gateways_data_dir_shape(tmp_path: Path) -> None:
    ctx = make_ctx(tmp_path)
    assert ctx.data_dir == tmp_path / "apps" / "auto-research" / "data"


@pytest.mark.asyncio
async def test_an_import_budget_deferral_parks_the_source_pending_with_its_reason(
    tmp_path: Path,
) -> None:
    """The Sources list says why a source waits: the reason rides in the same take."""
    from kiro_crew.knowledge.store import KnowledgeStore

    from backend.campaign import publication

    uri = str(tmp_path / "findings.md")
    store = KnowledgeStore(str(tmp_path / "knowledge.db"))
    try:
        sid = await asyncio.to_thread(store.add_source, "findings", "file", uri)

        class _Pipeline:
            async def ingest_file(self, uri: str, *, source_id: str) -> None:
                raise _host.ImportChunkBudgetError(10, 60.0, 10)

        await publication._ingest_findings(_Pipeline(), store, uri, sid, "abcd1234")
        source = await asyncio.to_thread(store.get_source_by_uri, uri)
        assert source["sync_status"] == "pending"
        props = source["properties"]
        props = json.loads(props) if isinstance(props, str) else props
        assert props[_host.PENDING_REASON_PROP] == _host.PENDING_REASON_IMPORT_BUDGET
    finally:
        store.close()
