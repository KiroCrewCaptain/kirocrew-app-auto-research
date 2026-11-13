"""Every place Research Lab reaches into the Kiro Crew gateway, in one module.

An external app's Python runs inside the gateway process. Research Lab needs
three kinds of host surface:

1. **The App Kit context** handed to its hooks (``ctx``): the data directory,
   outbound redaction (``ctx.scrub``), the audit log (``ctx.audit``), the
   app's own enabled switch (``ctx.lifecycle``), the gateway's aiohttp
   application (``ctx.http_app``, granted because the manifest declares
   routes) and health reporting (``ctx.health``). These are public seams. Each
   is read off the context with ``getattr`` and has a fallback that is never
   MORE permissive than the host: no scrubber masks every string, no audit
   sink logs locally, no lifecycle seam stands every campaign down.

2. **Gateway services with no App Kit seam yet.** A campaign drives worker chat
   slots through the host's autonudge loops, starts Dynamic Workflow runs,
   ingests its report into the Knowledge Library and publishes an artifact.
   None of that has a public seam, so it is resolved from the running gateway
   here by name through :func:`_host_attr` (``importlib``). Services and
   functions are looked up when an operation calls for them; the AutoNudge
   stop-reason constants, ``LLMPool``, ``ArtifactStore``, the two exception
   types and ``OnLoopDBGuard`` are looked up once, when this module is
   imported, each with a fallback (``None``, a stand-in class or a literal).
   When the gateway does not provide one, the operation that needs it is
   REFUSED with a reason the page shows, never run some other way, and
   ``register_routes`` reports the reason through ``ctx.health``.
   ``PORTING.md`` lists each one as a gap with the generic seam that would
   replace it.

3. **Runtime objects the gateway already hands every route.** ``request.app``
   (and ``ctx.http_app``, the same object) carries the dashboard state under
   ``"state"`` and the Knowledge pipeline under ``"knowledge_pipeline"``. The
   built-in read them the same way; their shape is feature-detected where it is
   used.

Nothing else in ``backend/`` names ``kiro_crew`` (``tests/test_no_host_imports.py``
pins that), and this module has no ``import kiro_crew`` statement: every host
name goes through :func:`_host_attr`, so a missing one never breaks the load.
"""

from __future__ import annotations

import importlib
import logging
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable

logger = logging.getLogger("kirocrew.app.auto-research")

APP_NAME = "auto-research"

#: The App Kit seam level this app is written against: structural route records.
REQUIRED_SDK_LEVEL = 1


# ── host resolution ─────────────────────────────────────────────────────────


def _host_attr(module: str, name: str) -> Any | None:
    """``module.name`` from the running gateway, or ``None`` when it has none.

    The one seam tests replace to model an older or stripped-down gateway.
    """
    try:
        mod = importlib.import_module(module)
    except Exception:  # noqa: BLE001 - any import failure means "not provided"
        return None
    return getattr(mod, name, None)


class HostCapabilityMissing(RuntimeError):
    """The gateway does not provide a service this operation requires."""


# ── route records ───────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Route:
    """One ``hooks.routes`` record, accepted structurally by the gateway.

    A level-1 ``RouteRegistry`` takes any record with a str ``method``, a str
    ``path`` (relative to ``/api/apps/auto-research``) and a callable
    ``handler(request, ctx)``.
    """

    method: str
    path: str
    handler: Callable[[Any, Any], Awaitable[Any]]


def sdk_level(ctx: Any) -> int:
    """The seam level the gateway reports; 0 for a gateway that predates the field."""
    level = getattr(ctx, "sdk_level", 0)
    return level if isinstance(level, int) and not isinstance(level, bool) else 0


# ── the bound app context ───────────────────────────────────────────────────

_ctx: Any | None = None
_ctx_lock = threading.Lock()


def bind(ctx: Any) -> None:
    """Remember the context the gateway handed to ``register_routes``.

    Campaign work reaches the context from places no request passes through
    (the watchdog task, worker threads reading findings), so it is held here. A
    later context replaces an earlier one: an update or a re-enable hands a
    fresh one.
    """
    global _ctx
    with _ctx_lock:
        _ctx = ctx


def unbind(ctx: Any | None = None) -> None:
    """Forget the bound context (only *ctx*, when given)."""
    global _ctx
    with _ctx_lock:
        if ctx is None or _ctx is ctx:
            _ctx = None


def bound() -> Any | None:
    with _ctx_lock:
        return _ctx


def data_home() -> Path:
    """The Kiro Crew data home, read off the bound context's data directory.

    The gateway hands an app ``ctx.data_dir = <data home>/apps/<app>/data``. The
    built-in kept campaign workspaces under ``<data home>/workspace/research``,
    where the research agent is told to write, so that location is derived
    from the context rather than guessed. A context whose data directory does
    not have that shape is refused, never resolved to some other directory.
    """
    ctx = bound()
    data_dir = getattr(ctx, "data_dir", None)
    if data_dir is None:
        raise HostCapabilityMissing("no app context is bound")
    path = Path(data_dir)
    if path.name != "data" or path.parent.name != APP_NAME or path.parent.parent.name != "apps":
        raise HostCapabilityMissing(f"unexpected app data directory layout: {path}")
    return path.parent.parent.parent


def app_data_dir() -> Path:
    """``ctx.data_dir`` of the bound context (``<data home>/apps/auto-research/data``)."""
    ctx = bound()
    data_dir = getattr(ctx, "data_dir", None)
    if data_dir is None:
        raise HostCapabilityMissing("no app context is bound")
    return Path(data_dir)


# ── outbound redaction (ctx.scrub) ──────────────────────────────────────────


class ScrubUnavailable(RuntimeError):
    """No redaction is available, so the caller must withhold the text."""


def redaction_available() -> bool:
    ctx = bound()
    return callable(getattr(getattr(ctx, "scrub", None), "outbound", None))


def scrub_text(text: str) -> str:
    """*text* with credentials and exfiltration URLs removed by the host's policy.

    Raises :class:`ScrubUnavailable` when no context with a scrubber is bound or
    the scrubber fails; the caller masks the text instead of returning it.
    """
    ctx = bound()
    outbound = getattr(getattr(ctx, "scrub", None), "outbound", None)
    if not callable(outbound):
        raise ScrubUnavailable("no redaction seam")
    try:
        result = outbound(text)
    except Exception as exc:  # noqa: BLE001 - any failure withholds the text
        raise ScrubUnavailable(type(exc).__name__) from exc
    cleaned = getattr(result, "text", None)
    if not isinstance(cleaned, str):
        raise ScrubUnavailable("redaction returned no text")
    return cleaned


# ── audit (ctx.audit) ───────────────────────────────────────────────────────


class _AuditLog:
    """``log_api_access(...)`` over ``ctx.audit.record``, the built-in's SEL call shape.

    ``ctx.audit`` records ``app:auto-research`` as the caller and prefixes the
    operation with the app name. It takes no free-form fields, so the built-in's
    extra keywords (``parent=``, ``slug=``, ``source_id=``) are appended to
    ``resources`` as ``key=value`` pairs.
    """

    def __init__(self, sink: Any) -> None:
        self._sink = sink

    def log_api_access(
        self,
        *,
        caller: str = "",
        operation: str,
        outcome: str = "success",
        resources: str = "",
        **extra: Any,
    ) -> None:
        del caller  # the host sets the caller from the app's identity
        detail = " ".join(f"{key}={value}" for key, value in sorted(extra.items()))
        self._sink.record(
            operation, outcome, resources=f"{resources} {detail}".strip() if detail else resources
        )


def audit_log() -> _AuditLog:
    """The audit sink for the bound context; raises when the context has none."""
    sink = getattr(bound(), "audit", None)
    if not callable(getattr(sink, "record", None)):
        raise HostCapabilityMissing("no audit seam")
    return _AuditLog(sink)


# ── gateway services without a seam ─────────────────────────────────────────

#: AutoNudge stop reasons the campaign engine classifies. The literal is the
#: host's current value, used only on a gateway that does not export the name.
AUTONUDGE_STOP_REASON: str = (
    _host_attr("kiro_crew.autonudge", "AUTONUDGE_STOP_REASON") or "autonudge_stop"
)
CONSECUTIVE_FAILURE_REASON: str = (
    _host_attr("kiro_crew.autonudge", "CONSECUTIVE_FAILURE_REASON") or "consecutive_failures"
)
SESSION_START_FAILURE_REASON: str = (
    _host_attr("kiro_crew.autonudge", "SESSION_START_FAILURE_REASON") or "session_start_failures"
)


def autonudge_instance() -> Any | None:
    """The gateway's AutoNudge service, or ``None`` (agent mode is then refused)."""
    get_instance = _host_attr("kiro_crew.autonudge", "get_instance")
    if not callable(get_instance):
        return None
    return get_instance()


def slot_history_key(slot: Any) -> str:
    """The conversation-log key of a chat slot, by the gateway's own rule."""
    fn = _host_attr("kiro_crew.dashboard.chat_utils", "slot_history_key")
    if not callable(fn):
        raise HostCapabilityMissing("kiro_crew.dashboard.chat_utils.slot_history_key")
    return fn(slot)


def _lifecycle_is_enabled(ctx: Any) -> Callable[[], Any] | None:
    """``ctx.lifecycle.is_enabled`` (App Kit level 2), or ``None`` when *ctx* has none."""
    is_enabled = getattr(getattr(ctx, "lifecycle", None), "is_enabled", None)
    return is_enabled if callable(is_enabled) else None


def is_app_enabled(name: str) -> bool:
    """The app's own enabled switch, read through ``ctx.lifecycle.is_enabled()``. Blocking.

    ``False`` (stand down) when the bound context has no lifecycle seam, and for
    any *name* but this app's: the seam answers for the context's own app only.
    """
    if name != APP_NAME:
        return False
    is_enabled = _lifecycle_is_enabled(bound())
    if is_enabled is None:
        return False
    return bool(is_enabled())


def revoke_slot_trust(state: Any, slot: Any) -> None:
    """End a worker slot's standing trust by the gateway's own rule.

    The host's ``revoke_slot_trust`` also clears the ``approval_policy`` that turn
    admission cached from the flag (the spawn gate and each child's tool approval
    read that, not the flag) and the flag on slots sharing the session. On a
    gateway without it the flag alone is cleared, as that gateway's built-in did.
    """
    fn = _host_attr("kiro_crew.dashboard.chat_utils_slots", "revoke_slot_trust")
    if callable(fn):
        fn(state, slot)
        return
    slot._trust = False


def effective_session_key(slot: Any) -> str | None:
    """The session a chat slot's turns run on, by the gateway's own rule.

    ``None`` on a gateway without it; the caller then stores no session policy,
    as that gateway's built-in did.
    """
    fn = _host_attr("kiro_crew.dashboard.chat_utils_slots", "effective_session_key")
    if not callable(fn):
        return None
    return str(fn(slot))


def register_stopped_loop_tombstone(provider: Any) -> bool:
    """Answer core's ``stopped_loop_tombstone`` seam for this app; whether it took.

    A stop of a campaign worker's legacy loop asks that seam whether to keep the
    stopped row (the watchdog reads it as a deliberate finish) or remove it. A
    gateway without the seam answers from its own copy of the predicate.
    """
    register = _host_attr("kiro_crew.apps.seams", "register")
    seam = _host_attr("kiro_crew.apps.seams", "SEAM_STOPPED_LOOP_TOMBSTONE")
    if not callable(register) or not isinstance(seam, str):
        return False
    try:
        register(seam, APP_NAME, provider)
    except ValueError:
        logger.warning("Research Lab: another app holds the stopped-loop seam", exc_info=True)
        return False
    return True


#: The Knowledge Library's pending-reason property and its import-budget value,
#: written with a source parked ``pending`` so the Sources list can say why.
PENDING_REASON_PROP: str = (
    _host_attr("kiro_crew.knowledge.store", "PENDING_REASON_PROP") or "pending_reason"
)
PENDING_REASON_IMPORT_BUDGET: str = (
    _host_attr("kiro_crew.knowledge.store", "PENDING_REASON_IMPORT_BUDGET") or "import_budget"
)

#: The gateway's LLM worker pool class (grill and report authoring), or ``None``.
LLMPool: Any | None = _host_attr("kiro_crew.knowledge.llm_pool", "LLMPool")

#: The gateway's artifact store, or ``None`` (artifact export answers 503).
ArtifactStore: Any | None = _host_attr("kiro_crew.artifacts", "ArtifactStore")


class _NoArtifactNotFound(Exception):
    """Stand-in that nothing raises, for a gateway with no artifact store."""


ArtifactNotFoundError: type[BaseException] = (
    _host_attr("kiro_crew.artifacts", "ArtifactNotFoundError") or _NoArtifactNotFound
)


class _NoChunkBudget(Exception):
    """Stand-in that nothing raises, for a gateway whose ingestion has no chunk budget."""


ImportChunkBudgetError: type[BaseException] = (
    _host_attr("kiro_crew.knowledge.ingestion", "ImportChunkBudgetError") or _NoChunkBudget
)


class _LocalOnLoopDBGuard:
    """A gateway without the shared guard: log a blocking DB call made on the loop.

    The host's guard can also raise in its strict mode; this stand-in only logs,
    because it has no switch to read. Every call site is offloaded already.
    """

    def __init__(self, *, label: str, remedy: str, **_ignored: Any) -> None:
        self.label = label
        self.remedy = remedy

    def check(self) -> None:
        import asyncio

        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return
        logger.warning("%s opened on the event loop. %s", self.label, self.remedy)


OnLoopDBGuard: Any = _host_attr("kiro_crew.on_loop_db", "OnLoopDBGuard") or _LocalOnLoopDBGuard


def awake_now() -> float:
    """Seconds on a clock that stands still while the host sleeps (host's), else monotonic."""
    fn = _host_attr("kiro_crew.platform_compat", "awake_now")
    if callable(fn):
        return float(fn())
    return time.monotonic()


def models_handler() -> Any | None:
    """The gateway's own ``GET /api/models`` handler, or ``None``.

    The page's model picker needs the list the dashboard's pickers show, and
    ``/api/models`` is outside this app's API grant; ``GET /models`` answers it
    by calling the host's handler for the same request.
    """
    fn = _host_attr("kiro_crew.dashboard.handlers", "api_models")
    return fn if callable(fn) else None


#: What each group of host services is needed for, for the health report.
_CAPABILITIES: tuple[tuple[str, tuple[tuple[str, str], ...]], ...] = (
    (
        "agent-mode campaigns cannot run: this Kiro Crew has no AutoNudge service for apps",
        (
            ("kiro_crew.autonudge", "get_instance"),
            ("kiro_crew.dashboard.chat_utils", "slot_history_key"),
        ),
    ),
    (
        "the question planner and the polished report fall back: this Kiro Crew has no LLM pool",
        (("kiro_crew.knowledge.llm_pool", "LLMPool"),),
    ),
    (
        "report export is refused: this Kiro Crew has no artifact store",
        (("kiro_crew.artifacts", "ArtifactStore"),),
    ),
    (
        "the model picker offers only the default: this Kiro Crew cannot list models for apps",
        (("kiro_crew.dashboard.handlers", "api_models"),),
    ),
)


def capability_issues(ctx: Any) -> list[str]:
    """Why this gateway serves Research Lab only in part; ``[]`` when it serves all of it."""
    issues: list[str] = []
    if sdk_level(ctx) < REQUIRED_SDK_LEVEL:
        issues.append(
            "the API answers 404: this Kiro Crew does not accept app route records "
            f"(App Kit level {sdk_level(ctx)}, Research Lab needs {REQUIRED_SDK_LEVEL})"
        )
    if not callable(getattr(getattr(ctx, "scrub", None), "outbound", None)):
        issues.append("findings are masked: this Kiro Crew has no redaction seam for apps")
    if getattr(ctx, "http_app", None) is None:
        issues.append(
            "campaigns are not watched: this Kiro Crew does not hand apps its web application"
        )
    if _lifecycle_is_enabled(ctx) is None:
        issues.append(
            "campaigns stand down: this Kiro Crew cannot tell an app whether it is enabled "
            "(no ctx.lifecycle, App Kit level 2)"
        )
    for issue, names in _CAPABILITIES:
        if any(_host_attr(module, name) is None for module, name in names):
            issues.append(issue)
    return issues
