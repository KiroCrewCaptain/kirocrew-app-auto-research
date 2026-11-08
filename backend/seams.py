"""Research Lab's provider for core's registration seams.

Core asks ``kiro_crew.apps.seams`` and never imports this app; an installed app
registers its providers itself, from ``on_startup``. A registration stays for the
life of the gateway process, so it keeps answering after the app is switched off,
as the built-in's did.
"""

from __future__ import annotations

from . import _host
from .session_keys import is_owned_research_slot


class StoppedLoopTombstone:
    """``kiro_crew.apps.seams.StoppedLoopTombstone``, from ``session_keys.py``.

    The watchdog reads the tombstone a stopped campaign worker leaves to tell a
    deliberate finish from an unreachable session. Only a canonical worker-slot key
    whose persisted provenance is this app keeps one.
    """

    def keeps_stopped_loop(self, slot_key: str, app_id: str) -> bool:
        return is_owned_research_slot(slot_key, app_id)


def register() -> bool:
    """Register every provider with the gateway; whether the gateway took them."""
    return _host.register_stopped_loop_tombstone(StoppedLoopTombstone())
