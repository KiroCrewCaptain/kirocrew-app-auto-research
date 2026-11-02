"""Which thread the artifact store's calls run on, for Research Lab's report export.

Ported from the two Research Lab cases of Kiro Crew's
``test/test_artifacts_store_off_loop.py`` (the dashboard-handler cases stay in
Kiro Crew). The artifact store syncs each file to the device under its single
lock, so a call on the gateway loop stalls chat turns for as long as the device
takes, and even a read can write: ``get`` persists a backfilled event history
for an artifact saved before event logs existed.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from backend import handlers as research_handlers
from backend.campaign import publication
from kiro_crew.artifacts import ArtifactStore

WATCHED = ("get", "list_versions", "create", "update")


@pytest.fixture
def threads(monkeypatch) -> dict[str, list[int]]:
    """Record the thread ident of every watched artifact-store call."""
    seen: dict[str, list[int]] = {}
    for name in WATCHED:
        original = getattr(ArtifactStore, name)

        def _wrapper(self, *args, _name=name, _orig=original, **kwargs):
            seen.setdefault(_name, []).append(threading.get_ident())
            return _orig(self, *args, **kwargs)

        monkeypatch.setattr(ArtifactStore, name, _wrapper)
    return seen


def _request(*, match: dict | None = None) -> MagicMock:
    req = MagicMock()
    req.headers = {}
    req.match_info = match or {}
    req.query = {}
    req.read = AsyncMock(return_value=b"")
    req.app = {"state": MagicMock()}
    return req


def _assert_off_loop(seen: dict[str, list[int]], *expected: str) -> None:
    loop_thread = threading.get_ident()
    assert set(expected) <= set(seen), f"expected {expected} to be called, saw {sorted(seen)}"
    on_loop = {
        name: idents for name, idents in seen.items() if any(i == loop_thread for i in idents)
    }
    assert not on_loop, f"artifact-store calls ran on the event loop thread: {sorted(on_loop)}"


@pytest.mark.asyncio
async def test_the_report_export_store_phase_runs_off_loop(
    tmp_path: Path, monkeypatch, threads
) -> None:
    """The report export reaches the store from the app's own async code, and the
    report HTML is as large as the campaign made it."""
    monkeypatch.setattr(
        publication, "ArtifactStore", lambda: ArtifactStore(root=tmp_path / "exported")
    )
    # The slug persist writes the campaigns DB and has its own off-loop tests;
    # stubbing it keeps this one about the store phase.
    monkeypatch.setattr(publication, "_persist_report_slug", lambda *a, **k: None)
    threads.clear()

    art, name, regenerated = await publication._publish_report_artifact(
        "c-1", "Does it sync?", "<p>report</p>", None
    )

    assert art.slug and name.startswith("Research:") and not regenerated
    _assert_off_loop(threads, "create")


@pytest.mark.asyncio
async def test_the_report_status_probe_runs_off_loop(tmp_path: Path, monkeypatch, threads) -> None:
    """A read-only status GET whose existence probe calls ``get``, which can
    persist a backfilled history: driven through the handler, so the handler's
    own offload is what is judged."""
    probe_store = ArtifactStore(root=tmp_path / "probed")
    art = probe_store.create(name="Report", kind="html", content="<p>r</p>")
    monkeypatch.setattr(publication, "ArtifactStore", lambda: probe_store)
    monkeypatch.setattr(
        publication,
        "_read_report_slug",
        lambda cid: {"report_artifact_slug": art.slug},
    )
    req = _request(match={"id": "a1b2c3d4"})
    # The handler trusts only the middleware-set user, never a raw token.
    req.get = lambda key, default=None: {"user": "tester"}.get(key, default)
    threads.clear()

    resp = await research_handlers._handle_report_status(req)

    assert json.loads(resp.text)["slug"] == art.slug
    _assert_off_loop(threads, "get")
