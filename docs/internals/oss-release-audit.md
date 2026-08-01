# OSS Public-Release Security Audit — 2026-08-01

Point-in-time review of `to-nexus/ant` and `to-nexus/ant-desktop` ahead of
flipping both repositories to **public**. The question asked here is narrow:
*what becomes a problem once the source is readable by anyone?* — not a
penetration test of the hosted service.

The durable standard this audit measures against is
[security-posture.md](security-posture.md). That file states the invariants;
this one records what a specific sweep found and what was done about it.

**Method.** `git ls-files` inventory, `gitleaks 8.30.1` over the working tree
and over history (`--log-opts` for `HEAD` and for `--all`), targeted `git grep`
for credential shapes and internal-infrastructure strings, and direct reading
of the auth / filesystem / command / Electron-equivalent surfaces. Every claim
below was verified against the file, not inferred.

---

## 1. Status summary

| | |
|---|---|
| **Blocking the release** | Nothing outstanding. |
| **Recommended before the visibility flip** | §2 — GitHub object GC, `origin/owen` disposition. |
| **Fixed in this pass** | §3 — 8 items across both repos. |
| **Verified clean, no action** | §5. |

Publishable history is clean: `gitleaks git . --log-opts="HEAD"` — the exact
scan CI gates on — reports **no leaks found**.

---

## 2. Remaining items (owner: maintainer)

### 2.1 Rotated credentials still resolvable on GitHub's object store

Four historical commits carried real credentials:

| Historical file | Commit | Secrets |
|---|---|---|
| `packages/ant-cli/.env.backup` | `3ab9882f2`, `c5003dd0a` | Anthropic, OpenAI, Google OAuth client secret, `ANT_ENCRYPTION_KEY` |
| `packages/ant-cli/.env.bak` | `cdfc9ec5c` | Anthropic, OpenAI, `ANT_ENCRYPTION_KEY`, Figma client secret |
| `packages/ant-cli/env (1)` | `2fc7a4504` | OpenAI, Anthropic, GitHub PAT |

**All six credential classes have been rotated**, so the values are dead. The
history rewrite removed them from every published ref — but the objects
themselves are still served:

```bash
git fetch --no-tags origin 3ab9882f2   # succeeds today
```

A history rewrite re-points refs; it does not delete unreachable objects on
GitHub's side. Once the repository is public, anyone holding a SHA can fetch
those commits and read the old OAuth client ids, endpoints, and file layout.

**Action**: open a GitHub Support ticket requesting garbage collection of
unreachable objects on `to-nexus/ant`, and confirm completion **before** the
visibility flip. Deleting local branches does not substitute for this.

### 2.2 `origin/owen`

Four commits unique to `main` (`a7e90c47a` and three others) covering internal
deployment-path changes and a daemon-user modification.
`gitleaks` reports them clean, but they have not been reviewed for a public
audience. Delete the remote branch or merge it deliberately.

### 2.3 `ant-desktop` release runners

All three jobs in `.github/workflows/release.yml` run on **self-hosted**
runners (`[macOS]` for the build, `[arc-runner-set]` for the CDN upload).
GitHub advises against exposing self-hosted runners to public repositories.

This pass added the guards that make the current setup safe (§3.7) and moved
one job off self-hosted entirely. The remaining `upload-cdn` job carries a
`TODO(security)`: AWS auth there is OIDC, whose trust policy keys on the
repo/ref claim rather than the runner, so `ubuntu-latest` should work
unchanged — but the IAM trust policy must be confirmed first, since a mismatch
fails the release outright.

### 2.4 Unsigned desktop binaries

`src-tauri/tauri.conf.json` sets `"signingIdentity": "-"` (ad-hoc) with no
notarization, and releases sync to a public CloudFront path. Already documented
in `ant-desktop/docs/DEPLOYMENT_GUIDE.md`; now also stated in that repo's
`SECURITY.md` out-of-scope section. Obtain a Developer ID + notarization, or
keep the warning prominent in the README.

---

## 3. Fixed in this pass

### 3.1 Redis TLS hostname verification is no longer unconditionally disabled

`checkServerIdentity: () => undefined` was applied to **every** `rediss://`
connection, with no way to opt out. Ten call sites had each open-coded the
same bypass:

`infrastructure/utils/redis.ts` (×2), `infrastructure/state/RedisStateStore.ts`,
`composition/orchestrator.ts` (×2), `composition/job-runner.ts`, and the five
`core/realtime/*Broadcaster.ts` classes.

All ten now route through one owner,
[`buildRedisTlsOptions()`](../../packages/ant-cli/src/infrastructure/utils/redis.ts),
which keeps full verification unless `ANT_REDIS_TLS_SKIP_HOSTNAME_CHECK=true`.
The documented reason to enable it — ElastiCache Serverless behind a custom
CNAME — is now an explicit operator decision rather than a default a
self-hoster silently inherits. Documented in `.env.example.cloud` and
`SECURITY.md`.

### 3.2 Internal deployment kit removed

`packages/ant-cli/{deploy.sh,install.sh,uninstall.sh,docker-compose.yml}` were
single-VM operator scripts: a hardcoded AWS account id as the ECR registry
default, an internal install root, a named service user, and internal data
paths.
The compose file additionally mounted the Docker socket into a `user: root`,
`network_mode: host` container — and was already non-functional (typos in both
the socket path and a workspace env var) while contradicting the documented
four-process architecture.

All four were unreferenced (`dev:infra` points at
`src/periphery/integrations/*/docker-compose.yml`). Removed; CD belongs to the
private `ant-cloud` repository, as `.github/workflows/ci.yml` already states.
Tracked-file occurrences of the internal strings are now zero.

### 3.3 `.gitignore` covers keys and deployment env files

Added `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `id_rsa*`,
`id_ed25519*`, and `.env.{prod,cloud,staging}`. A blanket `.env.*` is
deliberately avoided — `packages/ant-{site,ui}/.env.{development,production}`
are tracked build config — so deployment-flavoured names are listed explicitly.
Verified that no currently-tracked file becomes ignored.

### 3.4 Stale configuration removed

- `packages/ant-cli/env.example`, `packages/ant-ui/env.example` — superseded by
  `.env.example.{local,cloud}`. The ant-cli one defaulted to
  `ANT_SERVER_MODE=cloud` and never mentioned `ANT_JWT_SECRET`, steering a
  first-time self-hoster into authenticated cloud mode with no JWT secret.
- `.pnpm-allowed-builds.json` — contradicted `pnpm-workspace.yaml`'s
  `allowBuilds` (pnpm 11 reads the workspace file) and listed two packages that
  are not dependencies. Fully inert.

### 3.5 CI secret-scanner download is checksum-verified

`.github/workflows/ci.yml` fetched the gitleaks release tarball and piped it
straight into `tar` — twice. The binary then runs with repository contents in
scope, so a compromised release asset would execute in CI. Consolidated into
one `Install gitleaks` step that verifies a pinned sha256 before extracting.

### 3.6 Scanner noise reduced without weakening the gate

`.gitleaks.toml` now allowlists `.next/`. Next.js build manifests trip
`generic-api-key` on build hashes; they are gitignored but `gitleaks dir` walks
untracked files, so local runs drowned real findings in noise. No real secret
pattern was allowlisted.

### 3.7 Self-hosted runners guarded against fork execution

Every job in `ant-desktop/.github/workflows/release.yml` now carries
`if: github.repository == 'to-nexus/ant-desktop'`, and a header comment states
the two properties that must both hold (tag-only trigger + repo guard) plus the
triggers that must never be added while the runners stay self-hosted. The
`resolve-env` job — pure tag-string parsing, no checkout, no secrets — moved to
`ubuntu-latest`.

### 3.8 Governance files and deliberate-design comments

- `ant-desktop`: added `LICENSE` (Apache-2.0, matching the monorepo),
  `SECURITY.md` (with the Tauri-specific threat model), `CONTRIBUTING.md`;
  `license` fields added to `package.json` and `src-tauri/Cargo.toml`.
- `CODEOWNERS` added to both repositories, weighted toward security-sensitive
  paths.
- `SECURITY.md` (ant) now names both escape hatches —
  `ANT_UNSAFE_ALLOW_ALL_COMMANDS` and `ANT_REDIS_TLS_SKIP_HOSTNAME_CHECK` —
  as configuration choices rather than vulnerabilities.
- `ant-desktop/src-tauri/src/auth/jwt.rs`: documented that `decode_user_id`
  intentionally does not verify the signature, and that its return value must
  never drive an authorization decision.
- `ant-desktop/src-tauri/src/validation.rs`: documented that `http://` is
  accepted for any host (LAN self-hosting), with the confirmation dialog as the
  gate.

---

## 4. Local hygiene performed

Six pre-purge branches and one tag still carried the §2.1 commits and could
have been force-pushed into the public repository by accident. They were
archived to `~/ant-prepurge-archive.bundle` (outside the repository, never
published) and deleted, along with a stale Cursor worktree whose detached HEAD
kept `2fc7a4504` reachable.

> **Caveat.** `git reflog expire --expire=now --all` also clears the *stash*
> reflog, which is how `git stash list` enumerates entries. The surviving entry
> was restored via `git stash store`; any older entries were unrecoverable
> afterwards. Do not include a blanket `reflog expire` in a cleanup runbook
> without checking `git stash list` first.

---

## 5. Verified clean — no action needed

- **No secrets in any tracked file.** Independent greps for `sk-ant-`,
  `sk-proj-`, `ghp_`, `github_pat_`, `AKIA`/`ASIA`, `AIza`, `xox[bapr]-`,
  `glpat-`, `sk_live_`, `SG.`, `-----BEGIN … PRIVATE KEY`, `hooks.slack.com`,
  raw JWTs, and `scheme://user:pass@host` return only self-evident placeholders
  (`ghp_stubtokenstubtokenstubtoken` in a commit-identity test;
  `postgres://user:pw@host` as UI input placeholders).
- **No tracked `.pem` / `.key` / `.p12` / service-account JSON** in either repo.
- **`.gitleaks.toml` allowlists no real secret** — only dependency/build trees
  and two provably-fake fixtures.
- **No `postinstall` / `preinstall` / `prepare` scripts** in any first-party
  `package.json`.
- **Lockfiles committed** (`pnpm-lock.yaml` ×2, `src-tauri/Cargo.lock`), with a
  maintained CVE `overrides` block in `pnpm-workspace.yaml`.
- **No `rejectUnauthorized: false`, `NODE_TLS_REJECT_UNAUTHORIZED`,
  `shell: true`, or CORS `*`** anywhere in tracked source.
- **`dangerouslySetInnerHTML` is safe at all three sites** — two construct
  `ansi-to-html` with `escapeXML: true`; the third renders Mermaid initialised
  with `securityLevel: 'strict'`.
- **Path traversal is guarded** — every filesystem route in
  `files.routes.ts` funnels through the local `resolveSafePath()` helper.
- **Auth is uniform** — `middleware/jwtAuth.ts` uses an explicit
  `publicPaths` / `publicPrefixes` allowlist with no mode-based bypass.
  `JwtService.verify()` recomputes HS256 independently of the header `alg` and
  compares with `crypto.timingSafeEqual`, so `alg: none` / algorithm confusion
  is not reachable; the constructor rejects secrets under 32 characters.
- **No default-insecure fallbacks** — there is no `process.env.X || 'dev-secret'`
  anywhere. `CredentialsStore.loadEncryptionKey()` fails fast on a malformed
  `ANT_ENCRYPTION_KEY`; CI generates an ephemeral one rather than committing a
  literal.
- **`pull_request_target` is used nowhere.** `ant`'s CI declares
  `permissions: contents: read` and consumes no secrets.
- **`ant-desktop` is Tauri v2, not Electron.** CSP is set and non-trivial; no
  `withGlobalTauri`, no `dangerousDisableAssetCspModification`. Capabilities are
  narrow (the only widening is `opener:allow-open-url` scoped to `figma://*`).
  Deep-link `connect` requests are parked behind user confirmation rather than
  auto-applied. JWTs live in the OS keychain. WebSocket TLS uses `rustls` +
  `webpki_roots` with no `danger_accept_invalid_certs`.

### Disclosed by design, not leaked

Public product surfaces that appear in tracked config and are fine to publish:
`ant.crosstoken.io`, `ant-server.cross.nexus`, `ant-preview.cross.nexus`,
`ant.cross.nexus`, and `probe@to.nexus` (the deliberate security contact).
These are DNS-discoverable from using the product.

Two cosmetic follow-ups, neither security-relevant: the sample tenant identity
`to.nexus/probe` appears throughout comments and tests, and `ant-desktop`
defaults to `crosstoken.io` while `ant`'s production config uses `cross.nexus`
— worth reconciling before contributors ask which is canonical.

---

## 6. Reproducing this audit

```bash
# Publishable history — this is what CI gates on. Must be clean.
gitleaks git . --log-opts="HEAD" -c .gitleaks.toml --no-banner

# Working tree. On a fresh clone this is clean; locally it reports your own
# gitignored packages/ant-cli/.env, which never exists in CI.
gitleaks dir . -c .gitleaks.toml --no-banner

# All refs, including stashes. Non-zero here means some local ref still
# reaches the §2.1 commits — check `git stash list` and `git worktree list`.
gitleaks git . --log-opts="--all" -c .gitleaks.toml --no-banner

# Internal infrastructure strings must not reappear in tracked files.
# Keep the pattern in a variable so this document does not match itself.
PAT='4123''81771241|/cross/'''ant|docker'''gg'
rg -n "$PAT" --glob '!node_modules' --glob '!docs/internals/oss-release-audit.md' .

# TLS hostname-check policy must have exactly one owner.
rg -n "checkServerIdentity" packages/ant-cli/src
```
