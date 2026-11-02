"""Where Research Lab meets the gateway: the App Kit seams and what happens without them.

The built-in imported its collaborators straight from Kiro Crew; this copy reads
the public seams off its hook context (``ctx.scrub``, ``ctx.audit``,
``ctx.http_app``, ``ctx.health``, ``ctx.sdk_level``) and resolves the services
that have no seam yet by name, in ``backend/_host.py``. Each case below pins
one of those touch points, and above all its fallback: never more permissive
than the host. Text is masked when there is no scrubber, a campaign stands down
when the gateway cannot say the app is enabled, and agent mode launches no
worker without the gateway's AutoNudge service.

Also here, because they are new in the external copy: the one-time copy of the
built-in's campaigns database into the app's data directory, the suspension of
research loops in ``on_shutdown``, and the ``GET /models`` route.
"""

from __future__ import annotations

import json
import logging
import sqlite3
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
    def test_a_full_level_1_host_reports_nothing(self, bound_ctx: FakeCtx) -> None:
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


def _legacy_db_with_rows(path: Path, *ids: str) -> None:
    """A built-in-era database: WAL mode, rows still in the -wal file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    keeper = sqlite3.connect(str(path))
    keeper.execute("PRAGMA journal_mode=WAL")
    keeper.execute("PRAGMA wal_autocheckpoint=0")
    # The table as the built-in's first release created it; later columns are
    # migrated in by the normal schema path.
    keeper.execute(
        """CREATE TABLE campaigns (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, question TEXT NOT NULL,
        sub_questions TEXT NOT NULL DEFAULT '[]', sources TEXT NOT NULL DEFAULT '[]',
        max_cycles INTEGER NOT NULL DEFAULT 30, idle_secs INTEGER NOT NULL DEFAULT 120,
        status TEXT NOT NULL DEFAULT 'ready',
        created_at REAL NOT NULL, started_at REAL, completed_at REAL,
        total_cycles INTEGER NOT NULL DEFAULT 0, error_message TEXT)"""
    )
    for cid in ids:
        keeper.execute(
            "INSERT INTO campaigns (id, name, question, created_at) VALUES (?, ?, ?, 0)",
            (cid, f"name {cid}", f"question {cid} long enough"),
        )
    keeper.commit()
    keeper.close()


@pytest.fixture
def live_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    """Resolve paths from the bound context, not the per-suite overrides."""
    monkeypatch.setattr(storage, "DB_PATH", None)
    monkeypatch.setattr(storage, "RESEARCH_DIR", None)
    monkeypatch.setattr(storage, "_MIGRATED_FOR", set())


@pytest.mark.usefixtures("live_paths")
class TestLegacyDatabaseCopy:
    def test_the_builtins_campaigns_are_copied_once_and_left_in_place(self, bound_ctx: FakeCtx) -> None:
        legacy = storage.legacy_db_path()
        _legacy_db_with_rows(legacy, "aaaa1111", "bbbb2222")
        legacy_bytes = legacy.read_bytes()

        conn = storage._get_db()
        try:
            ids = sorted(r["id"] for r in conn.execute("SELECT id FROM campaigns"))
        finally:
            conn.close()

        assert ids == ["aaaa1111", "bbbb2222"]
        assert storage.db_path().is_file()
        assert legacy.read_bytes() == legacy_bytes  # nothing of the built-in's file changed
        assert not storage.db_path().with_name("campaigns.db.migrating").exists()
        # A row the migrated schema needs is filled by the normal migration.
        assert {c["id"]: c for c in storage.list_campaigns()}["aaaa1111"]["status"] == "ready"

    def test_an_existing_database_is_never_overwritten(self, bound_ctx: FakeCtx) -> None:
        _legacy_db_with_rows(storage.legacy_db_path(), "aaaa1111")
        mine = h.create_campaign({"question": "A question asked after the move happened"})
        storage._MIGRATED_FOR.clear()
        _legacy_db_with_rows(storage.legacy_db_path().with_name("other.db"), "cccc3333")
        assert storage.migrate_legacy_db() is False
        assert [c["id"] for c in storage.list_campaigns()] in ([mine["id"], "aaaa1111"], ["aaaa1111", mine["id"]])

    def test_no_legacy_database_means_a_fresh_one(self, bound_ctx: FakeCtx) -> None:
        assert storage.migrate_legacy_db() is False
        assert storage.list_campaigns() == []

    def test_a_failed_copy_raises_and_creates_no_database(
        self, bound_ctx: FakeCtx, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _legacy_db_with_rows(storage.legacy_db_path(), "aaaa1111")

        def _broken() -> bool:
            raise sqlite3.OperationalError("disk I/O error")

        monkeypatch.setattr(storage, "migrate_legacy_db", _broken)
        with pytest.raises(sqlite3.OperationalError):
            storage._get_db()
        assert not storage.db_path().exists()
        monkeypatch.undo()
        monkeypatch.setattr(storage, "DB_PATH", None)
        monkeypatch.setattr(storage, "RESEARCH_DIR", None)
        # The next open retries and succeeds.
        assert [c["id"] for c in storage.list_campaigns()] == ["aaaa1111"]

    def test_a_symlinked_legacy_file_is_not_followed(self, bound_ctx: FakeCtx, tmp_path: Path) -> None:
        real = tmp_path / "somewhere" / "campaigns.db"
        _legacy_db_with_rows(real, "aaaa1111")
        legacy = storage.legacy_db_path()
        legacy.parent.mkdir(parents=True, exist_ok=True)
        try:
            legacy.symlink_to(real)
        except (OSError, NotImplementedError):
            pytest.skip("cannot create a symlink here")
        assert storage.migrate_legacy_db() is False


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

    def test_a_gateway_that_cannot_say_enabled_reads_as_disabled(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _without(monkeypatch, ("kiro_crew.apps.manager", "is_app_enabled"))
        assert _host.is_app_enabled("auto-research") is False

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
