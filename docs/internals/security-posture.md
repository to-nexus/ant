# Security Posture — SSOT

> **Why this file exists.** Reacting to scanner findings one at a time bakes
> in wrong designs. This document is the **single source of truth for the
> security standard ANT holds itself to**, so hardening work lands on a
> stated baseline rather than ad-hoc patches.

The posture has **five axes**. Each names the invariant, the SSOT location, and
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

- **JWT everywhere.** Authentication is always enforced (never skipped by mode);
  local mode uses the `local:local` tenant, not "skip auth". Cloud `user.id` is
  the full lowercased email, scoped under an `org` (see
  [40-org-model.md](40-org-model.md)).
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
- **Workspace filesystem isolation.** ✅ EFS `subPath` + `assertWorkspacePathInBase`/
  `stripBase` throw on any path outside the tenant base
  ([20-workspace-isolation.md](20-workspace-isolation.md)).
- **CORS.** `ANT_CORS_ORIGINS=*` is **opt-in OFF by default** and **forbidden in
  production** ([corsConfig.ts](../../packages/ant-cli/src/periphery/adapters/http/middleware/corsConfig.ts)).
- **Threat model notes.** `run_command` chaining is bounded by an allowlist with
  an intentional `ANT_UNSAFE_*` escape hatch (accepted). Multi-org/user
  detection emits a one-shot `logger.warn`. Local mode assumes a
  single-developer trust boundary.

---

## Out of scope / accepted (rationale recorded, no action)

- OAuth secrets via K8s env-var (standard; file-mount is a deployment follow-up).
- `docker-compose` root + `docker.sock` (local dev only; prod is non-root).
- ant `ant/` submodule SHA pin in ant-cloud (already correct).
- Scanner-only reports without a working PoC (see [SECURITY.md](../../SECURITY.md)
  "Out of Scope").
