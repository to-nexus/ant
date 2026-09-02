# Preview System

## Overview

The Preview system provides a live preview of generated code. It runs an independent Dev Server per feature, accessed from the browser through a unified proxy. Redis-based state management supports multi-pod environments.

## Key Structure

| Format | Purpose | Example |
|------|------|------|
| Internal Key (Redis) | Internal state management | `org:user:project:feature` |
| URL Key (HTTP, 4-part) | Single frontend / 4-part routing | `org--user--project--feature` |
| URL Key (HTTP, 5-part) | Multi-frontend packages / `ant-project` serviceName | `org--user--project--feature--apps-web` |

URL Keys use double dashes (`--`) instead of colons. `toUrlKey()` / `toUrlKeyWithService()` / `fromUrlKey()` / `parseUrlKey()` are the SSOT, all located in `packages/ant-cli/src/periphery/adapters/http/services/PreviewService/utils/serverKeyUtils.ts`. `fromUrlKey()` always converts only the first 4 segments into the internal key, and `parseUrlKey()` extracts the 5th segment as `serviceName`.

### Two Uses of the 5th Segment

The 5-part URL Key is used in the same format for two scenarios:

1. **Multi-frontend package access**: when a feature has 2 or more frontend packages, each package gets its own 5-part urlKey. One is the entry, but all the others must also be directly reachable at their own dev servers.
2. **`ant-project` service connections**: when calling a specific package of another feature (`@connection ... ant-project:{pid}:{feat}:{svc}`).

In both uses, the 5th segment **must be the slug produced by `packageSlug(name)`**. The proxy attempts an exact match on the slug only, so using the raw name (`apps/web`) as-is will not match. `PreviewServer.createDeployProxyMiddleware` / `previewProxy` normalize inputs with `packageSlug()` at ingress, so legacy inputs are auto-corrected.

### `packageSlug()` Rules (SSOT)

| Input | Output |
|------|------|
| `web` | `web` |
| `apps/web` | `apps-web` |
| `@scope/ui` | `scope-ui` |
| `apps_web` | `appsweb` (underscores are stripped) |
| `apps---web` | `apps-web` (consecutive hyphens collapsed) |
| Empty string | `pkg` |

Algorithm: slashes → `-`, strip anything other than alphanumerics/hyphens, collapse consecutive hyphens, trim both ends, fall back to `pkg` for an empty result. It guarantees `--` can never occur, so 5-part urlKey parsing never breaks.

### Slug Collision Handling

`PreviewService.assignPackageUrlIdentity` / `DeployService.assignDeployIdentity` receive the frontend package list all at once and decide the slugs. If an already-used slug appears again, it is deduped with single-hyphen suffixes `slug-2`, `slug-3`, … (`--` is never used). As a result, every frontend within a feature has a unique slug.

## Redis Key Separation

Preview state is stored in two independent Redis keys:

| Redis key | Purpose | Lifetime | Contained data |
|----------|------|------|------------|
| `PREVIEW` (`ant:infra:preview:{portKey}`) | Runtime state | Exists only while the preview is running. Deleted on `stopPreview` | running, phase, port, host, podId, packages, connections (w/ status), issues, restartRequired |
| `PREVIEW_CONFIG` (`ant:infra:preview-config:{portKey}`) | Derived cache | Retained after the preview stops (TTL) | connections (without status), structureType, projectProfile (with provenance tag) |

Design principles:
- `PREVIEW`: runtime-only. Connection `status` (active/unreachable/not-started) is stored here only.
- `PREVIEW_CONFIG`: **a derived cache, not an authority.** Connections are re-derived on every read from `.env.example` / `.env`, and projectProfile / structureType from the codebase manifests. Cached values only cover cross-pod reads and windows where the workspace is temporarily unavailable. **Runtime status is never stored.**
- The frontend merges connections only (`config.connections` base + status overlay from `previewStatus.connections`). projectProfile is **picked, not merged** — see the Project Profile section below.

## Host Separation

Preview uses a dedicated host (`ant-preview.example.com`). Even when a framework uses its native base path, some resources (`<img src="/logo.svg">`, etc.) are requested without the base path. With a dedicated host, host-based routing ensures those requests still reach ant-preview.

## Workspace Preview Lane (file editor HTML preview)

The content listener serves a third thing beside the preview and deploy proxies:
`GET /workspace/:ticket/*`, which hands one feature root to the browser as a
static site. It exists because the file editor's HTML preview used to browse a
mini site through `GET /api/.../files-raw/<path>` — a byte route whose contract
is one path → one file. A link to a folder came back as
`400 {"error":"Path is a directory, not a file"}`, rendered as raw JSON inside
the preview frame, and on a split-host deployment even a link to a valid file
was refused by that response's `frame-ancestors 'self'`.

Browsing a document is a static-host job, and it does not belong on the control
plane. So the lane reuses `createStaticApp` (directory index resolution, dotfile
403, realpath symlink containment) under a third fallback profile, `'none'`:
an artifact tree has no client-side routes, so an unmatched path 404s rather
than borrowing an unrelated `index.html`.

| Property | Value | Why |
|---|---|---|
| Credential | the ticket in the URL, nothing else | the content listener has no cookie-parser, and the content host may sit on a different registrable domain entirely |
| Scope | `{org, userId, projectId, feature}`, stored server-side | the served root comes from the STORED owner, never from the URL |
| Root | `{container}/artifacts` on a workspace project, else the feature root | the universal MERGED view grafts `sessions/**` in — that is job state, not an artifact |
| TTL | 30 min, not sliding | sliding would cost a Redis write per subresource |
| Methods | GET/HEAD; anything else 405 and never `next()` | a fall-through would become a new admission surface on the proxies behind it |
| Mount | before the preview proxy, deferred on a content host | the proxy claims the root, and under subdomain routing `/workspace` belongs to the user's own app |

The lane also overrides two headers helmet stamps on this listener
(`X-Frame-Options: SAMEORIGIN`, `Cross-Origin-Resource-Policy: same-origin`).
Both are correct for a deployed page opened in its own tab and wrong for the one
surface that exists to be embedded — so they are overridden on the lane, never by
loosening helmet for the whole listener.

Because the frame needs no cookie, the preview iframe drops `allow-same-origin`:
it runs at an opaque origin, so a script in an LLM-authored document reaches
neither the app, its cookies, nor its storage. `allow-same-origin` appears in no
branch, and `allow-popups` is unconditional — without it a `target="_blank"`
link dies silently on click. `resolveHtmlPreviewFrame` (ant-ui) is the single
owner of the flags.

### Two mounts, because browsing must not wait on an ingress

The lane is mounted twice under two header profiles. Containment, ticket
redemption and the served root are identical; only the headers differ.

| Profile | Mounted on | Scripts | What makes it safe |
|---|---|---|---|
| `content-origin` | the preview content listener | yes | a separate origin — the document has no reachable session |
| `control-plane-inert` | ant-api, at `/workspace` | **no** | every response carries the CSP `sandbox` directive |

The second mount exists because the first one's reachability is a *deployment*
fact, and for a while the preview asked a static frontend bundle about it
(`VITE_PREVIEW_CONTENT_HOST` → `hasDistinctContentOrigin()`). No cloud build ever
set that variable, so every cloud user silently got the pre-lane behaviour and a
link to a folder still rendered `400 {"error":"Path is a directory, not a file"}`
inside the frame. A fallback row that IS the defect is not a fallback.

So the question moved to the server: `POST .../files-preview-ticket` answers with
an absolute `baseUrl` and an `allowScripts` flag, derived from
`resolvePublicContentOrigin()` (`ANT_PREVIEW_CONTENT_ORIGIN`). The frontend
computes no part of it and has exactly one row. Where no content origin is
published the base points back at ant-api, and the inert profile serves it.

On that plane the lane shares an origin with a cookie-authenticated API, which is
normally forbidden (security-posture Axis 5). What buys the exception is the CSP
`sandbox` **directive**: the browser gives the response an opaque origin and
refuses to run its scripts — in a top-level tab as well as in an iframe — so the
document cannot drive that API with the viewer's session. That is an origin-model
change enforced by the browser, not a content filter. Two consequences worth
remembering:

- `'self'` must never appear in a fetch directive there. It resolves against the
  sandboxed document, which has no origin, so it would match nothing and the
  artifact would render unstyled. The directives name the real origin.
- The header is stamped before any branch can answer — a 401, 404 and 405 are
  documents too, and the ticket's holder may hand its URL to anyone.

The lane on ant-api is mounted before authentication and never calls `next()`,
so it reaches neither the JWT gate, the approval gate, the self-API scope guard
nor a body parser. Its only credential is the ticket: the frame is opaque and
sends no cookie, so a cookie gate there could only fail closed.

**Known limit:** a root-relative reference (`href="/x.css"`) drops the
`/workspace/:ticket` prefix — `<base>` does not affect absolute paths. This
predates the lane (under the byte-route base such a path resolved to the app
origin root). A per-ticket host label would fix it, but a 64-hex ticket exceeds
the 63-character DNS label limit and shortening it weakens the capability.

## Proxy Strategy

All frameworks use their native base path. The proxy operates on a single path.

### Main Path

1. Parse urlKey from the URL → `parseUrlKey()` → `{ tenantId, userId, projectId, feature, serviceName? }`
2. Look up `PreviewState` (host/port + `packages[]`) in Redis
3. Apply the routing precedence (table below) → determine the final `{targetPort, targetPath}`
4. Stream-pipe the response body (no transformation/rewriting)
5. Set the preview cookie (`Path=/{urlKey}`)

### Routing Precedence

| Precedence | Condition | targetPort | targetPath |
|---------|------|-----------|-----------|
| 1 | `/{urlKey}/api/*` (regardless of 4-part or 5-part) | Result of `getBackendPort()` | prefix stripped |
| 2-a | 5-part `serviceName` matches a frontend pkg.slug | that `pkg.port` | prefix kept (frontends have their own basePath) |
| 2-b | 5-part `serviceName` matches a backend/other pkg.slug | that `pkg.port` | prefix stripped (no basePath) |
| 2-c | 5-part `serviceName` matches no pkg.slug | fall through to (3) | fall through to (3) |
| 3 | 4-part urlKey, frontend exists | entry frontend port | prefix kept |
| 4 | No frontend (backend-only deploy, etc.) | entry port | prefix stripped |

`/api/*` always takes precedence over (2). User-created slugs are restricted to alphanumerics + hyphens, so they cannot collide with the literal `api` segment, and `/api/*` is a universal fullstack contract.

### Fallback Path

Requests without a urlKey (leaked resources):
1. Extract the urlKey from the Referer header
2. On failure: extract it from the `__ant_preview_sk` cookie
3. Prepend `/{urlKey}` and proxy

## Base Path Configuration

| Framework | Environment variable | Configured at |
|-----------|---------|----------|
| Vite (React/Vue) | `VITE_BASE_PATH` | `vite.config.ts` → `base` |
| Next.js | `NEXT_PUBLIC_BASE_PATH` | `next.config.js` → `basePath` |
| Common | `ANT_BASE_PATH` | Fallback for user code/plugins |

`ProcessSpawner` injects the environment variables automatically when spawning the Dev Server process. The injected value derives from `SpawnOptions.packageUrlKey` (SSOT): a single frontend gets the 4-part urlKey, while in multi-frontend setups each package gets its own 5-part urlKey. So even with multiple frontends, each package knows **only its own basePath**, and the proxy preserves the same 5-part prefix as-is (routing table precedence 2-a) to make it work.

## Project Configuration Validation (Validator)

Validates the proxy environment configuration at preview start.

| Validator | Checks |
|-----------|----------|
| ReactValidator | vite.config base + React Router basename |
| VueValidator | vite.config base + Vue Router base |
| NextValidator | next.config basePath + env var references |

On validation failure: stop the server → record issues in Redis → broadcast to the UI over SSE → show a Fix button in the UI → on Fix click, the suggestedFix is auto-inserted into chat.

### Multi-frontend Validation Scope

When `frontendCount > 1`, validators run not just for the entry frontend but for **every frontend package**. The entry fails with fatal severity, causing server shutdown, but non-entry package failures are downgraded to `severity: 'warning'` — reusing the same Fix UI while not blocking the other frontends from starting. Even in multi-frontend setups, users can immediately notice and fix a secondary package's wrong base path.

## Code Generation Guidance (Prevention)

Prompt templates steer the AI toward correct configuration:
- `preview-setup.md`: per-framework base path configuration principles
- `preview-env-contract.md`: platform runtime contract (env vars, port binding)

## Lifecycle

### State Transitions

```
idle -> installing -> starting -> running -> stopped
                        |           |
                        v           v
                      error <----- error
```

### Start Flow

1. POST /preview/projects/:id/start
2. Acquire distributed lock (Redis SET NX, TTL 120s)
3. Clean up stale registry (if leftovers from a previous run exist, clean them up including Docker infra)
4. Kill orphan processes
5. Register initial state in Redis (phase: installing)
6. Detect project structure
7. npm install
8. Start Docker infrastructure (docker compose up)
9. Connection status enrichment (docker running → status: active)
10. Start the Dev Server (`npm run dev --host 0.0.0.0`) — `spawnWithConflictRetry` watches each package for early exit during a 6s settling window
11. Register final state in Redis (running, connections, packages)
12. Validator checks
13. **Emit the status summary line** — `summarizePreviewSpawnOutcome(orderedPackages)` checks for packages that exited non-zero during the settling window:
    - If all are alive: `'✅ All preview servers started successfully!'` (stdout)
    - If some died: `'❌ Preview started with N failed package(s): <list>'` (stderr)
14. Health check (up to 60 seconds)

### Status Summary Line Contract (contract with the FE state machine)

The FE preview state machine ([packages/ant-ui/.../FeatureSection/utils/preview.ts](../../packages/ant-ui/src/presentation/components/FeatureSection/utils/preview.ts)) matches the `'All preview servers started'` substring in the log stream to transition package state to `'running'`. Because this line is gated to emit only when all packages are healthy, the FE does not incorrectly go to `'running'` in a partial-failure state where some packages died within the settling window (the per-package `'❌ <pkg> crashed within ${SETTLING_MS}ms (code N)'` lines are tracked separately by the FE). The SSOT for the emit decision is [`summarizePreviewSpawnOutcome`](../../packages/ant-cli/src/periphery/adapters/http/services/PreviewService/PreviewService.ts).

### Stop Flow

1. POST /preview/projects/:id/stop
2. Register in stoppingServers (to classify process exits as "expected")
3. Stop Docker infrastructure (docker compose down -v)
4. Kill app processes (SIGTERM → wait for exit → SIGKILL fallback)
5. **Port-based kill** (`lsof -i :port -t` → kill) — spawning with shell:true creates an `sh → make → go binary` tree, so killing only the shell leaves the actual binary holding the port. Directly kill the processes bound to each package port to guarantee OS-level port release.
6. Read connections from Redis + release all package ports (PortManager)
7. Delete the Redis PREVIEW key (unregisterPreview)
8. Clean up local state (previewServers, previewServerPaths)
9. SSE broadcast (including connections reset to not-started)

### Process Crash Flow (cleanupIfAllDead)

When all processes have exited unexpectedly:
1. Abort health check
2. Stop Docker infrastructure
3. Release ports
4. Reset connections to not-started in Redis, then updatePreview
5. updatePhase(error) → read full state from Redis and SSE-broadcast it (connections included)

### Graceful Shutdown (SIGTERM)

On pod termination: `PreviewServer.stop()` → `PreviewService.cleanup()` → call `stopPreview()` for every running preview.

### EFS File Watching

`inotify` does not work on EFS (NFS). `ProcessSpawner` solves this by automatically injecting `CHOKIDAR_USEPOLLING=true` and `WATCHPACK_POLLING=true` into Dev Server processes.

## Fullstack Support

```
/{urlKey}/        -> Frontend (entry port)
/{urlKey}/page    -> Frontend
/{urlKey}/api/*   -> Backend (backend port)
```

## Docker Infrastructure

`InfrastructureManager` detects and manages the project's docker-compose.yml.

### Project Isolation

Docker Compose project name: `ant-{projectId}-{feature}`. Containers of different preview instances never collide.

### Start (startInfrastructure)

1. Locate docker-compose.yml (yml, yaml, compose.yml, compose.yaml)
2. Check Docker availability (docker info)
3. Pre-cleanup: `docker compose down -v --remove-orphans` (remove leftovers from previous runs, best-effort)
4. `docker compose up -d --wait --quiet-pull --force-recreate --remove-orphans`
5. Timeout: 60 seconds. Even on failure, app process startup continues (best-effort)

### Stop (stopInfrastructure)

1. `docker compose down -v` (remove both containers and volumes)
2. Timeout: 30 seconds. Best-effort.

### Status Lookup (getInfraStatus)

`docker compose ps --format json` → returns per-service running/stopped/unhealthy status.

### Volume Strategy

The `-v` flag deletes volumes on every run. Since this is a development environment, a clean start is prioritized over data persistence.

## Service Connections

The "Service Connections" section of the Preview Config UI manages all external service dependencies of a project.

> This document covers **runtime connection detection and management**. For how those connections are **created** (production+mock adapter pairs) and how the toggle **guarantees** mock startup, see [38-service-virtualization.md](38-service-virtualization.md). The `@connection` syntax, toggle naming, and scanning are owned by the single SSOT `core/serviceVirtualization/connectionModel.ts`, which this system also consumes.

### Detection Mechanism

`ConnectionDetector` parses `@connection` annotations in `.env.example`:

```env
# @connection {category} {name}                              -- external service
# @connection {category} {name} self                         -- internal connection within the same project
# @connection {category} {name} ant-project:{pid}:{feat}     -- cross-project
# @connection {category} {name} ant-project:{pid}:{feat}:{svc} -- cross-project, specific service
```

- `self` keyword: references another package of the same project (fullstack FE→BE, intra-monorepo). The proxy path is computed automatically.
- `enrichWithCompose()`: upgrades an infrastructure connection's resolution to `docker` based on docker-compose.yml.

### Connection Status Lifecycle

Status values: `active` | `unreachable` | `not-started` | undefined

| Moment | Behavior | Stored in |
|------|------|----------|
| ConnectionDetector.detect() | Created without status | - |
| startPreview (infraStatus enrichment) | docker running → active | PREVIEW (runtime) |
| detect-connections API | Enriched with docker status, included in the response only | PREVIEW (runtime). Status excluded from PREVIEW_CONFIG |
| stopPreview | All connections → not-started | SSE broadcast |
| cleanupIfAllDead | All connections → not-started | PREVIEW (Redis update) → SSE broadcast |

Frontend merge rule (PreviewConfigEditor):
```
base = config.connections (PREVIEW_CONFIG, no status)
live = previewStatus.connections (PREVIEW/SSE, with status)
display = if live exists, overlay live.status onto base; otherwise base as-is
```

### Resolution Type Constraints

| Category | Allowed resolutions | Examples |
|---------|----------------|------|
| `infrastructure` | `url`, `docker` | DB, Redis, MQ |
| `business` | `url`, `ant-project` | API, MSA services |

### Per-package Scoping

Connections belong to a package via the `source` field. In a monorepo, each package has its own `.env.example`.

- Dedup key: `${source}:${envVar}` (the same envVar can coexist across different packages)
- Env injection: at spawn time, `ProcessSpawner` filters and injects only the connections matching that package's `source`
- Config UI: grouped per package, showing category badges (business/infrastructure) and resolution badges (url/docker/ant-project)

### Detection Timing

- **Auto detection**: when the Config Panel is first opened and the registry is empty, runs once and caches to Redis
- **Manual re-detection**: "Auto Detect" button → POST /detect-connections → filesystem re-scan
- **Preview Start**: reads only from the Redis registry (no detection run)
- **Auto refresh after code-job completion**: `CONNECTIONS_REFRESH` pub/sub → re-detect

The Auto-Detect button and the post-job `CONNECTIONS_REFRESH` subscriber share a
**single** implementation — `PreviewServer.refreshProjectFacts` — so the panel
after a job reflects the final code rather than a snapshot cached early in the
job. The channel constant keeps its name (cross-process contract); only the
handler's responsibility widened. The code is the SSOT for connection facts, so
re-detection overwrites the derived caches; user-entered **values** survive
because `syncEnvStructureFromExample` reconciles `.env` against `.env.example`
fill-if-absent and never clobbers an existing value. Deletion is never done here,
and detection failure is best-effort (yields `[]`, leaves the profile untouched).

## Project Profile (structure type / language / framework)

**The codebase is the SSOT.** Detection reads only manifests (`package.json` / `pnpm-workspace.yaml` / `go.mod` / `go.work` / `requirements.txt` / `pyproject.toml` / `Cargo.toml` / `pom.xml` / `build.gradle` / `Makefile`) — it never walks the source tree or `node_modules`, so it is cheap enough to run on every HTTP read. No separate fingerprint cache is kept (`PREVIEW_CONFIG` already caches).

| Layer | File | Responsibility |
|---|---|---|
| Manifest primitives | [`detectors/manifest/`](../../packages/ant-cli/src/periphery/adapters/http/services/PreviewService/detectors/manifest) | `readManifests` / `languageFromManifests` / `frameworkFromManifests` / `canStartFromManifests` — the single owner of the language·framework·runnability tables |
| Single owner | [`ProjectProfileDetector`](../../packages/ant-cli/src/periphery/adapters/http/services/PreviewService/detectors/ProjectProfileDetector.ts) | `detectFacts(root, fallback?)` → `{ structureType, profile, canStart, structure? }`. Returns `structure` back so callers do not re-run structure detection (1 filesystem pass per request) |
| Precedence | [`utils/projectFacts.ts`](../../packages/ant-cli/src/periphery/adapters/http/services/PreviewService/utils/projectFacts.ts) | `resolveProjectFacts` — shared by `GET /status` and `GET /preview-config`, so the two endpoints cannot diverge |
| Contract | [`@ant/shared/preview.ts`](../../packages/ant-shared/src/preview.ts) | `ProjectProfile` / `PreviewStructureType` / `isMoreAuthoritativeProfile` (rank rules shared by BE and FE) |

### Provenance Precedence

`manifest` ⟩ `techtier-hint` ⟩ none. A profile is an **atomic bundle**; there is no field-merge across provenances — if the manifest result has no framework, that means "there is no framework", and the hint's framework is never borrowed (the cause of chimeras like `language: go` + `framework: nextjs`).

- `techtier-hint` = the code job decompose's `<techTier>` inference. It is a **greenfield-only stand-in**; the moment code exists, the manifest wins. `PreviewBroadcaster` never publishes a provenance-less top-level `structureType` (it would resurrect via `||` fallback and mask the truth).
- The FE applies the rank rules in a single place, [`previewSlice.mergePreviewStatus`](../../packages/ant-ui/src/domain/store/slices/previewSlice.ts) (only strictly-lower-provenance patches are rejected; same-provenance is a fresher observation and is applied).

### Detection Timing

- **On every read**: both `GET /status` and `GET /preview-config` detect regardless of whether a preview is running. Only `canStart` is gated by busy (running/installing/starting).
- **After code-job completion / Auto Detect**: `refreshProjectFacts` refreshes the profile and structureType along with connections and pushes an SSE status patch (the `CONNECTIONS_REFRESH` channel constant is a cross-process contract, so the name stays — only the handler's responsibility has grown).
- **Preview Start**: the cached profile is passed only as a **fallback**, not as authority.

### Do Not Confuse with Other Axes

- `CodebaseAnalyzer` / `EnvironmentDetector` — the techTier **decision** axis. `SupportedLanguage = ['typescript','go']` is a closed enum that keys prompt basis partials, so leaking `python` selects a nonexistent partial.
- `BuildRunner.detectFramework` — a build-artifact / env-var-prefix classifier (`vite` → `VITE_`, `nextjs` → `NEXT_PUBLIC_`, `cra` → `REACT_APP_`). `vite` and `static` are not frameworks.

### Env Injection Precedence (ProcessSpawner)

The env passed to the dev server at `spawn` is composed with the following precedence (low → high). It is read only at start time, so applying saved changes requires a restart.

| Rank | Layer | Notes |
|---|---|---|
| 1 | `process.env` | System |
| 2 | **Mock toggle defaults** (`USE_MOCK_<NAME>=true`) | SV §6 — injected per-connection for every business connection. `.env` can override, so greenfield is mock-on and a user's `=false` means real |
| 3 | `.env` / `.env.local` | Project/package level |
| 4 | Connection values (`envVar=value`) | url=actual URL, ant-project=`/proxy-path` |
| 5 | Platform-enforced (`PORT`/`NODE_ENV`/polling/basePath) | Overrides `.env` |
| 6 | `extraEnv` | Caller override |

### Applying Changes (restart to apply)

Both the real↔virtual toggle (`PUT /virtualization-toggle`, written directly to `.env`) and connection config changes (`PUT /preview-config`, written to Redis) are persisted, but **a running dev server captured its env at spawn time**, so nothing takes effect until a re-spawn. Both handlers set `PreviewState.restartRequired=true` if a server is running, and the FE surfaces a "restart to apply" signal on the existing Restart control. `startPreview` restarts with fresh env and clears `restartRequired=false`. (No separate restart button — the existing Restart is reused.)

### Cross-Project / Internal Connections

- **Cross-project**: specify another project's projectId/feature in the `ant-project` resolution → the proxy path is computed automatically
- **Same-project (self)**: specify its own projectId/feature in the `ant-project` resolution → the internal proxy path is computed automatically. Declared in `.env.example` as `@connection business backend-api self`.
- **Multi-package serviceName**: additionally specifying a serviceName in the `ant-project` resolution routes to a specific package (service) of the target project. It is encoded as the 5th segment of the URL Key. The user-entered `serviceName` is normalized with `packageSlug()` at the producer (the preview-config response builder in `PreviewServer`) and baked into the 5-part urlKey. So even if you write `[serviceName=apps/web]`, the actual routing slug is `apps-web`, and it matches as long as that feature has registered its package under the same slug.

## Multi-Pod (K8s)

### Basic Principles

All state lives only in Redis (Single Source of Truth). Dev Servers listen on `0.0.0.0` so they are reachable from other pods. Whichever pod receives a request looks up the actual Dev Server pod IP in Redis and proxies to it. No sticky sessions required.

### Distributed Lock

Preview start is protected by a Redis distributed lock (SET NX, TTL 120s). Even if ALB round-robin delivers start requests for the same preview to multiple pods, only one executes.

### Process Ownership

A preview's actual processes exist only on the pod that executed start (in-memory: `previewServers`, `previewServerPaths`).

| Data | Stored in | On pod crash |
|--------|----------|-------------|
| ChildProcess handles | In-memory (`previewServers`) | Lost |
| Project paths | In-memory (`previewServerPaths`) | Lost |
| PreviewState (port, host, podId) | Redis (`PREVIEW`) | Survives (until TTL) |
| Preview Config (connections settings) | Redis (`PREVIEW_CONFIG`) | Survives (until TTL) |
| Docker containers | Pod-local Docker daemon | Left orphaned |

### Cross-Pod Stop Scenario

Due to ALB round-robin, a stop request may reach a pod other than the one that executed start:

1. The stop pod has no process in `previewServers`
2. Confirms `running=true` in Redis → proceeds with stop
3. No localPath in `previewServerPaths` → **cannot stop Docker infrastructure**
4. Cleans up only the Redis state (unregisterPreview)

To compensate, `startInfrastructure` includes a pre-cleanup. On the next start, stale Docker containers/volumes from the previous run are cleaned up automatically.

### Pod Crash / Rolling Update

1. SIGTERM received → `cleanup()` → `stopPreview()` for all previews (cleanup including Docker)
2. OOMKill/forced termination → cleanup not executed → Docker containers and Redis state left orphaned
3. Recovery: the next startPreview detects the stale registry → cleans up Docker infra + unregisterPreview

### Pod Index

A `PREVIEW_BY_POD:{podId}` Set tracks the previews per pod. Usable in pod cleanup tasks.

## Port Ranges

| Purpose | Range |
|------|------|
| Preview Dev Server | 30000-39999 |
| Cloud IDE | 40000-49999 |
| Deploy Static Server | 50000-54999 |

`PortManager` manages dynamic allocation.

## Deploy (Static Build Serving)

Deploy is a serving path separate from Preview. When the user clicks the "Deploy" button, the feature's production build runs and the artifacts are served by a static server. The URL takes the form `/deploy/{urlKey}/...` and is handled by a separate proxy middleware within the same `ant-preview` process.

Deploy follows the same multi-package model as Preview — sharing the slug SSOT (`packageSlug()`), 5-part urlKeys, the `packages[]` data model, and even the routing precedence. The only differences are (1) it serves static artifacts, and (2) `.deploy/meta.json` is the source of truth.

### Visibility (public / private)

Each deploy has `visibility: 'public' | 'private'` (default `public`, common to individual and team). It is persisted in `.deploy/meta.json` and `DeployState`, surviving rehydration. If `private`, the deploy proxy gates access — passing only when the owner `(tenantId,userId)` baked into the urlKey matches the JWT cookie's `org`/`sub`. A mismatch / missing cookie / invalid token returns a **404 byte-identical to a genuine not-found** (no 403 — prevents existence leakage). Local mode (no jwtService) is single-tenant and thus treated as owner-accessible. This applies symmetrically to both the HTTP proxy and the WS upgrade path. Full policy: [40-org-model.md](40-org-model.md).

### Phase Model

| Phase | Meaning | Process | Meta | Auto recovery |
|-------|------|---------|------|----------|
| `idle` | No deploy history | - | - | User deploys |
| `building` | `npm run build` in progress | Build process | - | - |
| `deploying` | Build done → static server starting (first deploy) | - | - | - |
| `running` | Serving normally | static server alive | meta.json exists | - |
| `hibernated` | Artifacts exist but no process | - | meta.json exists | Auto-start on URL access |
| `starting` | Lazy re-hydration in progress | spawn in progress | meta.json exists | - |
| `unavailable` | No artifacts either | - | - | User redeploys |
| `error` | Build/serving failure | - | Uncertain | User redeploys |
| `stopped` | Stopped by the user | - | Deleted | User redeploys |

### Death Paths

With multiple packages, `activeDeploys[key]` is an array of N `StaticServerHandle`s. Death/recovery paths all apply per package.

| Path | Trigger | Result | Recovery |
|------|-------|------|------|
| Pod rolling update | On `ant-preview` deployment (`main/dev/ci/*` push) | All packages' `activeDeploys` handles + static server processes lost | `cleanupStaleDeploys()` at startup transitions `pkg.phase: running→hibernated` (or `error`) |
| Process crash / OOM | Only a specific package's static server child dies | Redis entry remains but fetches to that package fail | On fetch failure the proxy marks `hibernated` + retries `ensureRunning` once |
| Idle eviction | `ANT_DEPLOY_IDLE_TTL_MS` exceeded | `startIdleEviction` cleans up **all packages'** handles + releases each package's port + broadcasts phase `hibernated` | On URL access, `ensureRunning` restarts all packages |
| Redis TTL expiry | 7 days without access | Redis entry deleted | If meta.json remains, `ensureRunning` re-registers all packages |

### Lazy Re-hydration

Since EFS `/mnt/workspaces` is ReadWriteMany, each `pkg.buildOutputDir` survives pod replacement. Recovery is possible by just restarting the static server, without rebuilding.

```
Browser → /deploy/{urlKey}/*  or  /deploy/{urlKey}--{slug}/*
  PreviewServer.createDeployProxyMiddleware
    → parseUrlKey() → {projectId, feature, serviceName?}
    → DeployService.ensureRunning()
        1) Check Redis + activeDeploys → on hit, proxy as-is
        2) On miss, acquire a per-key in-memory lock
        3) Read workspacePath/.deploy/meta.json (v1 is auto-lifted to v2)
           - if absent: phase='unavailable' broadcast → 404
           - if present: phase='starting' broadcast
        4) Iterate all meta.packages[]: allocate a port + startStaticServer per package
        5) registerDeploy + phase='running' broadcast
    → resolvePackagePort: serviceName(slug) match → that package's port. No match/4-part → entry pkg port.
    → fetch → on success touchDeploy (refresh lastAccessedAt + TTL)
    → on failure: update phase='hibernated' + retry ensureRunning once → if still failing, phase='unavailable' + 502
```

### Multi-package Deploy

`DeployService.startDeploy` reuses `ProjectStructureDetector` to find all frontend packages and assigns slugs/urlKeys via `assignDeployIdentity`. Each package gets its own port, and build/static server startup runs **serially** per package. A package whose build fails gets `error` only for its own phase; the rest proceed.

| Item | Single package | Multi-package |
|------|-------------|-------------|
| URL Key | 4-part `{urlKey}` | 5-part `{urlKey}--{slug}` per package |
| basePath | `/deploy/{4-part}` | `/deploy/{5-part}` (per package) |
| Ports | 1 | N (one per package) |
| Top-level `status.url` | that url | `null` (FE uses `packages[].url`) |
| `aggregatePhase` | package phase as-is | error first → building → deploying → starting → all-running, etc. |

The FE receives `DeployStatus.packages[]` and renders a per-package "Open" button. Single-package deploys keep the existing single-button UX.

### Persistent Store: `.deploy/meta.json` (v2)

`workspacePath/.deploy/meta.json` holds everything needed for restart. Redis is only a cache; meta.json is the **source of truth**.

```json
{
  "version": 2,
  "tenantId": "...",
  "userId": "...",
  "projectId": "...",
  "feature": "...",
  "workspacePath": "/mnt/workspaces/.../codebase",
  "packages": [
    {
      "name": "apps/web",
      "slug": "apps-web",
      "framework": "nextjs",
      "workspacePath": "/mnt/workspaces/.../codebase/apps/web",
      "buildOutputDir": "/mnt/workspaces/.../codebase/apps/web/.next",
      "basePath": "/deploy/{urlKey}--apps-web",
      "urlKey": "{urlKey}--apps-web"
    }
  ],
  "createdAt": "...",
  "updatedAt": "..."
}
```

`DeployMetaStore.write` writes to a tmp file and swaps it in with an atomic rename. `stopDeploy` deletes meta.json. `ensureRunning` separately verifies that each `pkg.buildOutputDir` actually exists even when meta.json is present — if not, it transitions to `unavailable` and removes the meta as well.

#### v1 → v2 In-memory Auto-lift

Existing single-package deploys are stored as `version: 1`. When `DeployMetaStore.read()` reads a v1, it converts it to v2 shape in memory and returns that (the disk stays v1). The slug is fixed to `'root'` — a v1 is by definition single-package, so no collision is possible. On the next `write()`, it is overwritten as v2, completing the forward-only migration.

### Per-feature UI State Separation

The frontend's `deploySlice` is structured as `Record<featureKey, PerFeatureDeployState>`, with `featureKey = "${projectId}:${featureName}"`. Switching features keeps each feature's `status/logs/isLoading` independent, so **another feature's build logs never bleed through**.

The SSE handler has a double safety net:
1. The EventSource URL of `SSEManager.connect(projectId, feature)` reconnects per feature, so the server already filters per feature.
2. Additionally, the handler callback compares against `selectedProject/Feature` to block transitional events.

Also, when tab focus returns (`visibilitychange`), `getDeployStatus` is called to correct a stale `running` (the pod may have restarted or been idle-evicted).

### Environment Variables

| Variable | Default | Description |
|------|--------|------|
| `ANT_DEPLOY_IDLE_TTL_MS` | `86400000` (24 hours) | If no traffic for this duration, only the static server process is cleaned up and the phase transitions to 'hibernated' |

## Boundaries

- Redis state conventions: [02-infrastructure.md](02-infrastructure.md)
- Prompt templates: [13-prompt-system.md](13-prompt-system.md)
- Cloud IDE: [23-cloud-ide.md](23-cloud-ide.md)
