# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Root `docker-compose.yml`** — the full stack (Redis, the four backend
  processes, and an nginx gateway serving the UI same-origin at `:4200`) with
  only Docker installed: `cp .env.example .env && docker compose up -d`. The
  committed `docker/nginx.conf` is compose-only; the cloud deployment keeps
  mounting its own config.
- **`pnpm doctor`** — read-only install self-check: Node/pnpm versions, install
  state, Redis reachability, the four process health endpoints, a BullMQ
  worker heuristic, and provider-key presence. `--live` additionally validates
  keys against the provider; `--json` for machines.
- **`ANT_{DEEPSEEK,GLM,KIMI}_BASE_URL`** — endpoint overrides for the
  OpenAI-compatible providers, so registered model ids can route through a
  self-hosted gateway (LiteLLM / vLLM / OpenRouter). Unset means the previous
  hardcoded endpoints, byte-identical behavior.

### Changed

- **`ANT_REDIS_URL` now defaults to `redis://localhost:16379` in local mode**
  (SSOT: `core/config/redisUrl.ts`); cloud mode still fails fast when unset.
  The root scripts dropped their `ANT_REDIS_URL=...` prefixes, so a value in
  `packages/ant-cli/.env` now wins where the prefix used to shadow it.
- **`ANT_ENCRYPTION_KEY` documentation matches the code**: the key is
  auto-generated and persisted on first boot; a manually set value must be
  64 hex chars (`openssl rand -hex 32` — the previously documented `-base64`
  variant was rejected at boot).
- **`pnpm dev:all` / `start:all` no longer boot the marketing site**; run
  `pnpm dev:site` separately. Added a root `pnpm test` entry point.
- **Installs are guarded**: `preinstall` rejects npm/yarn, and
  `engine-strict` enforces Node >= 22.13 and pnpm >= 11 (pnpm 10 silently
  ignored pnpm-11 workspace keys and skipped native postinstalls).
- README/install docs state the OS position (macOS/Linux; Windows via WSL2,
  untested) and the local-model boundary (≈200K-context + native tool-calling
  floor, with numbers).

### Fixed

- **`packages/ant-cli/Dockerfile` ripgrep sanity checks** were pinned to the
  pre-1.18 layout (postinstall-downloaded `@vscode/ripgrep/bin/rg`); since the
  1.18 bump the binary ships as a platform-specific optionalDependency, so
  every image build failed. Checks now probe `@vscode/ripgrep-<platform>/bin/rg`.
- **`packages/ant-ui/Dockerfile` did not copy `@ant/shared` / `@ant/auth-client`**,
  so the vite build could not resolve its workspace imports. (The cloud deploy
  builds the UI on CI and syncs to S3, so only image builds were affected.)

### Removed

- Dead env vars: `ANT_PREVIEW_WORKERS` (no readers) from scripts and docs.

## [1.1.0] - 2026-08-12

### Added

- **Codespace / workspace project kinds.** A project is now either a
  *codespace* (`projectType: 'canonical'` — the builtin feature-based jobs) or a
  *workspace* (`projectType: 'universal'` — custom agents only), chosen at
  creation and fixed thereafter. Absent means codespace, so existing projects
  need no migration. The kind is pure policy: it decides which jobs a project
  exposes and never the on-disk layout. Documented in
  `docs/concepts/spaces.md` (renamed from `docs/concepts/workspace.md`, which
  described only the codespace layout while the word had grown a second
  meaning).
- **Custom agents and jobs on the `universal` runtime** — *experimental*.
  Define an agent (a role) and its jobs (its duties) as files
  (`agent.yaml` / `job.yaml` / `base/*.md` / `injections/*.md` /
  `intents.yaml`) and run them without a code change or a new job type;
  definitions are account-owned and read fresh at every job start. Includes a
  two-root tool sandbox, an MCP overlay for capability, per-turn `@intent:` and
  `@plan` axes, a fail-closed approval gate, and an agent-authored checklist
  board in place of the task kanban. A read-only `assistant` agent ships as the
  worked example. See `docs/concepts/custom-agents.md` and
  `docs/guides/custom-agent-authoring.md`.
- **Encrypted MCP credential store.** A definition's `env` / `headers` value is
  either a literal or a `${secret:KEY}` reference resolved from a per-user
  AES-256-GCM store (`/api/account/mcp-credentials`, values write-only).
  Resolution never consults `process.env`, and a stdio MCP child receives only
  its declared variables plus a minimal exec baseline — so a definition cannot
  name and exfiltrate the host's secrets.
- **`examples/` — the custom-agent + MCP example, runnable from the repo root.**
  A fixture-only ops incident/SLA MCP server (`examples/mcp-reference-server/`)
  and the agent definitions that consume it (`examples/custom-agents/ops-team/`)
  ship as workspace members that no image copies. Root scripts drive them —
  `build:example:mcp`, `dev:example:mcp`, `start:example:mcp`,
  `start:example:mcp:stdio`, `test:example:mcp` — and the server no longer
  requires a `.env` to start, so an inline `MCP_AUTH_TOKEN` is enough. The
  walkthrough lives in `docs/guides/custom-agent-authoring.md`.

## [1.0.0] - 2026-08-03

### Added

- Initial OSS release scaffolding: `LICENSE` (Apache-2.0), `SECURITY.md`,
  `CONTRIBUTING.md`, `AGENTS.md`, `.github/` issue and PR templates.
- `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1).
- `THIRD_PARTY_NOTICES.md` — attribution for the LGPL-3.0 libvips binaries
  bundled by `sharp`, the SIL OFL 1.1 fonts self-hosted in the marketing site
  build, and MPL-2.0 transitive dependencies.
- Inbound contribution licensing stated explicitly in `CONTRIBUTING.md`
  (Apache-2.0 §5 — no CLA, no DCO sign-off).
- `.github/dependabot.yml` — grouped weekly npm and GitHub Actions updates.
- `README.md` / `README.ko.md`: a `Maturity` section giving per-feature status
  (stable / beta / experimental / incomplete), and commented image slots with a
  capture guide in `docs/assets/README.md`.

### Changed

- Documentation reorganized into a four-tier layout under `docs/`:
  `getting-started/`, `concepts/`, `guides/`, `reference/`, and a
  contributor-only `internals/` section.
- Corrected documentation that claimed `pnpm build` runs the test suite as a
  prebuild gate. No such hook exists — CI is the only gate. This affected
  `CONTRIBUTING.md`, the PR template, and six documents.
- Corrected the install docs' Node/pnpm requirements (Node >= 22.13,
  pnpm 11.1.0) and replaced `<org>` placeholder clone URLs.
- Workspace packages are marked `private` and carry `repository` / `bugs` /
  `homepage` metadata; the root version now reads `1.0.0`.
- `README.md` / `README.ko.md`: `Contributing` rewritten to state that the
  project is solo-developed and to name the areas where outside help lands
  best. `README.ko.md` gained the `Stack` and `Contributing` sections it was
  missing.

### Removed

- Internal-only documentation (`docs/tmp/`, infra migration requests, internal
  workspace fixtures) before the public release.
- The point-in-time OSS release audit under `docs/internals/`. Security sweeps
  enumerate findings, including unremediated ones, and are tracked privately;
  `docs/internals/security-posture.md` remains as the durable standard.
- Dead references to a Discord server that does not exist; GitHub Discussions
  is the one community channel.
- `.github/CODEOWNERS`, which routed every path to a team that was never
  created. An owner entry that resolves to nobody advertises review coverage
  that does not exist; it can come back when there is a real team to name.

[Unreleased]: ../../compare/HEAD...HEAD
