"""File helpers Research Lab used from ``kiro_crew.owner_only_files``,
``kiro_crew.atomic_write`` and ``kiro_crew.sqlite_wal``.

Campaign files hold research findings, so they are created owner-only. The
gateway's own helpers are used whenever it has them: they also refuse to act
through a symlinked directory inside the data home and publish a new database
file with a hard link. On a gateway without them the restatements below keep
the part that matters for confidentiality, ``0700`` directories and ``0600``
files from creation (POSIX), and drop the rest; PORTING.md lists that as a gap.
Each fallback is never more permissive than the host's helper.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from . import _host

_IS_POSIX = sys.platform != "win32"
_DIR_MODE = 0o700
_FILE_MODE = 0o600


def _host_fn(module: str, name: str) -> Any | None:
    fn = _host._host_attr(module, name)
    return fn if callable(fn) else None


def mkdirs_owner_only(path: str | os.PathLike[str]) -> None:
    """``mkdir -p`` where every directory it creates is ``0700`` (POSIX)."""
    host = _host_fn("kiro_crew.owner_only_files", "mkdirs_owner_only")
    if host is not None:
        host(path)
        return
    if not _IS_POSIX:
        Path(path).mkdir(parents=True, exist_ok=True)
        return
    target = Path(os.path.abspath(os.fspath(path)))
    missing: list[Path] = []
    probe = target
    while not probe.exists() and probe != probe.parent:
        missing.append(probe)
        probe = probe.parent
    for directory in reversed(missing):
        try:
            os.mkdir(directory, _DIR_MODE)
        except FileExistsError:
            if not directory.is_dir():
                raise


def ensure_directory(path: str | os.PathLike[str]) -> None:
    """``mkdir -p``, owner-only inside the data home (the host decides where that is)."""
    host = _host_fn("kiro_crew.owner_only_files", "ensure_directory")
    if host is not None:
        host(path)
        return
    mkdirs_owner_only(path)


def write_text_owner_only_in_home(path: str | os.PathLike[str], text: str) -> None:
    """Write UTF-8 *text* to *path*, ``0600`` from creation (POSIX)."""
    host = _host_fn("kiro_crew.owner_only_files", "write_text_owner_only_in_home")
    if host is not None:
        host(path, text)
        return
    data = text.encode("utf-8")
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_BINARY", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(os.fspath(path), flags, _FILE_MODE)
    try:
        if _IS_POSIX:
            os.fchmod(fd, _FILE_MODE)
        view = memoryview(data)
        while view:
            written = os.write(fd, view)
            view = view[written:]
    finally:
        os.close(fd)


def prepare_owner_only_sqlite(db_path: str | os.PathLike[str]) -> None:
    """Make sure SQLite opens *db_path* as an owner-only file. Call before ``connect``."""
    host = _host_fn("kiro_crew.owner_only_files", "prepare_owner_only_sqlite")
    if host is not None:
        host(db_path)
        return
    if not _IS_POSIX:
        return
    path = os.fspath(db_path)
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, _FILE_MODE)
    except FileExistsError:
        pass
    else:
        os.close(fd)
    for suffix in ("", "-wal", "-shm", "-journal"):
        candidate = path + suffix
        try:
            if not os.path.islink(candidate) and os.path.isfile(candidate):
                os.chmod(candidate, _FILE_MODE)
        except OSError:
            continue


def enable_wal(conn: sqlite3.Connection, *, timeout_secs: float) -> str:
    """Put *conn*'s database in WAL mode, retrying a lock conflict until *timeout_secs*."""
    host = _host_fn("kiro_crew.sqlite_wal", "enable_wal")
    if host is not None:
        return host(conn, timeout_secs=timeout_secs)
    row = conn.execute("PRAGMA journal_mode").fetchone()
    if row is not None and str(row[0]).lower() == "wal":
        return "wal"
    deadline = time.monotonic() + timeout_secs
    wait = 0.05
    while True:
        try:
            row = conn.execute("PRAGMA journal_mode=WAL").fetchone()
        except sqlite3.OperationalError as exc:
            remaining = deadline - time.monotonic()
            if "locked" not in str(exc).lower() or remaining <= 0:
                raise
            time.sleep(min(wait, remaining))
            wait = min(wait * 2, 1.0)
            continue
        return str(row[0]).lower() if row is not None else "wal"


#: The files SQLite keeps beside a database, the host's list when it has one.
SQLITE_SIDECAR_SUFFIXES: tuple[str, ...] = tuple(
    _host._host_attr("kiro_crew.owner_only_files", "SQLITE_SIDECAR_SUFFIXES")
    or ("-wal", "-shm", "-journal")
)


def atomic_write(path: Path | str, content: str) -> None:
    """Replace *path* with UTF-8 *content* through a uniquely named temp file.

    The unique name keeps two writers of one file from sharing a staging file.
    The host's helper also retries the rename through the Windows
    sharing-violation window; the restatement renames once.
    """
    host = _host_fn("kiro_crew.atomic_write", "atomic_write")
    if host is not None:
        host(path, content)
        return
    target = Path(path)
    fd, tmp = tempfile.mkstemp(dir=target.parent, prefix=f".{target.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(content)
        os.replace(tmp, target)
    except BaseException:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise


def read_json_or(path: Path | str, default: Any, *, logger: logging.Logger, what: str) -> Any:
    """``json.loads`` a small file, or *default*: silently when absent or malformed,
    with one warning (no path, no content) on any other read failure."""
    host = _host_fn("kiro_crew.atomic_write", "read_json_or")
    if host is not None:
        return host(path, default, logger=logger, what=what)
    try:
        raw = Path(path).read_bytes()
    except FileNotFoundError:
        return default
    except OSError as exc:
        logger.warning("%s read degraded (%s); using the default", what, type(exc).__name__)
        return default
    try:
        return json.loads(raw.decode("utf-8"))
    except ValueError:
        return default
