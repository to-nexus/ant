# Troubleshooting

Common problems and how to diagnose them. If your issue isn't here, search
[issues](../../../issues) or open a new one with the
[bug-report template](../../.github/ISSUE_TEMPLATE/bug_report.yml).

## Setup

### `pnpm install` fails on ripgrep with ENOENT

Ant uses `@vscode/ripgrep` for code search. pnpm 10+ blocks the postinstall
script that downloads the ripgrep binary unless the package is allow-listed.
The repo already has the allow-list entry; the failure usually means a
stale `node_modules` or a `GITHUB_TOKEN` env var is causing a 401.

```bash
# Force the postinstall script to re-download
cd node_modules/.pnpm/@vscode+ripgrep@*/node_modules/@vscode/ripgrep && \
  env -u GITHUB_TOKEN -u GH_TOKEN node ./lib/postinstall.js --force
```

If the problem persists, clear and reinstall:

```bash
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

### Docker compose can't bind a port

Default infra ports:

| Service  | Port  |
|----------|-------|
| Redis    | 16379 |
| Chroma   | 18000 |
| Visual processor | 18080 |

If something else is already on those ports, edit
`packages/ant-cli/src/periphery/integrations/*/docker-compose.yml` and bump
the host port.

### `ANT_ENCRYPTION_KEY` errors on startup

The CLI refuses to start without an encryption key. Generate one:

```bash
echo "ANT_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> packages/ant-cli/.env
```

### LLM provider errors

Symptoms in the logs:

- `401 Unauthorized` — your API key is missing or invalid. Check
  `packages/ant-cli/.env`.
- `429 Too Many Requests` — provider rate limit. Reduce
  `ANT_TASK_CONCURRENCY` or upgrade your plan.
- `400 prompt is too long` — check whether you have huge files in your RAC.
  Shrink the artifact selection or split the directive.

## Runtime

### The UI loads but the chat doesn't connect

The UI talks to `ant-realtime` over Server-Sent Events. Check:

- `pnpm dev:realtime-server` is running and shows `realtime-server listening on 4101`.
- Browser dev tools → Network → look for a `/realtime/stream` request. If
  it's pending, your browser proxy / VPN may be buffering it; try without
  the proxy.

### A job hangs at `triage`

`triage` calls the LLM. If it stays pending for more than 30 seconds, the
provider is slow or unreachable. Check `ant-job` logs for the request and
response.

### A job fails with `ExecutionTierViolation`

The decompose phase requires the LLM to emit a `<executionTier>N</executionTier>`
tag. Two retries are allowed; if they all fail, the job aborts. Causes:

- Custom prompts missing the tier instruction. See
  [guides/custom-prompts.md](../guides/custom-prompts.md).
- A model that ignores XML tags consistently. Anthropic Claude 3.5+ and
  GPT-4 family are tested.

### A verification task spins forever

If a Tier 3/4 verification task keeps generating new errors, look at:

- `_failedAttempts` in the kanban metadata — capped to prevent infinite
  retry budget reset.
- `MAX_BATCH_SPLIT_CYCLES` (currently 10). Once exceeded, Ant emits
  `VerificationTerminalError` and stops.

The full session lives in `workspaces/<project>/<feature>/sessions/architect/code.json`.
Inspect it to see the retry chain.

### "Project already exists" on createProject

This is a known cleanup-cascade regression class. In K8s mode, an EFS
handle from a deleted IDE pod can leave a `.nfsXXXX` orphan. Use the
wizard's force-cleanup option (it sends `?force=true`).

If the orphan persists, manually clean it from the EFS mount, then retry.

## Cloud / Kubernetes

### `Pod is being deleted` 409 on IDE start

Wait. The orchestrator polls `deletionTimestamp` and recreates after the
pod fully terminates (up to 60s). If it doesn't recover within a minute,
restart `ant-api`.

### `dubious ownership` git errors

EFS volumes mount with different uids than git expects. Ant catches this
specifically and returns an empty git status. If you're seeing infinite
retries on git operations, you may have a custom GitService extension —
verify it handles the `safe.directory` exception path.

## Build / test

### Tests pass locally but fail in CI

The most common cause is a forgotten `pnpm.onlyBuiltDependencies` entry.
The CI image runs `pnpm install` without `--ignore-scripts`; if you added
a dep that needs a postinstall (e.g. `sharp`), allow-list it.

Second most common: the test suite expects a clean `workspaces/`. Run
`rm -rf workspaces/test-*` and re-run.

### `pnpm build` finds typecheck errors only on first run

The build runs the test suite as a prebuild gate. The first build after a
fresh checkout has cold caches; just re-run.

## Where to look next

- For binding architectural rules: [AGENTS.md](../../AGENTS.md).
- For deep-dive runtime behaviour: [internals/](../internals/).
- For debug logging strategy: [internals/29-debug-logging.md](../internals/29-debug-logging.md).
- For verification loop internals: [internals/17-code-verification-task.md](../internals/17-code-verification-task.md).
