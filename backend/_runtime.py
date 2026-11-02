"""Process-wide state the three hook entry points share.

The gateway loads each ``backend.hooks`` entry (``routes``, ``on_startup``,
``on_shutdown``) with its own execution of ``handlers.py``, so a module-level
name there is a different object for each hook: a pool ``on_startup`` stored in
``handlers`` would be invisible to the route handlers. Sibling modules are
imported once and shared, so the state lives here and ``handlers`` forwards
its historic names to it (``handlers._watchdog_task`` and the others).
"""

from __future__ import annotations

import asyncio
from typing import Any

#: The watchdog task ``on_startup`` started, or ``None``.
_watchdog_task: asyncio.Task | None = None
#: The grill's own LLM pool, built by ``on_startup`` (isolated from the
#: Knowledge Library's pool so the two do not share workers).
_grill_llm_pool: Any | None = None
#: Knowledge ingestions started by ``to-knowledge``, held until they finish.
_bg_tasks: set[asyncio.Task] = set()
