"""Small platform helpers Research Lab used from ``kiro_crew.platform_compat``.

Restated because they are a few lines each and carry no policy of their own;
the clock is the gateway's own when it has one (see ``_host.awake_now``).
Bound in ``campaign/watchdog.py`` as ``platform_compat``, the built-in's name,
so a test that stands in for the clock patches it the same way.
"""

from __future__ import annotations

import os

from . import _host

_isjunction = getattr(os.path, "isjunction", None)  # Python 3.12+


def _is_junction(path: str | os.PathLike) -> bool:
    if _isjunction is None:
        return False
    try:
        return bool(_isjunction(path))
    except (OSError, ValueError):
        return False


def is_link_or_junction(path: str | os.PathLike) -> bool:
    """True if *path* is a symlink OR (on Windows) a directory junction.

    ``os.path.islink`` is False for a junction, so a caller that only checked it
    would treat a junction as a real directory and remove THROUGH it.
    """
    return os.path.islink(path) or _is_junction(path)


def unlink_link_or_junction(path: str | os.PathLike) -> None:
    """Remove a symlink or a directory junction without touching its target."""
    if os.path.islink(path):
        os.unlink(path)
        return
    if _is_junction(path):
        os.rmdir(path)
        return
    os.unlink(path)


#: Now, on a clock that stands still while the host is suspended (the host's own).
awake_now = _host.awake_now
