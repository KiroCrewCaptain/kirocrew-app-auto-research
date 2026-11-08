"""Serve the backend the way the gateway's RouteRegistry and lifecycle do.

The registry mounts one catch-all at ``/api/apps/{app_name}/{path}``, matches
the remainder against each route record, injects path params into
``match_info`` and calls ``handler(request, ctx)``; the lifecycle dispatcher
calls ``on_startup(ctx)`` and ``on_shutdown(ctx)``. :func:`mount` does the same
on a test's own ``web.Application``, with aiohttp's router doing the matching
under the same prefix, so a test request uses the URL a dashboard request uses
and ``ctx.http_app`` is that application, as the gateway's is.

``make_ctx`` builds the context at App Kit level 2 with the host's real
``ScrubSDK``, ``AuditSDK`` and ``AppLifecycleSDK`` (Kiro Crew is a pinned test
dependency). The lifecycle seam reads the app's install record, which a test's
data home does not have, so it answers "disabled" unless a test installs one or
replaces ``handlers.is_app_enabled``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from aiohttp import web

PREFIX = "/api/apps/auto-research"


class FakeHealth:
    def __init__(self) -> None:
        self.status = "healthy"
        self.issues: list[str] = []

    def mark_degraded(self, issue: str) -> None:
        self.status = "degraded"
        self.issues.append(issue)


@dataclass
class FakeCtx:
    data_dir: Path
    name: str = "auto-research"
    sdk_level: int = 2
    scrub: Any = None
    audit: Any = None
    lifecycle: Any = None
    http_app: Any = None
    health: FakeHealth = field(default_factory=FakeHealth)


def make_ctx(home: Path, **overrides: Any) -> FakeCtx:
    from kiro_crew.apps.audit_sdk import AuditSDK
    from kiro_crew.apps.lifecycle_sdk import AppLifecycleSDK
    from kiro_crew.apps.scrub_sdk import ScrubSDK

    values: dict[str, Any] = {
        "data_dir": Path(home) / "apps" / "auto-research" / "data",
        "scrub": ScrubSDK(),
        "audit": AuditSDK("auto-research"),
        "lifecycle": AppLifecycleSDK("auto-research"),
    }
    values.update(overrides)
    return FakeCtx(**values)


def mount(app: web.Application, ctx: Any = None) -> Any:
    """Register the app's routes and lifecycle hooks on *app*, as the gateway does.

    Returns the context, whose ``http_app`` is *app*. With no *ctx*, the bound
    one (the autouse ``bound_ctx`` fixture's) is reused.
    """
    from backend import _host, handlers

    if ctx is None:
        ctx = _host.bound()
    ctx.http_app = app
    for route in handlers.register_routes(ctx):

        async def _dispatch(request: web.Request, _route=route) -> web.StreamResponse:
            return await _route.handler(request, ctx)

        app.router.add_route(route.method, PREFIX + route.path, _dispatch)

    async def _start(_app: web.Application) -> None:
        await handlers.on_startup(ctx)

    async def _stop(_app: web.Application) -> None:
        await handlers.on_shutdown(ctx)

    app.on_startup.append(_start)
    app.on_shutdown.append(_stop)
    return ctx
