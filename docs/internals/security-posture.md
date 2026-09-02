# Security Posture — SSOT

> **Why this file exists.** Reacting to scanner findings one at a time bakes
> in wrong designs. This document is the **single source of truth for the
> security standard ANT holds itself to**, so hardening work lands on a
> stated baseline rather than ad-hoc patches.

The posture has **seven axes**. Each names the invariant, the SSOT location, and
the current enforcement state (✅ enforced / 🔄 remediation in progress /
📋 documented policy only).

> **Point-in-time sweeps** against this standard are tracked privately, not in
> this repository. A sweep enumerates findings — including ones not yet
> remediated — so publishing it would hand an attacker a roadmap. This file
> records the durable standard; the sweeps record transient state.

---

## Axis 1 — Secrets

- **No secrets in git.** `packages/ant-cli/.env` (and any real key-bearing env)
  is `.gitignore`d. The only tracked `.env*` files are client build-time
  configs (`packages/ant-ui/.env.{development,production}`,
  `packages/ant-site/.env.{development,production}`) containing **only** public
  bundled vars (`VITE_*` / `NEXT_PUBLIC_*`) and public hostnames — **zero
  secrets**. `.env.example.*` are placeholders.
- **Encryption.** Stored credentials use `ANT_ENCRYPTION_KEY` (AES-256-GCM,
  [CredentialsStore.ts](../../packages/ant-cli/src/utils/userConfig/CredentialsStore.ts)).
  The key must never be committed. 🔄 When the env var is set but the value is
  not a valid 32-byte hex key, the store **must fail-fast** (no silent fallback
  to a file/random key).
- **Scanning.** gitleaks runs in CI on both the working tree (`gitleaks dir .`)
  and the **HEAD git history** (`gitleaks git . --log-opts="HEAD"`), config in
  [.gitleaks.toml](../../.gitleaks.toml). The allowlist excludes deps/build/
  local-only trees and two self-evidently fake test fixtures — **never** real
  secrets. ✅ enforced ([ci.yml](../../.github/workflows/ci.yml) `oss-guard`).
- **Rotation** of leaked local dev keys is user housekeeping; the in-tree
  history has been purged and the HEAD-history scan keeps it clean.

## Axis 2 — Dependency policy

- **Runtime-first bump.** Vulnerabilities in runtime/production dependencies
  (e.g. js-yaml, body-parser, qs, mermaid → DOMPurify, handlebars, ws,
  path-to-regexp) are remediated by version bump or pnpm `overrides`
  **before** dev-only ones.
- **Dev-only acceptance.** Dev/build-time-only advisories (vite/vitest/esbuild/
  rollup) are bumped if safe; if a safe bump breaks the build they are
  **audit-ignored with a documented rationale** rather than force-upgraded.
- **SSOT for accepted advisories** = the `overrides:` block (runtime fixes) +
  the `auditConfig.ignoreGhsas:` block (accepted dev-only GHSAs, one inline
  comment each) in [pnpm-workspace.yaml](../../pnpm-workspace.yaml), **plus** the
  narrative here. Do not scatter audit-ignore rationale across multiple files.
- **`overrides:` has a downstream mirror.** pnpm 11 honors `overrides` only at
  the *resolving* workspace root. The cloud distribution consumes this repo as
  a submodule, where this file is inert — so every entry in `overrides:` must
  also exist, byte-identical, in that workspace's own root. Raising a pin here
  alone changes nothing downstream, and the failure is silent: a stale root
  override outranks the importer specifier, so the downstream lockfile keeps
  resolving the vulnerable version while `--frozen-lockfile` still passes.
  Authoring stays ant-first; the mirror is applied automatically at submodule
  bump and asserted by a gate there. Add the rationale comment above the pin —
  it travels with the entry.
- **State (2026-06-30, P3).** `pnpm audit` exits clean (runtime vulns = 0).
  Runtime fixes applied: js-yaml/uuid (ant-cli) + mermaid/yaml (ant-ui) bumped;
  body-parser/qs/follow-redirects/mdast-util-to-hast/dompurify/ip-address/uuid/
  brace-expansion(2.0.x)/postcss/shell-quote/@babel/core/rollup pinned via
  `overrides`. Accepted dev-only residuals (7 GHSAs, all vite/vitest/esbuild
  dev-server or build-tool, unreachable in CI/prod) are listed in
  `auditConfig.ignoreGhsas`; closing them needs a vite 5→6 major on ant-ui
  (breaking), deferred. **`vitest` is pinned `~4.0.18`** (NOT `^`) because 4.1+
  requires vite 6's `module-runner` export and breaks ant-ui's vite-5 test run —
  re-widen only together with the vite 6 upgrade.
- **Native-binary build gate.** pnpm `postinstall` scripts are blocked by
  default; the whitelist is `allowBuilds:` in
  [pnpm-workspace.yaml](../../pnpm-workspace.yaml) (`@vscode/ripgrep`/`sharp`
  = true, build-time/transitive = false). Docker builds must **never** pass
  `--ignore-scripts` (it overrides the whitelist and silently skips ripgrep's
  binary download). See CLAUDE.md "Native-Binary Dependencies".

## Axis 3 — CI scanning gates

- **Current.** gitleaks dir-scan + HEAD-history-scan (✅,
  [ci.yml](../../.github/workflows/ci.yml)). OSS-purity guards (no static
  `@ant/cloud` import, no cloud overlay source in the OSS tree, no cloud chunk
  in the OSS UI build) double as a supply-chain boundary.
- **Planned additions**: Trivy (image/dep CVE), Checkov (IaC), actionlint
  (workflow lint), pnpm audit, SAST. As these are wired into CI they extend
  this axis; each new gate must be **fail-closed** (`--exit-code 1`).

## Axis 4 — Container / K8s hardening standard

- **Non-root.** Runtime images run as a non-root user (✅ nginx hardening on the
  serving image). 🔄 `docker-compose` root + `docker.sock` mount is accepted for
  **local dev only**; production runs non-root.
- **Image pinning.** Base images are pinned by **digest** (`@sha256:…`), not a
  floating tag. 🔄 [Dockerfile.ide](../../packages/ant-cli/Dockerfile.ide)
  (`gitpod/openvscode-server`) is the remaining floating tag.
- **No build-time secret echo.** Dockerfiles must not `cat` env files into build
  logs (🔄). `.dockerignore` excludes `.git`/`node_modules`/`.env*`/
  `tests`/`dist` (🔄).
- **Pod security.** IDE pods set a `securityContext`
  (`runAsNonRoot:true`/`runAsUser:1000`/`allowPrivilegeEscalation:false`/
  `capabilities.drop:['ALL']`) and `automountServiceAccountToken:false` (🔄,
  [KubernetesIDEOrchestrator.ts](../../packages/ant-cli/src/infrastructure/ide/KubernetesIDEOrchestrator.ts)).
- **NetworkPolicy / RBAC / PodSecurity** for IDE pods (shell egress to Redis/DB/
  metadata `169.254.169.254`/other pods) is **cloud-infra IaC** owned by the
  deployment operator, out of this repo's scope.

## Axis 5 — Auth / tenant model

- **JWT in cloud mode; single trusted tenant in local mode.** Cloud mode
  authenticates every request and resolves `(org, user)` from the JWT — `user.id`
  is the full lowercased email, scoped under an `org` (see
  [40-org-model.md](40-org-model.md)). **Local mode installs no HTTP auth
  middleware at all** (`ServerConfigurator.setupAuthentication` early-returns)
  and resolves the single `local:local` tenant; anything that can reach the port
  acts as that tenant. That is deliberate — local mode is a single-developer
  trust boundary — but it means a finding scoped to "authenticated user" is a
  **cloud-profile** finding, and this repo ships that profile
  (`docker-compose.cloud.yml`, [self-host.md](../cloud-mode/self-host.md)).
- **Cross-tenant guards are explicit, per jobId-addressed route.** ✅
  `assertJobAccess` on status / queue-position / stop / resume / continue /
  dismiss / workflow REST / workflow SSE. Adding a jobId-addressed route means
  adding the guard — the gate is not inherited from the router.
- **Proxy ownership gate (CRITICAL standard).** Every proxy surface
  (`/ide/`, `/preview/`, `/deploy/`) keyed by an **enumerable**
  `tenant:user:project:feature` urlKey MUST verify the JWT **and** assert
  ownership (`payload.org === parts.tenantId && payload.sub === parts.userId`)
  — JWT validity alone is insufficient because urlKeys are guessable, not random
  capabilities. The `/deploy/` proxy
  ([deployProxy.ts](../../packages/ant-cli/src/periphery/adapters/http/middleware/deployProxy.ts))
  is the **reference implementation**; IDE and Preview are 🔄 remediation
  targets. Public deploy access is the only intentional open path
  (visibility-gated).
- **A non-ambient capability, not a guessable key, admits the content origin.**
  ✅ The workspace preview lane (`GET /workspace/:ticket/*` on the ant-preview
  CONTENT listener) is the counter-example to the rule above and deliberately so:
  it is keyed by a random 32-byte ticket rather than an enumerable urlKey,
  because the listener that serves it has no cookie-parser and the content host
  may sit outside the session cookie's domain entirely. Redemption therefore
  returns the owner instead of comparing against a verified payload — there is
  nothing to compare against, and "check the cookie if one happens to be present"
  fails open. The served root is resolved from the STORED owner, never from the
  URL. It shares its primitive (`navTicket.ts`) with the `/ide/*` nav ticket, and
  the scope prefix is what stops one being spent on the other.
  The same property is what lets the preview iframe drop `allow-same-origin`:
  with no cookie to restore, the frame runs opaque, so `allow-scripts` grants an
  LLM-authored document nothing. The two flags must never be combined — the
  entry document is a blob and carries the app origin.
  This is also why `files-raw` serves HTML as `attachment` alongside SVG:
  browsing a document is a static-host job, and the byte route is not it.
- **One narrow exception to the origin split, bought by CSP `sandbox`.** ✅ The
  same lane is ALSO mounted on ant-api, whose origin answers a
  cookie-authenticated control plane. That is normally the forbidden shape
  (below), and the exception is deliberate and bounded, because the alternative
  was worse: gating the lane on "does this deployment publish a content origin?"
  left every deployment without one — the cloud included — silently running the
  pre-lane code path, where a link to a folder rendered
  `400 {"error":"Path is a directory, not a file"}` inside the preview. A
  fallback row that is itself the defect is not a fallback.
  What makes the exception hold is the CSP `sandbox` **directive**, stamped on
  every response of the `control-plane-inert` profile: the browser gives the
  document an opaque origin and refuses to script it, in a top-level tab as well
  as in an iframe, so it cannot drive that API with the viewer's session. This is
  an origin-model change enforced by the browser, NOT the SVG/HTML filter or
  blanket CSP the rule below rejects — those leave the sink open.
  Four properties are load-bearing and each has a guard
  (`tests/preview/workspacePreviewLane.test.ts`,
  `tests/policy/resource-admission.test.ts`):
  1. The header is stamped BEFORE any branch can answer — 401/404/405 are
     documents too, and the ticket's holder may hand its URL to anyone, so the
     header must never be conditional.
  2. No fetch directive spells `'self'`. It resolves against the sandboxed
     document, which has no origin, so it matches nothing and the artifact would
     render unstyled; the directives name the real origin instead.
  3. The mount sits before authentication and never calls `next()`, so it reaches
     neither the JWT gate, the approval gate, the self-API scope guard, nor a
     body parser. Its credential is the ticket — the frame is opaque and sends no
     cookie, so a cookie gate there could only fail closed.
  4. Only the inert profile is mounted there. Scripting follows the origin, and
     the mint answers `allowScripts: false` to match, so the frontend cannot
     promise what the browser will refuse.
  Still forbidden, unchanged: mounting a control-plane ROUTE on the content
  listener, and serving user content from any cookie-authenticated surface that
  does not carry this directive.
- **A user-authored upstream never receives platform credentials.** ✅ Both the
  HTTP proxy (`buildCleanHeaders`) and the WebSocket upgrade
  (`rewriteUpgradeHeaders`) strip the platform session cookie and a *verifiable*
  platform bearer before replaying to a dev server, while keeping the app's own
  cookies and handshake headers. The peer-forward hop deliberately keeps them —
  its upstream is an owner replica that re-verifies ownership.
- **Service secrets are scoped to the processes that consume them.** ✅
  `docker-compose.cloud.yml` grants OAuth/admin secrets to `ant-api` only, and
  session key material only to the processes that need it.
- **Session VERIFICATION authority never implies SIGNING authority.** ✅
  Sessions are ES256 only — a symmetric algorithm would let any verifier mint,
  and `ant-preview` spawns user-authored install/dev commands under its own UID,
  whose environment is readable from user code via `/proc`; with a symmetric
  secret that would be platform-wide session forgery. `ant-api` holds
  `ANT_JWT_PRIVATE_KEY`, every verifier holds only `ANT_JWT_PUBLIC_KEY`, and the
  header `alg` is pinned so nothing else (including `none`) verifies
  ([JwtService.ts](../../packages/ant-cli/src/infrastructure/auth/JwtService.ts)).
  `assertJwtAuthorityScope` **refuses to boot** a process whose key material
  exceeds its role: `'verify'` (ant-realtime), `'verify-usercode'` (ant-preview —
  additionally requires `ANT_JWT_PUBLIC_KEY`), and `'none'` (ant-job — no JWT
  material at all). Guard: `tests/auth/jwt-algorithm-authority.test.ts`.
- **User-authored children run under their own OS identity.** 🔄 `childEnv`
  decides what a child can SEE; it cannot stop a same-UID child reading
  `/proc/<service-pid>/environ` or re-linking directory entries the service is
  about to write through. `childSpawnIdentity()`
  ([childIdentity.ts](../../packages/ant-cli/src/core/config/childIdentity.ts))
  is applied at every user-authored spawn (preview dev servers, dependency
  installs, provisioning, deploy builds, static servers, `run_command`), and the
  images (OSS `packages/ant-cli/Dockerfile` AND ant-cloud `Dockerfile.cli`)
  provision an unprivileged `ant-child` account. Whether the drop is *permitted*
  is a deployment fact (an effective `CAP_SETUID`), probed once and cached.
  Cloud mode (`ANT_SERVER_MODE=cloud`) is **fail-closed**:
  `assertUserCodeIsolationOrThrow` refuses every user-authored spawn unless
  `ANT_CHILD_UID` is set, differs from the service UID, and the drop probe
  succeeds — so a cloud deployment MUST set `ANT_CHILD_UID` (and typically
  `ANT_CHILD_GID`) on the job-worker and preview pods and grant them the
  UID-change privilege, or `run_command`/preview/deploy are dead on arrival
  (zinc-bracing-gavel). Local mode is a single-developer trust boundary and
  skips the gate.
- **User CONTENT and the CONTROL PLANE are different browser origins.** ✅
  ant-preview serves attacker-authorable documents (a public deploy's build
  output, a user's dev server) and a cookie-authenticated `/projects/*` API that
  can write a feature's `.env`. On one origin, script in such a document runs
  same-origin with that API and drives it with the viewer's session — a
  browser-origin sink no CSP or content filter closes. Content is therefore its
  own listener (`ANT_PREVIEW_CONTENT_PORT`) with no control-plane route mounted,
  `isSelfOrigin` compares FULL origins (scheme+host+port), and
  `createSameOriginGuard()` refuses cross-origin cookie-authenticated state
  changes on all three servers. Publishing the two listeners under different
  hostnames is the deployment's half (`docs/infra/preview-content-origin-request.md`
  in ant-cloud). Guards: `tests/http/preview-origin-split.test.ts`,
  `tests/http/same-origin-guard.test.ts`.
- **A cookie is not the only credential — a navigation needs a non-ambient one.**
  ✅ The `/ide/*` proxy forwards ambient-cookie requests to a user's file and
  terminal upstream, so its gate covers every method and the WS upgrade, and
  refuses `same-site` (H-013). An iframe's document navigation sends no `Origin`
  and reads `same-site` in a split-host deployment, exactly like attacker
  content — so it is admitted by a short-lived capability minted through a
  CSRF-guarded POST, never by relaxing the origin predicate. Admitting
  navigations on `Sec-Fetch-Mode`/`Sec-Fetch-Dest` would readmit the H-013 source
  and is pinned shut by a tombstone test.
  ([23-cloud-ide.md](23-cloud-ide.md#admission--three-lanes-then-ownership)).
  Guards: `tests/http/ide-gate-admission.test.ts`, `tests/http/same-origin-guard.test.ts`.
- **A credential is scoped to the step that needs it.** ✅ A user's GitHub PAT
  reaches only the credentialed, `--ignore-scripts` dependency-FETCH pass; the
  lifecycle pass that runs dependency-authored code re-runs the same install
  without it ([DependencyInstaller.ts](../../packages/ant-cli/src/periphery/adapters/http/services/PreviewService/managers/DependencyInstaller.ts)).
  Python/Rust/Java installs never receive it at all — `GIT_CONFIG_*` does not
  help them resolve, and their build files are user-authored code.
  Guard: `tests/preview/installCommand.test.ts`.
- **Workspace filesystem isolation.** ✅ EFS `subPath` + `assertWorkspacePathInBase`/
  `stripBase` throw on any path outside the tenant base
  ([20-workspace-isolation.md](20-workspace-isolation.md)).
- **CORS.** `ANT_CORS_ORIGINS=*` is **opt-in OFF by default** and **forbidden in
  production** ([corsConfig.ts](../../packages/ant-cli/src/periphery/adapters/http/middleware/corsConfig.ts)).
- **Threat model notes.** `run_command` chaining is bounded by an allowlist with
  an intentional `ANT_UNSAFE_*` escape hatch (accepted). Multi-org/user
  detection emits a one-shot `logger.warn`. Local mode assumes a
  single-developer trust boundary.

## Axis 6 — Path resolution is bound to the file object, not to a name

`pathContainment` answers "may this path be touched", and that verdict is about a
**name**. A name can be repointed the instant after it is checked, and every
consumer that validated a path and then re-opened it by name carried the same
TOCTOU — with a same-UID, same-workspace preview child as a realistic actor.

- **One SSOT.** `core/config/containedIo` canonicalises, containment-checks the
  canonical path, then walks it one component at a time, each hop opened
  `O_NOFOLLOW` relative to the previous hop's descriptor (Linux
  `/proc/self/fd/<fd>/<name>`, the userspace equivalent of `openat(2)`).
  Canonicalising first keeps legitimate in-root symlinks working; the descent
  refuses anything repointed after the check. ✅
- **Every sink goes through it.** RAC artifact loading, the codebase indexer,
  `FileSystemAdapter` read/write (whose bytes reach a model prompt), upload writes
  (`writeBufferVerified`, which now REQUIRES a containment root), and the preview
  connection `.env` writers. ✅
- **What it does not close.** Hardlinks, and non-Linux hosts (where the descent
  degrades to final-component protection). The threat model is the multi-tenant
  Linux pod; CI is `ubuntu-latest`, so the enforcing branch is the one under test.
- **Do not** add repeated `realpath()` re-checks or a process-local mutex as a
  substitute: the former leaves the window, the latter does not span pods.
- Guard: `tests/security/contained-io-descent.test.ts`.

## Axis 7 — Cost is authorized, not just ownership

An endpoint that proves WHOSE data it is has not bounded how much WORK it is. A
single authenticated account could hold multipart buffers, recursive tree scans
and ZIP streams open in parallel and saturate a shared pod while every per-request
check passed.

- **Atomic admission.** Budgets are counted and reserved in ONE step —
  `StateStorePort.reserveSlot` (a Redis ZSET + Lua: prune, count, add). A
  `SCAN`-then-`SETEX` shape admitted N concurrent callers past an N-1 limit. ✅
- **Two gates per expensive route:** a Redis-backed per-account request rate
  (`rateLimiter`) and a cluster-wide in-flight semaphore
  (`core/redis/concurrencySlot`). A process-local `Map` bounds one replica; the
  same account's requests land on all of them. ✅
- **Enumeration is charged as it is read.** `readdirSync(...).filter().sort()`
  bounds the RESPONSE, never the work; the walk uses `opendirSync`/`readSync` and
  charges the budget per raw `Dirent`, hidden entries included. ✅
- **Refusals are explicit.** A truncated result says so — including at the
  response root, where no node can carry the flag — and an over-budget archive
  returns `DIRECTORY_DOWNLOAD_LIMIT_EXCEEDED` rather than a silent partial ZIP. ✅
- **Bodies are bounded before they are buffered.** `boundedMultipart` refuses on
  `Content-Length` when present and on the actual stream when it is not (a chunked
  body declares no length), interposing the counter by wrapping `pipe` so multer
  stays the only consumer. ✅
- **A pod ceiling is not a division of it.** One account holding
  `maxInFlight` chunked uploads reserved the whole replica budget and 429'd
  everyone else while staying inside its own allowance, so the reservation is
  also split per account, sized so one maximum request always fits. ✅
- **Every durable-write ingress carries a rate limit AND a body schema**, enforced
  as a SET over the router rather than a list of remembered routes — `chat/job-error`
  slipped through precisely because the previous guard enumerated. A field that
  lands in a JSONL line is capped on its SERIALIZED form, since that is what gets
  written. ✅
- **A per-item cap is not a per-request bound.** 5,000 files × 8 MiB each is not a
  budget; job-history aggregation charges cumulative runs and cumulative parsed
  bytes, and says `truncated` when it stops. Growth on the append side is a
  RETENTION policy, not a refusal: JSONL logs trim back to the readers' window,
  which is observably lossless because nothing past it was ever readable. ✅
- **The walk is charged, and running out is not an error.** Folder compression
  spends one entry+depth budget across every root; exhausting it degrades to less
  compression rather than failing a request that would otherwise have worked. ✅
- **Adoption is enforced in TYPE space; greps guard only what the compiler cannot
  see.** Four rounds of the same finding (M-NEW-029) shipped a correct primitive
  with a name-keyed adoption guard — literal paths, then call names, then variable
  names — and each round a differently-spelled caller passed it: a name is
  re-spellable by construction. The only budget axis that never recurred
  (pipeline path validation, `core/pipelines/paths.ts`) put the check in a
  typed helper chokepoint callers cannot spell around. `actionMetadata` now
  follows that form: `boundActionMetadata()` is the single mint of the branded
  `BoundedActionMetadata`, every consumer between an ingress and a
  durable/broadcast/env sink requires the brand (compile-time), and the three
  `any` trust boundaries — HTTP `req.body` (the shared schema's `.transform()`
  mints), pre-spawn env serialization (`JobWorker` measures), child env
  deserialization (`job-runner` re-bounds) — each keep a runtime re-check on the
  same helper. An open-shaped (`.passthrough()`) object is budgeted on its WHOLE
  serialized size, never by field enumeration — an unknown field is outside a
  field-cap model by definition. ✅
- **A single durable line stays inside the reader window.** The retention rule
  above ("append growth is retention, not refusal") assumed every line is smaller
  than the window; a line past it blanks the tail read (zero complete lines) so
  retention could never trim it and every reader served an empty log. The append
  seam refuses one line over `JSONL_LINE_MAX_BYTES` (half the window — the sole
  refusal that is observably lossless, since such a line was never readable), the
  refusal also suppresses the SSE echo, and a pre-cap polluted file heals via a
  streaming pass that drops oversized lines without materialising them. ✅
- Guards: `tests/http/resource-admission.test.ts`,
  `tests/policy/resource-admission.test.ts`,
  `tests/policy/contained-io-adoption.test.ts` (seam/brand adoption),
  `tests/security/session-namespace-bounds.test.ts`,
  `tests/core/context/actionMetadataBudget.test.ts`,
  `tests/core/context/compressPathsByFolder.test.ts`,
  `tests/state/sse-slot-atomicity.test.ts`.

---

## Out of scope / accepted (rationale recorded, no action)

- OAuth secrets via K8s env-var (standard; file-mount is a deployment follow-up).
- `docker-compose` root + `docker.sock` (local dev only; prod is non-root).
- ant `ant/` submodule SHA pin in ant-cloud (already correct).
- Scanner-only reports without a working PoC (see [SECURITY.md](../../SECURITY.md)
  "Out of Scope").
