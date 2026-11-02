"""Test floor: the app root on ``sys.path``, an isolated data home, a bound context.

* The gateway loads hook files into a synthetic package named after the app, so
  the backend never needs to be on ``sys.path`` there. A plain pytest run has no
  such loader, so the app root is put on the path and ``backend`` imports as a
  package.
* Kiro Crew (a pinned test dependency, ``tests/requirements.txt``) is the host
  the backend resolves through ``backend/_host.py``. Its data home is pinned to a
  throwaway directory BEFORE anything imports it, and again per test, so no test
  reads or writes the operator's real ``~/.kiro/crew``.
* Every test runs with a context bound the way ``register_routes`` binds the
  gateway's: the host's own scrubber and audit sink, and a data directory under
  the test's ``tmp_path``. A test that models a gateway without one of them
  replaces it.
"""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
from pathlib import Path

import pytest

APP_ROOT = Path(__file__).resolve().parent.parent
TESTS = Path(__file__).resolve().parent
for entry in (str(APP_ROOT), str(TESTS)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

_SESSION_HOME = Path(tempfile.mkdtemp(prefix="kca-auto-research-home-"))
os.environ["KIROCREW_HOME"] = str(_SESSION_HOME / "crew")
os.environ["KIROCREW_WORKSPACE"] = str(_SESSION_HOME / "workspace")
os.environ.pop("KIROCREW_STRICT_ON_LOOP_PERSIST", None)


def pytest_unconfigure(config: pytest.Config) -> None:
    shutil.rmtree(_SESSION_HOME, ignore_errors=True)


def _can_create_symlink() -> bool:
    with tempfile.TemporaryDirectory() as tmp:
        target = os.path.join(tmp, "target")
        os.mkdir(target)
        try:
            os.symlink(target, os.path.join(tmp, "link"))
        except (OSError, NotImplementedError, AttributeError):
            return False
        return True


requires_symlinks = pytest.mark.skipif(
    not _can_create_symlink(),
    reason="creating a symlink needs SeCreateSymbolicLinkPrivilege on Windows",
)


@pytest.fixture(autouse=True)
def _isolated_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    home = tmp_path / "kirocrew-home"
    monkeypatch.setenv("KIROCREW_HOME", str(home))
    monkeypatch.setenv("KIROCREW_WORKSPACE", str(tmp_path / "kirocrew-workspace"))
    return home


class _InertLLMPool:
    """What ``on_startup`` builds in a test instead of the host's ``LLMPool``.

    The real pool spawns a model process on first use; no test may. ``send``
    answers ``""``, the empty reply every caller already falls back on.
    """

    def __init__(self, *args, **kwargs) -> None:
        self.closed = False

    async def send(self, prompt: str, timeout: float = 0) -> str:
        return ""

    async def shutdown(self) -> None:
        self.closed = True


@pytest.fixture(autouse=True)
def _no_real_llm_pool(monkeypatch: pytest.MonkeyPatch) -> None:
    from backend import handlers

    monkeypatch.setattr(handlers, "LLMPool", _InertLLMPool)
    monkeypatch.setattr(handlers, "_grill_llm_pool", None)


@pytest.fixture(autouse=True)
def bound_ctx(_isolated_home: Path):
    """The context ``register_routes`` would bind, for every test."""
    from backend import _host
    from harness import make_ctx

    ctx = make_ctx(_isolated_home)
    _host.bind(ctx)
    yield ctx
    _host.unbind()
