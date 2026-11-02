"""Campaign files are owner-only from creation: with the host's helpers and without.

Ported from the two Research Lab cases of Kiro Crew's
``test/test_owner_only_files.py`` (the campaigns database and the campaign
directory), plus the same checks on a gateway without the owner-only helpers,
where ``backend/_fs.py``'s restatements must be no more permissive.
"""

from __future__ import annotations

import os
import stat
import sys
from pathlib import Path

import pytest

from backend import _fs, _host
from backend.campaign import storage

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="POSIX permission bits")


def _mode(path: Path | str) -> int:
    return stat.S_IMODE(os.lstat(path).st_mode)


def _readable_by_others(root: Path) -> list[str]:
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        for name in dirnames + filenames:
            path = Path(dirpath, name)
            st = os.lstat(path)
            if stat.S_ISLNK(st.st_mode):
                continue
            if stat.S_IMODE(st.st_mode) & 0o077:
                found.append(f"{oct(stat.S_IMODE(st.st_mode))} {path.relative_to(root)}")
    return found


@pytest.fixture(params=["host helpers", "no host helpers"])
def helpers(request, monkeypatch: pytest.MonkeyPatch) -> str:
    if request.param == "no host helpers":
        real = _host._host_attr

        def _without_file_helpers(module: str, name: str):
            if module in {"kiro_crew.owner_only_files", "kiro_crew.sqlite_wal", "kiro_crew.atomic_write"}:
                return None
            return real(module, name)

        monkeypatch.setattr(_host, "_host_attr", _without_file_helpers)
    return request.param


@pytest.fixture
def home(_isolated_home: Path):
    """The data home, under a umask that would leave new files group/other-readable."""
    previous = os.umask(0o022)
    try:
        _isolated_home.mkdir(parents=True, exist_ok=True, mode=0o700)
        yield _isolated_home
    finally:
        os.umask(previous)


def test_the_research_campaign_store_is_owner_only(home: Path, helpers: str) -> None:
    conn = storage._get_db()
    try:
        assert storage.db_path() == home / "apps" / "auto-research" / "data" / "campaigns.db"
        assert storage.db_path().is_file()
        assert _readable_by_others(home) == []
    finally:
        conn.close()


def test_research_campaign_files_are_owner_only(home: Path, helpers: str) -> None:
    campaign = "abcd1234"
    storage.write_status(campaign, "running")
    storage.write_guidance(campaign, "focus on X")
    directory = storage.research_dir() / campaign
    storage._write_new_cycle_files([(directory / "findings" / "cycle_001.json", "{}")])

    assert storage.research_dir() == home / "workspace" / "research"
    assert _mode(directory / "status.json") == 0o600
    assert _mode(directory / "guidance.txt") == 0o600
    assert _readable_by_others(storage.research_dir()) == []


def test_the_fallback_writer_refuses_a_symlink_at_the_name(tmp_path: Path, helpers: str) -> None:
    if helpers != "no host helpers":
        pytest.skip("the host's writer has its own tests")
    target = tmp_path / "elsewhere.txt"
    target.write_text("keep", encoding="utf-8")
    link = tmp_path / "status.json"
    link.symlink_to(target)
    with pytest.raises(OSError):
        _fs.write_text_owner_only_in_home(link, "overwrite")
    assert target.read_text(encoding="utf-8") == "keep"
