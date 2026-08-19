/**
 * Child-process environment composition — SSOT.
 *
 * Preview and deploy runners spawn **user-authored** commands (install scripts,
 * dev servers, build scripts, compose files). Those children must not inherit
 * the service's own `process.env`, which carries the session signing key, Redis
 * credentials, the workspace encryption key and model-provider API keys — and
 * whose stdout/stderr is streamed straight back to the requester. So the child
 * environment is *composed* from an explicit allowlist rather than inherited.
 *
 * Job-neutral so both `periphery/.../PreviewService` and `infrastructure/deploy`
 * can use the one implementation.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * OS/session variables a spawned shell needs to function at all.
 */
const BASE_ENV_NAMES: ReadonlySet<string> = new Set([
  'PATH', 'Path', 'HOME', 'SHELL', 'USER', 'LOGNAME', 'PWD', 'TERM', 'TMPDIR', 'TMP', 'TEMP',
  'LANG', 'LANGUAGE', 'TZ', 'COLORTERM',
  // win32
  'SystemRoot', 'SystemDrive', 'ComSpec', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PATHEXT',
]);

/**
 * Toolchain namespaces. Package managers and language runtimes are configured
 * almost entirely through prefixed variables (registry auth handled separately
 * via `credentialEnv`), so passing the namespaces keeps installs working
 * without passing the service's own configuration.
 *
 * Go is deliberately absent here: a bare `GO` prefix also matches `GOOGLE_*`,
 * which is how the platform's OAuth client secret reached user children in a
 * single-host deployment. Go variables are named explicitly below instead —
 * a `GO_` prefix would not work either, since `GOPATH` has no underscore.
 */
const TOOLCHAIN_ENV_PREFIXES: readonly string[] = [
  'LC_', 'NODE_', 'npm_', 'NPM_CONFIG_', 'PNPM_', 'COREPACK_', 'YARN_', 'BUN_',
  'JAVA_', 'GRADLE_', 'MAVEN_', 'PYTHON', 'PIP_', 'VIRTUAL_ENV', 'POETRY_',
  'CARGO_', 'RUSTUP_', 'RUST_', 'DOTNET_', 'NUGET_', 'RBENV_', 'GEM_', 'BUNDLE_',
  'ANDROID_', 'XDG_', 'SSL_CERT_', 'NIX_',
];

/** Go toolchain variables, named one by one — see the note above. */
const GO_ENV_NAMES: ReadonlySet<string> = new Set([
  'GOPATH', 'GOROOT', 'GOBIN', 'GOCACHE', 'GOMODCACHE', 'GOFLAGS', 'GOPROXY',
  'GOPRIVATE', 'GONOSUMDB', 'GONOSUMCHECK', 'GOSUMDB', 'GOTOOLCHAIN',
  'GOOS', 'GOARCH', 'GOARM', 'GOEXPERIMENT', 'GOINSECURE', 'GOVCS', 'CGO_ENABLED',
]);

/**
 * Extra variable names a deployment explicitly wants forwarded to PREVIEW and
 * DEPLOY children, comma-separated. Escape hatch for a host-level variable the
 * allowlist below does not model — env-driven so nothing needs hardcoding per
 * deployment.
 *
 * Deliberately NOT read by the code-job command profile: an operator naming a
 * host variable so a dev server can boot did not thereby consent to it reaching
 * every LLM-chosen `run_command` and its chat transcript (M-014).
 */
const PASSTHROUGH_ENV_VAR = 'ANT_PREVIEW_ENV_PASSTHROUGH';

/**
 * Service-infrastructure namespaces that the passthrough list may never admit.
 *
 * The credential-marker test below is a *name-shape* test, and a live connection
 * credential does not have to look like one: `ANT_REDIS_URL` carries the service's
 * Redis authority with no `TOKEN` / `SECRET` / `AUTH` anywhere in its name, so an
 * operator naming it in the passthrough list handed user-authored code the
 * platform's data plane (M-015). Two namespaces are closed by name instead:
 *
 *   - `ANT_*` — the platform's own configuration namespace in its entirety
 *     (`ANT_REDIS_URL`, `ANT_ENCRYPTION_KEY`, `ANT_JWT_*`, …). Nothing a user
 *     child legitimately needs lives there; project-owned values arrive through
 *     the project `.env` overlay, which is a different channel.
 *   - bare connection-URL names, which are the service's own when inherited.
 *     The same name in a project `.env` is user-owned and still applies — this
 *     list gates the INHERITED environment only.
 */
const SERVICE_NAMESPACE_PREFIXES: readonly string[] = ['ANT_'];

const SERVICE_CONNECTION_NAMES: ReadonlySet<string> = new Set([
  'REDIS_URL', 'REDIS_URI', 'DATABASE_URL', 'DATABASE_URI', 'POSTGRES_URL',
  'POSTGRES_URI', 'MONGO_URL', 'MONGODB_URI', 'AMQP_URL', 'RABBITMQ_URL',
  'CLICKHOUSE_URL', 'ELASTICSEARCH_URL', 'CHROMA_URL',
]);

function isServiceOwnedName(name: string): boolean {
  const upper = name.toUpperCase();
  if (SERVICE_NAMESPACE_PREFIXES.some(prefix => upper.startsWith(prefix))) return true;
  return SERVICE_CONNECTION_NAMES.has(upper);
}

/**
 * Credential-shaped names, rejected even when a toolchain prefix or the
 * passthrough list would otherwise admit them.
 *
 * The prefix list is a *namespace* allowlist, and package managers put registry
 * credentials in that same namespace: `NODE_AUTH_TOKEN` rides `NODE_`,
 * `YARN_NPM_AUTH_TOKEN` rides `YARN_`, and `npm_config_//registry:_authToken` /
 * `NPM_CONFIG__AUTH` ride `npm_` and `NPM_CONFIG_`. A user-authored lifecycle
 * script printing its own environment then reads the deployment's private
 * registry authority out of its own build log (M-013, M-014).
 *
 * Matched case-insensitively on the whole name — these substrings do not occur
 * in the non-secret toolchain variables the allowlist exists to pass
 * (`NODE_OPTIONS`, `npm_config_registry`, `PIP_INDEX_URL`, …).
 */
const CREDENTIAL_NAME_MARKERS: readonly string[] = [
  '_AUTH', 'AUTH_', 'TOKEN', 'PASSWORD', 'PASSWD', 'SECRET', 'CREDENTIAL', 'APIKEY', 'API_KEY',
  'PRIVATE_KEY', 'ACCESS_KEY', 'SESSION_KEY', 'SIGNING',
  // `GIT_CONFIG_*` carries a PAT in `url.https://<token>@github.com/.insteadOf`
  // (see `CredentialEnvBuilder`). It is passed deliberately to the credentialed
  // acquire step; it must never arrive by inheritance.
  'GIT_CONFIG',
];

function isCredentialShapedName(name: string): boolean {
  const upper = name.toUpperCase();
  return CREDENTIAL_NAME_MARKERS.some(marker => upper.includes(marker));
}

function isAllowedInheritedName(name: string, passthrough: ReadonlySet<string>): boolean {
  // Both refusals apply to the passthrough escape hatch too: an operator naming
  // `ANTHROPIC_API_KEY` or `ANT_REDIS_URL` there re-opened the very hole the
  // allowlist closed (M-015).
  if (isCredentialShapedName(name)) return false;
  if (isServiceOwnedName(name)) return false;
  if (BASE_ENV_NAMES.has(name)) return true;
  if (GO_ENV_NAMES.has(name)) return true;
  if (passthrough.has(name)) return true;
  return TOOLCHAIN_ENV_PREFIXES.some(prefix => name.startsWith(prefix));
}

/**
 * Compose the environment for a preview child process.
 *
 * Preview children run **user-authored** install scripts and dev commands. If
 * they inherited `process.env` wholesale they would also inherit whatever the
 * service itself holds — session signing key, Redis credentials, workspace
 * encryption key, model provider API keys — and preview stdout/stderr is
 * streamed straight back to the requester, so anything inherited is also
 * readable. So the child env is *composed* from an explicit allowlist rather
 * than inherited: OS/session basics, toolchain namespaces, the project's own
 * `.env` layer, and whatever the caller passes deliberately.
 *
 * Single uniform path — no local/cloud fork. In local mode the same allowlist
 * applies; a variable exported only into the operator's shell (and absent from
 * both the toolchain namespaces and the project `.env`) will not reach the dev
 * server. Put it in the project `.env`, or name it in
 * `ANT_PREVIEW_ENV_PASSTHROUGH`.
 */
/**
 * Which spawn family a child belongs to. The two differ ONLY in whether the
 * preview passthrough escape hatch applies; every other rule is shared, so there
 * is one implementation and no room for the profiles to drift.
 */
export type ChildEnvProfile = 'preview' | 'command';

function compose(
  profile: ChildEnvProfile,
  overlays: Array<Record<string, string | undefined> | undefined>,
): NodeJS.ProcessEnv {
  const passthrough = new Set(
    profile === 'preview'
      ? (process.env[PASSTHROUGH_ENV_VAR] ?? '')
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
      : [],
  );

  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (isAllowedInheritedName(key, passthrough)) env[key] = value;
  }

  const childHome = resolveChildHome();
  if (childHome) {
    env.HOME = childHome;
    if (env.USERPROFILE) env.USERPROFILE = childHome;
  }

  for (const overlay of overlays) {
    if (!overlay) continue;
    for (const [key, value] of Object.entries(overlay)) {
      if (value !== undefined) env[key] = value;
    }
  }

  return env;
}

/**
 * Environment for a PREVIEW or DEPLOY child: dev servers, dependency installs,
 * provisioning commands, build commands, static servers. Honours
 * `ANT_PREVIEW_ENV_PASSTHROUGH`.
 */
export function composeChildEnv(
  ...overlays: Array<Record<string, string | undefined> | undefined>
): NodeJS.ProcessEnv {
  return compose('preview', overlays);
}

/**
 * Environment for a CODE-JOB command child (`run_command`). Same allowlist, but
 * no passthrough: the command's stdout reaches the requester's chat card and the
 * next LLM turn's `tool_result` history, and the operator who named a host
 * variable for a dev server did not consent to that sink (M-014).
 */
export function composeCommandChildEnv(
  ...overlays: Array<Record<string, string | undefined> | undefined>
): NodeJS.ProcessEnv {
  return compose('command', overlays);
}

/**
 * A writable HOME for user-authored children that is NOT the service account's.
 *
 * Blocking credential-shaped variable *names* is not sufficient on its own:
 * package managers also read credentials from files under `$HOME` (`.npmrc`,
 * `.netrc`, `.docker/config.json`), and `~/.ssh` / `~/.aws` sit there too. A
 * lifecycle script inheriting the service HOME can simply `cat` them.
 *
 * The directory is stable per deployment rather than per run, so toolchain
 * caches (`~/.npm`, `~/.cache`) still survive between builds — only the service
 * account's dotfiles are out of reach. Set `ANT_CHILD_HOME` to relocate it; set
 * it empty to opt out and keep inheriting the service HOME.
 */
function resolveChildHome(): string | undefined {
  const configured = process.env.ANT_CHILD_HOME;
  if (configured !== undefined) return configured.trim() || undefined;

  const base = process.env.ANT_WORKSPACE_BASE_PATH;
  if (!base) return undefined;

  const home = path.join(base, '.ant-child-home');
  try {
    fs.mkdirSync(home, { recursive: true });
    return home;
  } catch {
    // Unwritable base — keep the service HOME rather than breaking every spawn.
    return undefined;
  }
}
