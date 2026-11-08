# Porting notes: built-in → external app

This repository was ported from Kiro Crew's built-in Research Lab at KiroCrew
`main` `4bb268b4e9`:

- the backend, `src/kiro_crew/apps/builtins/auto_research/` (`app.json`,
  `handlers.py`, `session_keys.py`, `subquestion_queue.py`,
  `workflow_template.py`, `campaign/*.py`, and its own
  `tests/test_windows_support.py`);
- the dashboard page, `website/src/apps/auto-research/` (`ResearchLabPage.tsx`,
  `GrillTree.tsx`, `grillTreeModel.ts` and three tests), and its store art,
  `website/public/app-assets/auto-research/`;
- the `apps.autoResearch.*` strings of `website/src/i18n/locales/*.json` (plus
  `en.manual.json`);
- the tests: every `test/test_auto_research*.py`, `test/auto_research_helpers.py`,
  `test/auto_research_handlers_coverage_helpers.py`, `test/test_subquestion_queue.py`,
  the Research Lab cases of `test/test_artifacts_store_off_loop.py` and
  `test/test_owner_only_files.py`, `website/src/test/ResearchLabPage*.test.tsx`
  and `website/src/test/grillTreeModelCov80.test.ts`.

It was then brought up to KiroCrew `main` `6d07df11cf`: every change to those
paths since the snapshot is ported (see "Wheel-copy changes since the snapshot"
below), and the backend uses the App Kit level-2 seams that apply to it.

Paths with a line number below refer to the snapshot commit. A **gap** is something the
built-in gets from Kiro Crew that an external app has no public way to get yet;
closing one is a Kiro Crew change (a generic, app-agnostic App Kit seam), not a
change here.

## What carried over unchanged

- `app.json` `name` (`auto-research`), `version` (`0.1.0`), `author`,
  `permissions` (`api: ["/api/apps/auto-research"]`, nothing else), `platform`,
  `defaultEnabled: false`, and every display field (`displayName`,
  `description`, `tags`, `highlights`, `useCases`, `configuration`).
  `tests/test_manifest_contract.py` compares them with the built-in's manifest
  (`tests/fixtures/builtin-app.json`), because adoption refuses a manifest that
  widens a grant or forces the app off.
- The whole campaign engine: `campaign/{untrusted,storage,lifecycle,publication,exploration,agent_mode,workflow_mode,watchdog,grill}.py`,
  `subquestion_queue.py`, `workflow_template.py` and `session_keys.py` are the
  built-in's files with their imports changed (and the few call sites below).
  Every route's method, path, validation, status codes and response shape; the
  SQLite schema and its migrations; the per-campaign transition lock and the
  run-generation fence; the watchdog's stall, trust-expiry and settlement rules;
  the worker prompt and the `kirocrew-research` agent it runs on; the Dynamic
  Workflow template.
- The `handlers` facade: every historic `handlers.<name>` still resolves, and a
  patch through it reaches the owning component
  (`tests/test_auto_research_facade.py`, `test_auto_research_campaign_contract.py`).
- Where campaigns live on disk: `<data home>/workspace/research/<campaign id>/`
  (the brief, `FINDINGS.md`, the cycle files, `worker_done.json`, the
  sub-question queue), derived from `ctx.data_dir` (`_host.data_home`). Worker
  sessions keep their `research-<id>` slot keys and their history.

## What changed, and why

| Built-in | Here | Why |
|---|---|---|
| No `backend` in `app.json`; routes registered by the `BUILTIN_NAMES` loop (`src/kiro_crew/apps/builtins/__init__.py:5`, `dashboard/routes/system.py:235-239`) | `"backend": {"hooks": {"routes", "on_startup", "on_shutdown"}}`, all three in `backend/handlers.py` | The built-in boot loop is for built-ins only. An external app's routes go through the gateway's `RouteRegistry`, its lifecycle through the hook dispatcher. |
| `register_routes(app)` adding 16 absolute routes and appending `app.on_startup` / `app.on_shutdown` (`handlers.py:1042-1086`) | `register_routes(ctx) -> list[Route]` (`handlers.ROUTES`, relative paths), `on_startup(ctx)`, `on_shutdown(ctx)` | The `hooks.routes` contract. `Route` is the app's own frozen dataclass (`backend/_host.py`), accepted structurally from App Kit level 1. The handlers keep their one-argument shape; the registry's `(request, ctx)` call goes through a thin adapter that looks the handler up by name at call time. |
| The grill's `LLMPool` and the watchdog task stored on the aiohttp app (`handlers.py:1071`, `:1081`), `app.setdefault("_bg_tasks", set())` (`:1045`, `:931-934`) | Held in `handlers` (`_grill_llm_pool`, `_watchdog_task`, `_bg_tasks`) | The gateway's application is frozen once it serves; an app must not write to it. |
| The watchdog read the dashboard state from the app it was started on | `on_startup` starts it on `ctx.http_app` (the same gateway application, granted because the manifest declares routes) | Without `ctx.http_app` no campaign is watched, and health says so. |
| The watchdog kept polling while the app was disabled and suspended every research loop and its slot trust (`campaign/watchdog.py:395-412`) | `on_shutdown` suspends them (`watchdog._suspend_research_loops_while_disabled`) | This copy's watchdog stops with the app. The gateway calls `on_shutdown` before the enabled flag flips, and also on a reload or at exit, so it suspends every time; a suspended loop carries no stop reason, so the watchdog re-arms it on its first poll after the next start, exactly as after a re-enable (`tests/test_host_seams.py::TestShutdownSuspendsResearchLoops`). |
| `campaigns.db` at `<data home>/apps/auto-research/campaigns.db` (`campaign/storage.py:50-54`) | `<data home>/apps/auto-research/data/campaigns.db` (`ctx.data_dir`, `storage.data_db_path`), where the built-in now keeps it too (KiroCrew #32650) | An update or an adoption keeps only `data/` (and the app secret) of an app's directory; a file beside `app.json` is deleted with the old tree. `storage.py`'s location and copy code is the built-in's #32650 code: a database still beside `app.json` stays in use until a copy is published (`db_path`), is copied in once per process before the first connection opens (SQLite online backup, so rows still in the `-wal` come along; owner-only staging file; `PRAGMA quick_check`; published with a hard link, so a database already in `data/` is never replaced; a lock held on the old file for 5 s gives up), and the old file and its sidecars are removed once the copy is published. A link at the old name is an operator's redirection and stays in use. The built-in runs that copy from a startup hook on every start, enabled or not; this copy's hooks run only while the app is enabled, so it runs from the first `_get_db`. See gap 1. |
| Absolute self-imports `kiro_crew.apps.builtins.auto_research.*` (`handlers.py:31-211`, every `campaign/*.py`), and the facade's dotted owner names (`handlers.py:213`) | Relative imports; `_CAMPAIGN = f"{__package__}.campaign"` | Hook files load into a synthetic package named after the app (App Kit `manifest-reference.md`, "Importing your own modules"); `tests/test_manifest_contract.py` loads the hooks through the gateway's own module loader. |
| `kiro_crew.security.{redact,redact_credentials,redact_exfiltration_urls}` with an import-failure flag (`campaign/untrusted.py:17-25`) | `ctx.scrub.outbound(text).text` (`_host.scrub_text`) | The level-0 scrub seam: the gateway's active policy on top of the same baseline passes. No context, no scrubber, a scrubber that raises or returns no text: every string is masked (`[REDACTED]`), and a worker slot's title falls back to its key. The facade no longer has `redact_credentials` / `redact_exfiltration_urls`; it has `redact`. |
| `sel().log_api_access(caller="auto_research", operation=…, **extra)` (`campaign/lifecycle.py:76-97`) | `ctx.audit.record(operation, outcome, resources=…)` through the same `lifecycle._audit` (`_host.audit_log`) | The level-0 audit seam. Rows now read caller `app:auto-research` and operation `auto-research.<verb>` (the built-in wrote `auto_research` / `<verb>`); the extra fields (`parent=`, `slug=`, `source_id=`) are appended to `resources`. No audit seam is a logged warning, as a missing SEL module was. |
| `kiro_crew.apps.manager.is_app_enabled` (`campaign/watchdog.py:37`) | `_host.is_app_enabled`, which reads `ctx.lifecycle.is_enabled()` of the bound context (App Kit level 2, KiroCrew #32648); `False` with no lifecycle seam, and for any name but this app's | The public seam for the app's own switch, so no private `apps.manager` name is reached. A watchdog that cannot tell stands down rather than drives loops, and `register_routes` reports it. |
| `slot._trust = False` and, since KiroCrew #30864, `kiro_crew.dashboard.chat_utils_slots.revoke_slot_trust` (`campaign/watchdog.py`, the disable suspension and the 24 h trust expiry) | `_host.revoke_slot_trust`: the host's rule, which also clears the `approval_policy` turn admission cached from the flag (the spawn gate and each child's tool approval read that) and the flag on slots sharing the session; on a host without it the flag alone, as that host's built-in did | A sub-agent of a worker must stop auto-approving once the trust ends. |
| `session_directive_apply_monitor` importing the built-in's `is_owned_research_slot`; since KiroCrew #28338 the built-in's `seams.py` registering it as core's `stopped_loop_tombstone` provider | `backend/seams.py`, registered from `on_startup` through `_host.register_stopped_loop_tombstone` (`kiro_crew.apps.seams.register`) | Core asks the seam, never the app. See gap 2. |
| `kiro_crew.atomic_write.atomic_write` (`subquestion_queue.save_queue`, KiroCrew #28529) | `_fs.atomic_write`: the host's, else a unique temp file and one `os.replace` | The unique staging name keeps two writers of one campaign apart; the host's also retries the Windows sharing-violation window. |
| `kiro_crew.knowledge.store.{PENDING_REASON_PROP,PENDING_REASON_IMPORT_BUDGET}` (`campaign/publication.py`, KiroCrew #32528) | `_host.PENDING_REASON_PROP` / `_host.PENDING_REASON_IMPORT_BUDGET`, the host's values or their current literals | A source parked `pending` by the import budget says why, in the same write (`store.merge_source_properties`). |
| `kiro_crew.llm_helpers._extract_json_of_type` (private, `campaign/grill.py:16`) | `backend/_json.py`, the same function | Pure, no policy; the grill's tests pin it. |
| `kiro_crew.dashboard.handlers._shared.string_field_error` (`handlers.py:487`, `:962`) | `handlers.string_field_error`, the same 400 | A few lines. |
| `kiro_crew.atomic_write.read_json_or`, `kiro_crew.owner_only_files.*`, `kiro_crew.sqlite_wal.enable_wal` (`campaign/storage.py:23-32`, `subquestion_queue.py:34`, `campaign/workflow_mode.py:35`) | `backend/_fs.py`: the gateway's own helper when it has one, else a restatement | See gap 6. |
| `kiro_crew.platform_compat.{is_link_or_junction,unlink_link_or_junction}` (`campaign/agent_mode.py:46`) and `platform_compat.awake_now` (`campaign/watchdog.py:27`) | `backend/_compat.py` (the clock is the gateway's when it has one, else `time.monotonic`) | Small and policy-free. `watchdog.platform_compat` is still the name a test stands in for. |
| Logger `kiro_crew.apps.builtins.auto_research.handlers` (`campaign/__init__.py:38`) | `kirocrew.app.auto-research`, for the facade too | The app logger namespace. An operator filter on the old name needs the new one. A background gateway writes it to `gateway.log` (its file handler is on the root logger); a gateway run in the foreground attaches that handler to `kiro_crew` only, so there the app's warnings reach stderr and not the file, as every app's do. |
| GET routes answered HEAD too (aiohttp's `add_get`) | GET only | The registry dispatches the five methods a record may name. Nothing in the page sends HEAD. |
| (none) | `GET /models` | See gap 4. |
| `iconUrl` / `heroImage*` as absolute `/app-assets/auto-research/*.svg`, `screenshots` `/app-assets/…` (`app.json:33-46`) | `iconPath` / `heroImage*` / `screenshots` as repo-relative PNGs under `assets/` | A registry app's art is repo-relative, and the catalog's publish step refuses SVG for a non-builtin source. The PNGs were rendered from the built-in SVGs (kept beside them): the icon at 512×512 on an opaque tile with `--ico-a` / `--ico-b` resolved to fixed colours, the heroes at 1200×675 and the detail heroes at 1200×288. |
| `ui.pages` `[{"route": "/auto-research", "label": "Research Lab", "icon": "FlaskConical"}]`, page compiled into the dashboard (`app.json:28-32`, `website/src/apps/builtinRegistry.ts:53`) | `ui.entry: "dist/index.mjs"` (a committed ESM bundle built from `ui/src/`), `ui.pages` `[{"route": "/apps/auto-research", "label": "Research Lab"}]`, no `icon` | An installed app ships its page as a bundle AppHost loads. The legacy `/auto-research` route and `FlaskConical` glyph of an adopted record come from Kiro Crew's adoption pin, never from this manifest. |
| App Store copy keys in the dashboard catalogs (`website/src/components/appstore/appManifest.ts:99-114`) | `l10n` block in `app.json` for the 11 non-English locales | The listing copy travels with the app. It is the `apps.autoResearch.manifest` subtree of `ui/i18n/<locale>.json`, kept equal by a test. |
| No `minKiroCrewVersion` | `"minKiroCrewVersion": "0.13.0"` | The first Kiro Crew release with App Kit level 1 (structural route records, `APP_SDK_LEVEL = 1`). A 0.12.x gateway is level 0: its route registry skips every record that is not its own `AppRoute` class, so every route of this app would answer 404 there. |
| No `license` | `"license": "Apache-2.0"` | The repository's license, stated for the catalog. Not a field adoption compares. |

## Host services without a seam: resolved from the gateway, fail closed

Nothing in `backend/` but `_host.py` and `_fs.py` names `kiro_crew`, and neither
has an `import kiro_crew` statement; `_host._host_attr` resolves each name
through `importlib` and answers `None` when it is missing
(`tests/test_no_host_imports.py`). Services and functions are resolved when an
operation calls for them; the AutoNudge stop-reason constants, `LLMPool`,
`ArtifactStore`, `ArtifactNotFoundError`, `ImportChunkBudgetError` and
`OnLoopDBGuard` are resolved once, when `_host.py` is imported, each with a
fallback (`None`, a stand-in class or the host's current literal). When the gateway lacks one, the operation
that needs it is refused or degraded, never run some other way, and
`register_routes` reports the reason through `ctx.health`
(`_host.capability_issues`).

| Built-in import or use | Where | Without it |
|---|---|---|
| `kiro_crew.autonudge.get_instance` and its stop-reason constants | `campaign/agent_mode.py:39-44` | Agent-mode start launches no worker (logged; the watchdog then settles the campaign as stalled). The constants fall back to the host's current literals. |
| `kiro_crew.dashboard.chat_utils.slot_history_key` | `campaign/agent_mode.py:45`, `:315` | The worker slot's title is not persisted (the loop is still armed, as when the write failed in the built-in). |
| `request.app["state"]`: `get_or_create_slot`, `get_slot`, `_slots`, `conversation_log`, `push_slot_title`, `push_slots_update`, `workflow_service`, `knowledge_store` | `campaign/agent_mode.py:228-338`, `campaign/watchdog.py:195`, `:386`, `:437`, `campaign/workflow_mode.py:93-187`, `handlers.py:541`, `:878`, `:907` | Read off the gateway's application exactly as the built-in did, each feature-detected where used: no state, no worker; no `workflow_service`, no workflow launch; no `knowledge_store`, `knowledge-status` says "not in the library" and `to-knowledge` answers 503. |
| `request.app["knowledge_pipeline"]` | `handlers.py:911` | `to-knowledge` answers 503. |
| `kiro_crew.knowledge.llm_pool.LLMPool` | `handlers.py:41`, `:1071` | No pool: the grill reports "unavailable" (the page offers manual sub-questions) and the report export renders FINDINGS.md mechanically, both paths the built-in already had. |
| `kiro_crew.artifacts.{ArtifactStore,ArtifactNotFoundError}` | `campaign/publication.py:31` | `to-artifact` answers 503 and `report-status` answers `{slug: null}`, the built-in's import-failure behaviour. |
| `kiro_crew.knowledge.ingestion.ImportChunkBudgetError` | `campaign/publication.py:28` | A stand-in that nothing raises. |
| `kiro_crew.on_loop_db.OnLoopDBGuard` | `campaign/storage.py:25` | A guard that logs an on-loop open (it cannot raise: it has no strict switch to read). |
| `kiro_crew.dashboard.handlers.api_models` | (new, `GET /models`) | The picker offers only "Default (inherit)". |
| `kiro_crew.dashboard.chat_utils_slots.revoke_slot_trust` | `campaign/watchdog.py` (disable suspension, 24 h trust expiry) | The trust flag alone is cleared. |
| `kiro_crew.apps.seams.{register,SEAM_STOPPED_LOOP_TOMBSTONE}` | `seams.py`, from `on_startup` | Nothing is registered; a gateway without the seam answers from its own built-in copy of the predicate. |
| `kiro_crew.knowledge.store.{PENDING_REASON_PROP,PENDING_REASON_IMPORT_BUDGET}` | `campaign/publication.py` | The host's current literals. |

One more host behaviour shows up only when the hooks run in a real gateway:
the gateway executes `handlers.py` once per hook entry (`routes`, `on_startup`,
`on_shutdown`), so module-level state there would be three different objects.
The state they share is in `backend/_runtime.py`
(`tests/test_manifest_contract.py` loads the hooks through the gateway's own
module loader and checks it).

## Remaining gaps

1. **Closed: the campaigns database is in `data/`.** The built-in kept
   `campaigns.db` beside `app.json`, which an adoption swap retires with the
   old tree. KiroCrew #32650 (on `main`) moved the built-in's database into
   `data/` itself, copied on every gateway start from a startup hook that runs
   enabled or not, and this copy uses the same location and the same copy
   code. Two things remain on the Kiro Crew side, not here: the copy reaches
   only users who start a release carrying #32650 before the release whose
   adoption swap runs, and `test/test_auto_research_db_location.py::
   test_auto_research_is_not_pinned_while_the_swap_can_retire_its_old_database`
   fails while `adoption-pins.json` has an `auto-research` row, until a
   swap-side refusal (or carry) for a `campaigns.db` still beside `app.json`
   lands with that row (app-kit-platform.md, "What the swap keeps is `data/`").
2. **Closed: core no longer imports the app.** KiroCrew #28338 replaced the
   monitor's import of `is_owned_research_slot` with core's app-keyed
   `stopped_loop_tombstone` seam (`kiro_crew.apps.seams`). This copy answers it
   from `backend/seams.py`, registered from `on_startup`, with the same
   predicate on the same keys and provenance. One difference while it is the
   only provider: a registration lives for the gateway process, so after a
   restart with the app switched off nothing answers until the app is next
   enabled, where the built-in's provider loaded on the first lookup whether
   or not the app was on. While the wheel still ships the built-in, its
   `seams.py` answers for the same app id and the same slots, so no adopted
   user sees a difference.
3. **The research agent is core's.** The worker runs on `kirocrew-research`,
   a service agent Kiro Crew materializes on every boot from its own prompt and
   tool set (`agent_materialization/service_agents.py:446-462`,
   `agent.py:1411`, `agent_parts/spec_rebuild.py:828`). Removing it from core
   needs an app agent with the same restricted tool set (no sub-agent tools)
   shipped by this app, which changes the agent's materialized name and so the
   spec of every existing worker slot; it is left as is for this wave.
4. **Model list.** The built-in page read the dashboard's shared
   `useAvailableModels()` (`ResearchLabPage.tsx:11`, `:178`, `:399`), which
   calls `GET /api/models`. That path is outside this app's API grant, and
   adoption refuses a widened grant, so the page asks the app's own
   `GET /models`, which answers with the gateway's own `/api/models` handler for
   the same request (`_host.models_handler`). A generic SDK hook for the model
   list would remove that private handler call.
5. **Other dashboard internals behind each campaign.** Worker slots are created
   with `state.get_or_create_slot(name=..., app="auto-research")`, trusted by
   setting `slot._trust`, titled through `conversation_log` and
   `push_slot_title`, driven by AutoNudge loops; workflow-mode campaigns start
   Dynamic Workflow runs through `state.workflow_service`; exports go through
   `state.knowledge_store`, `knowledge_pipeline` and `ArtifactStore`. None of
   these is an App Kit seam. Generic seams would be: an app-owned chat slot
   API with a bounded trust grant (the 24 h auto-approve cap included), an
   AutoNudge loop API scoped to the app's own slots, a workflow-start API, and
   knowledge-ingest and artifact-publish APIs. Until then a refactor of any of
   these in Kiro Crew can break this app silently; `minKiroCrewVersion` and the
   capability report are the only guards. Two level-2 seams now cover part of
   this, and neither can be adopted here yet: `ctx.auto_approve` (a bounded,
   audited auto-approve grant on an app-owned worker slot, KiroCrew #32667)
   would replace `slot._trust` and the 24 h cap, and `ctx.turns` (KiroCrew
   #32659) runs agent turns on app-owned sessions. Each is granted only by a
   manifest permission (`permissions.workerAutoApprove`,
   `permissions.agentTurns`) the built-in's `app.json` does not declare, and an
   adopted manifest may not declare more than the built-in's. Using either
   needs Kiro Crew to declare it on the built-in first, in a release before
   the pin; `ctx.turns` also has no AutoNudge loop, so it does not replace the
   worker loop by itself.
6. **File helper drift.** `backend/_fs.py` uses the gateway's
   `owner_only_files`, `atomic_write.read_json_or` and `sqlite_wal.enable_wal`
   when present. Its fallbacks keep `0700` directories and `0600` files from
   creation (POSIX) and refuse to write through a symlink at the file name; they
   drop the host's refusal to act through a symlinked directory inside the data
   home, its hard-link publish of a new database, its Windows sharing-violation
   retries and its once-per-path warning bound. A public file helper in the SDK
   would remove the copy.
7. **Execution trust.** A built-in's in-gateway Python is exempt from the
   third-party execution gate (`apps/execution.py:694-709`, `is_builtin_app`).
   This copy's hooks load only when the operator trusts it
   (`agent.apps_trusted`, or `agent.apps_allow_third_party`). For an existing
   user Kiro Crew's adoption writes that grant for this repository; a fresh
   install goes through the normal trust dialog.
8. **Styles.** The page keeps the built-in's Tailwind utility class strings.
   They render because the dashboard's stylesheet still carries them while the
   compiled built-in page ships with Kiro Crew.
9. **Store listing localization.** The catalog's publish step does not carry
   `l10n` yet, so a store row that is not installed shows the English fields.
10. **Sidebar icon on a fresh install.** The `FlaskConical` glyph and the
    `/auto-research` route are shown only for an adopted record (from Kiro
    Crew's pin). A fresh install lives at `/apps/auto-research` with the
    `iconPath` image.
11. **Built-in-only references left in core.** `platform/defaults.py:496-498`
    (`bundled_app_names`), `security_posture.py:1123-1133`, the packaged user
    doc `src/kiro_crew/docs/research-lab.md`, `docs/apps.md:81`,
    `data/tips_catalog.json:131-134`, the spec
    `docs/system-specs/modules/research-lab.md`, and the ratchet rows in
    `test/integration/test_boot_smoke.py:551`,
    `test/test_lazy_data_home_paths.py:440-441`,
    `test/test_core_path_redact_before_bound.py:181`,
    `test/link_screen_sites.py:68-70` and `scripts/check_sync_io_in_async.py:27`
    name the built-in. They go when the built-in does; the user doc and the
    spec belong in this repository then. On KiroCrew `main` `6d07df11cf` they all still stand
    (with comment-only mentions in `agent.py`, `autonudge_service/mutations.py`,
    `history_offload.py`, `knowledge/llm_pool.py` and
    `slack/gateway_runtime/result_egress.py`), and none of them is imported by
    or reaches this copy.
12. **Owner gate.** The built-in's routes required an authenticated dashboard
    caller (`_require_auth`), not the dashboard owner, and this copy keeps that:
    `ctx.require_owner` is not called. Tightening it would change who may run a
    campaign on an existing install, which this port does not decide.

## UI

The page is `ui/src/`, ported from `website/src/apps/auto-research/` with the
same markup, class strings and behaviour. `npm run build` in `ui/` writes the
committed `ui/dist/index.mjs`; CI rebuilds it and fails on a difference. Every
request goes through the host's scoped client (`useAppApi().raw`, handed to
`setTransport` by the root), so a path outside `permissions.api` is refused in
the browser; the backend's `error` sentence is read back out of the client's
refusal, as the dashboard's client gave the built-in page. The campaign stream
is still a same-origin `EventSource` on the app's own path (the scoped client
has no streaming call). Strings are `t()` over `ui/i18n/<locale>.json` for all
12 dashboard locales, under the dashboard's own key paths
(`apps.autoResearch.*`), plural forms by `Intl.PluralRules`.

| Built-in | Here |
|---|---|
| `api/client` `research*` endpoints | `ui/src/api.ts`, the same names over the scoped client |
| `components/ui` `Btn`, `Clickable`, `Modal`, `MarkdownRenderer`, `ErrorNotice` | The same components from `@kirocrew/app-sdk/ui` |
| `components/SimpleSelect` | `Select` from `@kirocrew/app-sdk/ui` (a native `<select>` on an older host) |
| `hooks/useImeGuard` | `useImeGuard` from `@kirocrew/app-sdk` |
| `components/RadioChipGroup` (`RadioChipGroup`, `radioChip`) | `ui/src/RadioChipGroup.tsx`, the dashboard's file unchanged (the SDK's UI package has no radio group) |
| `hooks/useAvailableModels` | `ui/src/models.ts`, over the app's `GET /models` (gap 4) |
| `utils/clipboard.copyToClipboard` | `ui/src/clipboard.ts`: the async clipboard API, else `execCommand('copy')`; it drops the dashboard's embedded-pane relay |
| `i18n/t.i18nT` with keys in the dashboard's catalogs | `ui/src/i18n.ts` over the app's own catalogs |

## Tests

| Built-in test | Here | Change |
|---|---|---|
| `test/test_auto_research*.py`, `test/test_subquestion_queue.py`, the two helper modules, the built-in's `tests/test_windows_support.py` | `tests/`, same names | Module paths are `backend.*`. Registration goes through `tests/harness.py` (`mount`), which serves `register_routes(ctx)` and the two lifecycle hooks the way the gateway does on a test's own application. `tests/conftest.py` pins the data home, binds a level-2 context with the host's real `ScrubSDK`, `AuditSDK` and `AppLifecycleSDK`, and replaces `LLMPool` with an inert stand-in so no test starts a model process. Kiro Crew (one pinned public commit) is a test dependency, so the AutoNudge, artifact, workflow-validator and owner-only-file collaborators are the real ones. |
| `test_auto_research_campaign_contract.py` | same | The identity table names `backend._host` / `_fs` / `_compat` / `_json` as each collaborator's owner, plus a table proving they are the gateway's own objects; the route table is the record list (no HEAD twins, plus `GET /models`); registration and the lifecycle hooks are tested as hooks; the log name is the app's. |
| `test_auto_research_facade.py` | same | The layering checks resolve relative imports first; the create-patch scan covers `tests/`. Dropped: `test_the_mirrored_owner_ratchet_sees_the_facade`, which imports a Kiro Crew repository-wide ratchet module. |
| `test_auto_research_onloop_db.py` | same | The coroutine inventory names the hooks instead of `_start_watchdog` / `_stop_watchdog`. |
| `test_auto_research_handlers_coverage_campaign_routes.py` | same | Ingestion tasks are drained from `handlers._bg_tasks`. |
| `test_auto_research.py` | same | The grill's fake pool replaces `handlers._grill_llm_pool`. |
| `test_windows_support.py` | same | The manifest is validated by the gateway's typed loader from the repository root; the built-in discovery assertion is gone. |
| `test_auto_research_db_location.py` (KiroCrew #32650) | same | Paths come from the bound context's `data_dir`. Dropped: the pin-table check (`adoption-pins.json` is Kiro Crew's) and the startup-hook case (this copy's hooks run only while enabled; the first open copies instead, which a case of its own pins). |
| Research Lab cases of `test/test_artifacts_store_off_loop.py`, `test/test_owner_only_files.py` | `tests/test_artifacts_store_off_loop.py`, `tests/test_owner_only_files.py` | The owner-only cases also run with the gateway's helpers removed, against `_fs`'s fallbacks. |
| (none) | `tests/test_host_seams.py`, `tests/test_no_host_imports.py`, `tests/test_manifest_contract.py` | Every fail-closed path above, the capability report, the lifecycle switch, the trust revocation, the stopped-loop seam registration, the pending reason, the shutdown suspension, `GET /models`; only the two shims reach `kiro_crew`, through `importlib`; manifest parity, the bundle's imports, the hooks loading through the gateway's module loader, no hardcoded model id, an adoptable tree. |
| `website/src/apps/auto-research/*.test.tsx`, `website/src/test/ResearchLabPage*.test.tsx` | `ui/tests/` | Run by vitest with stand-ins for the host SDK (`ui/tests/stubs/`), no Redux store or router. The select cases drive the host `Select` stand-in (a native `<select>`) instead of the dashboard's Radix picker. |
| `website/src/test/grillTreeModelCov80.test.ts` | `ui/tests/grillTreeModel.test.ts` | The 19 reducer and selector cases, unchanged but for the import path (`ui/src/grillTreeModel.ts` is byte-identical to the built-in's). |
| `website/src/apps/auto-research/{GrillTree.ariaExpanded,GrillTree.expandFocus,ResearchLabPage.reportToggle}.test.tsx`, `stateLabelKeys.test.ts` | `ui/tests/`, same names | Import paths; the label-key check reads this app's catalogs. The interface-language cases of `ResearchLabPageCoverage.test.tsx` switch the stand-in SDK's locale (`stubLocale`) instead of `i18next`. |
| (none) | `ui/tests/externalSeams.test.tsx` | Catalog coverage (a plural key carries the forms its locale names, so key sets are compared with the form stripped) and fallback, the scoped transport and its error mapping, the model list, the stream path, the clipboard fallback, the older-host `Select`. |

Core tests that use `auto-research` only as a sample app name or slot key
(governance, autonudge, slot sync, token auth and the others listed in
Kiro Crew's own inventory) stay in Kiro Crew with a neutral fixture.

## Wheel-copy changes since the snapshot

Every commit on KiroCrew `main` between `4bb268b4e9` and `6d07df11cf` that
touched the built-in's backend, page, strings or tests, and where it landed here:

| KiroCrew | Change | Here |
|---|---|---|
| #28167 | black-format `workflow_template.py` | `backend/workflow_template.py` |
| #28229 | test helper: the autonudge default through core's `_floor_monkeypatch` | not ported: that fixture is Kiro Crew's test floor; the helper keeps `monkeypatch` |
| #28567 | an emergent proposal with an odd priority no longer fails the round; the file is consumed only once the queue is saved | `campaign/exploration.py`, `subquestion_queue.py`, their tests |
| #28319 | watchdog test: removal order, bounded awaits, TTL clock | `tests/test_auto_research_watchdog.py` |
| #28676 | counts and labels translated inside catalog strings (`cycles_count`, `estimate`, `findings_tally`, `suggested_from_sub_questions`) | `ui/src/ResearchLabPage.tsx`, `ui/i18n/*.json`, `ui/tests/ResearchLabPageCoverage.test.tsx` |
| #28338 | core asks the `stopped_loop_tombstone` seam; page tests moved beside the page | `backend/seams.py` (gap 2), `ui/tests/stateLabelKeys.test.ts` |
| #29024 | shorter comments in `lifecycle.py` / `watchdog.py` | same files |
| #29224 | tests pin UTF-8 on text reads and writes | the three test files |
| #28529 | `save_queue` through `atomic_write` | `backend/subquestion_queue.py`, `_fs.atomic_write` |
| #30864 | trust expiry and disable clear the cached approval policy too | `campaign/watchdog.py`, `_host.revoke_slot_trust`, two tests |
| #31028 | the grill tree's collapse chevron reports `aria-expanded` | `ui/src/GrillTree.tsx`, `ui/tests/GrillTree.ariaExpanded.test.tsx` |
| #32046 | the report toggle is a disclosure (`aria-expanded`, `aria-controls`) | `ui/src/ResearchLabPage.tsx`, `ui/tests/ResearchLabPage.reportToggle.test.tsx` |
| #32650 | the campaigns database lives in `data/` | `campaign/storage.py`, `tests/test_auto_research_db_location.py` (gap 1) |
| #32774 | the execution-mode cards are a radio group | `ui/src/ResearchLabPage.tsx`, `ui/src/RadioChipGroup.tsx`, the wizard tests |
| #32528 | an import-budget deferral records why the source is pending | `campaign/publication.py`, `_host.PENDING_REASON_*` |
| #28661 | report exports are serialized per campaign, so one campaign gets one artifact | `campaign/publication.py`, `handlers.py`, its test |
| #32992 | the grill tree's Expand keeps focus while it runs | `ui/src/GrillTree.tsx`, `ui/tests/GrillTree.expandFocus.test.tsx` |

## What Kiro Crew keeps doing

The release that adds adoption still ships the built-in. A user's built-in
record moves onto this repository at the commit Kiro Crew pins, on the restart
after the tree is fetched and verified; a record that cannot move keeps running
the built-in copy, unchanged. For this app the pin also waits on the Kiro Crew
side of gap 1 (a swap-side refusal or carry for an old `campaigns.db`).

## Release handoff: one commit for both pins

The adoption pin and the catalog row must name the same commit, and that
commit must be the ported tree.

1. Call the full 40-hex SHA of this repository's `main` `C`
   (`git rev-parse HEAD`).
2. In the Kiro Crew release PR that adds adoption, once the Kiro Crew side of
   gap 1 has landed, run
   `python3 scripts/adoption_pin.py compute <this URL> C` and add the row it
   prints (commit, `treeSha256`, `archiveSha256`, `legacyNav`) to
   `src/kiro_crew/apps/adoption-pins.json`; then
   `python3 scripts/adoption_pin.py verify`. Until that row exists the release
   adopts nothing, and the catalog row must not switch.
3. The KiroCrewApps row for `auto-research` switches to `"type": "git"`, this
   URL, `"ref": "C"`. Never a branch name or a placeholder.
4. Check that both files name the same `C`, and that GitHub serves it: in a
   fresh clone, `git fetch origin C` succeeds and `git cat-file -t C` prints
   `commit`.
5. The catalog PR stays a draft, labelled hold-for-release, until the Kiro Crew
   release that ships adoption and the App Kit level-1 seams is published.
