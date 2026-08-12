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
 * Job-neutral and dependency-free so both `periphery/.../PreviewService` and
 * `infrastructure/deploy` can use the one implementation.
 */

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
 * Extra variable names a deployment explicitly wants forwarded, comma-separated.
 * Escape hatch for a host-level variable the allowlist below does not model —
 * env-driven so nothing needs hardcoding per deployment.
 */
const PASSTHROUGH_ENV_VAR = 'ANT_PREVIEW_ENV_PASSTHROUGH';

function isAllowedInheritedName(name: string, passthrough: ReadonlySet<string>): boolean {
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
export function composeChildEnv(...overlays: Array<Record<string, string | undefined> | undefined>): NodeJS.ProcessEnv {
  const passthrough = new Set(
    (process.env[PASSTHROUGH_ENV_VAR] ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
  );

  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (isAllowedInheritedName(key, passthrough)) env[key] = value;
  }

  for (const overlay of overlays) {
    if (!overlay) continue;
    for (const [key, value] of Object.entries(overlay)) {
      if (value !== undefined) env[key] = value;
    }
  }

  return env;
}
