/**
 * Mount-namespace isolation for user-authored child processes — SSOT.
 *
 * `childEnv` decides what a child SEES in its environment and `childIdentity`
 * which OS identity it runs as. Neither bounds the FILESYSTEM: a child under any
 * UID still walks the whole pod — `/vault/secrets`, every other tenant's
 * workspace, `/etc`, the service's own tree — and one `cp` moves any of it into
 * the requester-visible artifacts (2026-09 report). Path parsers in the tool
 * layer are guardrails (`node -e` bypasses them by construction); the boundary
 * is a mount namespace in which those paths DO NOT EXIST.
 *
 * Every user-authored spawn goes through {@link spawnUserChild} (or
 * {@link wrapCommandForUserChild} where an SDK owns the spawn). When the
 * sandbox is on, the command is re-exec'd under bubblewrap with:
 *   - the system toolchain read-only — `/usr`, `/bin`, `/lib*`, `/opt`, a fixed
 *     set of `/etc` entries, the node prefix, `PATH` entries, deployment extras;
 *   - the tenant's own roots read-write — the workspace the call site names,
 *     the isolated child HOME, the toolchain caches the composed env points at;
 *   - a fresh `/proc` in its own PID namespace, a minimal `/dev`, tmpfs `/tmp`;
 *   - and nothing else. What is not bound is not there.
 *
 * It composes with the other two controls by NESTING: the identity drop runs
 * first (spawn `uid`/`gid`, or `setpriv` for SDK spawns), so bwrap itself runs
 * unprivileged and needs only user namespaces — never a capability.
 *
 * Mode is env-driven (`ANT_CHILD_SANDBOX`): unset means on in cloud and off in
 * local; `on` / `off` force it. When on, the launcher is probed ONCE per child
 * identity and every failure (non-Linux, no `bwrap`, namespaces refused by the
 * kernel or seccomp) is fail-CLOSED. A deployment that cannot sandbox has to
 * say `off` — silently running user code on the bare pod is the incident.
 */

import { spawn, spawnSync, type ChildProcess, type StdioOptions } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { logger } from '../../utils/logger';
import { childHomeDir } from './childEnv';
import {
  assertUserCodeIsolationOrThrow,
  childSpawnIdentity,
  wrapCommandForChildIdentity,
  type ChildSpawnIdentity,
} from './childIdentity';
import { WorkspacePathResolver } from './WorkspacePathResolver';

const LOG = { component: 'childSandbox' } as const;

/** The filesystem a user-authored child may reach, beyond the system toolchain. */
export interface ChildSandboxRoots {
  /** Bound read-write at the same absolute path — the tenant's own tree(s). */
  rwRoots: readonly string[];
  /** Bound read-only — e.g. the service's own code for the static preview server. */
  roRoots?: readonly string[];
}

export interface SandboxSpec extends ChildSandboxRoots {
  /** Working directory inside the sandbox — must lie under a bound root. */
  workingDir: string;
  /** The COMPOSED child env; HOME / TMPDIR / toolchain cache paths are read from it. */
  env: NodeJS.ProcessEnv;
  /** Deployment extras (normally `ANT_CHILD_SANDBOX_RW` / `_RO`). */
  extraRw?: readonly string[];
  extraRo?: readonly string[];
  /** Node install prefix; defaults to the running binary's. */
  nodePrefix?: string;
}

export type ChildSandboxMode = 'on' | 'off';

let warnedMode = false;

/**
 * `ANT_CHILD_SANDBOX`: `on` | `off`; unset resolves to on in cloud, off in local.
 * Local is a single-developer trust boundary and macOS has no bwrap, so the
 * default there is off; a Linux developer opts in with `on`.
 */
export function childSandboxMode(): ChildSandboxMode {
  const raw = (process.env.ANT_CHILD_SANDBOX ?? '').trim().toLowerCase();
  if (raw === 'off' || raw === '0' || raw === 'false') return 'off';
  if (raw === 'on' || raw === '1' || raw === 'true') return 'on';
  if (raw !== '' && !warnedMode) {
    warnedMode = true;
    logger.warn(`[childSandbox] ANT_CHILD_SANDBOX=${JSON.stringify(raw)} is not on|off — treating as unset`, LOG);
  }
  return process.env.ANT_SERVER_MODE === 'cloud' ? 'on' : 'off';
}

// ─── host probing (injectable for tests) ───────────────────────────────────

export type HostEntryKind = 'symlink' | 'dir' | 'file' | null;

export interface SandboxHost {
  kind(p: string): HostEntryKind;
  readlink(p: string): string;
  realpath(p: string): string;
}

export const realSandboxHost: SandboxHost = {
  kind(p) {
    try {
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) return 'symlink';
      return st.isDirectory() ? 'dir' : 'file';
    } catch {
      return null;
    }
  },
  readlink: (p) => fs.readlinkSync(p),
  realpath: (p) => fs.realpathSync(p),
};

// ─── argument composition ─────────────────────────────────────────────────

/** Toolchain roots every child needs; read-only, replicated as symlinks where the host has them. */
const SYSTEM_RO_ROOTS = ['/usr', '/bin', '/sbin', '/lib', '/lib32', '/lib64', '/libx32', '/opt'] as const;

/**
 * The `/etc` entries a toolchain needs. `/etc` itself is NOT bound: that is
 * where an image keeps things a tenant must not read (`shadow`, mounted
 * secrets, service config). Name entries; never widen this to the directory.
 */
const ETC_RO_ENTRIES = [
  'ssl', 'ca-certificates', 'pki', 'crypto-policies',
  'resolv.conf', 'hosts', 'hostname', 'nsswitch.conf', 'passwd', 'group',
  'localtime', 'timezone', 'ld.so.cache', 'ld.so.conf', 'ld.so.conf.d', 'alternatives',
  'profile', 'profile.d', 'bash.bashrc', 'bashrc', 'inputrc', 'gitconfig', 'npmrc',
  'os-release', 'mime.types', 'ssh/ssh_known_hosts', 'ssh/ssh_config', 'ssh/ssh_config.d',
] as const;

/**
 * Toolchain cache locations a composed child env may point at. They are shared
 * per deployment today (one GOPATH, one CARGO_HOME); the sandbox keeps them
 * reachable so installs and builds keep working, and binds nothing else.
 */
const TOOLCHAIN_RW_ENV_NAMES = [
  'GOPATH', 'GOMODCACHE', 'GOCACHE', 'CARGO_HOME', 'RUSTUP_HOME', 'MISE_DATA_DIR',
  'UV_CACHE_DIR', 'UV_PYTHON_INSTALL_DIR', 'PNPM_HOME', 'COREPACK_HOME', 'npm_config_cache',
  'GRADLE_USER_HOME', 'MAVEN_USER_HOME', 'PIP_CACHE_DIR', 'XDG_CACHE_HOME', 'XDG_DATA_HOME',
] as const;

const NAMESPACE_FLAGS = [
  // No --unshare-net: dev servers, installs and the http probe need the pod's
  // network. Egress is a different axis (urlPolicy).
  '--unshare-user', '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--unshare-cgroup-try',
  '--die-with-parent',
] as const;

function isWithin(p: string, root: string): boolean {
  if (root === '/') return true;
  return p === root || p.startsWith(root.endsWith('/') ? root : `${root}/`);
}

function absoluteOrNull(p: string | undefined): string | null {
  if (!p || !path.isAbsolute(p)) return null;
  return path.resolve(p);
}

/**
 * The bwrap argument vector for `spec` — everything before `-- <command>`.
 * Pure over `host`, so the binding rules are testable without a Linux box.
 */
export function composeSandboxArgs(spec: SandboxSpec, host: SandboxHost = realSandboxHost): string[] {
  const args: string[] = [...NAMESPACE_FLAGS, '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp'];
  const bound: Array<{ path: string; rw: boolean }> = [];
  const covered = (p: string, needRw: boolean) => bound.some((b) => (b.rw || !needRw) && isWithin(p, b.path));

  const ro = (raw: string) => {
    const p = absoluteOrNull(raw);
    if (!p || covered(p, false)) return;
    const kind = host.kind(p);
    if (kind === null) return;
    if (kind === 'symlink') {
      args.push('--symlink', host.readlink(p), p);
      return;
    }
    args.push('--ro-bind', p, p);
    bound.push({ path: p, rw: false });
  };
  const rw = (raw: string) => {
    const p = absoluteOrNull(raw);
    if (!p || covered(p, true)) return;
    if (host.kind(p) === null) {
      logger.warn(`[childSandbox] writable root ${p} does not exist on the host — not bound`, LOG);
      return;
    }
    args.push('--bind', p, p);
    bound.push({ path: p, rw: true });
  };

  for (const root of SYSTEM_RO_ROOTS) ro(root);
  for (const entry of ETC_RO_ENTRIES) ro(`/etc/${entry}`);

  // The call site's roots come before every env-derived rule, so a HOME or
  // cache that already lies inside the tenant tree is recognised as covered.
  for (const root of spec.rwRoots) rw(root);
  for (const root of spec.roRoots ?? []) ro(root);

  // HOME: the isolated child HOME rides along read-write; any other HOME (the
  // service account's, when child-HOME isolation is off) becomes an empty
  // tmpfs — the dotfiles that made inheriting it a finding are simply absent.
  const home = absoluteOrNull(spec.env.HOME);
  const isolatedHome = absoluteOrNull(childHomeDir());
  if (home && !covered(home, true)) {
    if (isolatedHome && home === isolatedHome && host.kind(home) !== null) rw(home);
    else args.push('--tmpfs', home);
  }
  const tmpdir = absoluteOrNull(spec.env.TMPDIR);
  if (tmpdir && tmpdir !== '/tmp' && !isWithin(tmpdir, '/tmp') && !covered(tmpdir, true)) {
    args.push('--tmpfs', tmpdir);
  }

  const execReal = (() => {
    try { return host.realpath(process.execPath); } catch { return process.execPath; }
  })();
  ro(spec.nodePrefix ?? path.dirname(path.dirname(execReal)));
  for (const entry of (spec.env.PATH ?? '').split(path.delimiter)) {
    if (path.isAbsolute(entry) && host.kind(entry) === 'dir') ro(entry);
  }

  for (const name of TOOLCHAIN_RW_ENV_NAMES) {
    const value = spec.env[name];
    if (value) rw(value);
  }
  for (const root of spec.extraRo ?? []) ro(root);
  for (const root of spec.extraRw ?? []) rw(root);

  args.push('--chdir', path.resolve(spec.workingDir));
  return args;
}

function envPathList(name: string): string[] {
  return (process.env[name] ?? '')
    .split(path.delimiter)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ─── launcher resolution + probe ──────────────────────────────────────────

/** Absolute only — a bare name would resolve through the tenant-controlled child PATH (H-014). */
const BWRAP_CANDIDATES = ['/usr/bin/bwrap', '/usr/local/bin/bwrap', '/bin/bwrap'] as const;
let bwrapPathCache: string | null | undefined;

function resolveBwrapAbs(): string | undefined {
  if (bwrapPathCache !== undefined) return bwrapPathCache ?? undefined;
  for (const candidate of BWRAP_CANDIDATES) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      bwrapPathCache = candidate;
      return candidate;
    } catch {
      /* try next */
    }
  }
  bwrapPathCache = null;
  return undefined;
}

const REMEDY =
  'Install bubblewrap on the image and let the pod create user namespaces ' +
  '(kernel user.max_user_namespaces > 0, seccomp/AppArmor permitting CLONE_NEWUSER), ' +
  'or set ANT_CHILD_SANDBOX=off to run user code on the bare pod filesystem knowingly.';

function refuse(context: string, why: string): never {
  throw new Error(`[childSandbox] Refusing to run user-authored code (${context}) without a mount namespace: ${why}. ${REMEDY}`);
}

// One verdict per identity — namespace permission is a deployment fact, but it
// can differ between the service UID and the dropped one.
const probeVerdicts = new Map<string, string | null>();

/**
 * Resolve the launcher and prove, once per identity, that it can build the
 * baseline sandbox and run node inside it. Throws on every failure.
 */
function ensureLauncher(context: string, identity: ChildSpawnIdentity): string {
  if (process.platform !== 'linux') refuse(context, 'non-Linux runtime has no mount-namespace launcher');
  const launcher = resolveBwrapAbs();
  if (!launcher) refuse(context, 'bubblewrap (bwrap) not found on the image');

  const key = `${identity.uid ?? ''}:${identity.gid ?? ''}`;
  const cached = probeVerdicts.get(key);
  if (cached === null) return launcher;
  if (cached !== undefined) refuse(context, cached);

  const probeArgs = composeSandboxArgs({ rwRoots: [], workingDir: '/', env: { PATH: process.env.PATH } });
  const probe = spawnSync(launcher, [...probeArgs, '--', process.execPath, '-e', '0'], {
    ...identity,
    stdio: ['ignore', 'ignore', 'pipe'],
    timeout: 20_000,
  });
  const failure = probe.status === 0
    ? null
    : (probe.error?.message ?? probe.stderr?.toString().trim() ?? '') || `bwrap exited ${probe.status ?? probe.signal}`;
  probeVerdicts.set(key, failure);

  if (failure) {
    logger.error(`[childSandbox] sandbox probe failed for uid=${identity.uid ?? 'inherit'}: ${failure}`, LOG);
    refuse(context, `sandbox probe failed (${failure})`);
  }
  logger.info(`[childSandbox] user-authored children run in a mount namespace (${launcher}, uid=${identity.uid ?? 'inherit'})`, LOG);
  return launcher;
}

// ─── public wrapping API ──────────────────────────────────────────────────

export interface WrapSandboxOptions {
  /** Label for the refusal message. */
  context: string;
  /** Identity the probe runs under; defaults to `childSpawnIdentity()`. */
  identity?: ChildSpawnIdentity;
}

/**
 * Re-exec `command` under the sandbox launcher. Identity when the mode is off.
 *
 * Fails closed when the mode is on and the sandbox cannot be built, when no root
 * is named (a sandbox with nothing bound is a misconfigured call site, not an
 * empty tenant), or when `workingDir` lies outside every root (bwrap would fail
 * the chdir with a message that names nothing).
 */
export function wrapChildInSandbox(
  command: string,
  args: readonly string[],
  spec: SandboxSpec,
  opts: WrapSandboxOptions,
): { command: string; args: string[] } {
  if (childSandboxMode() === 'off') return { command, args: [...args] };

  const roots = [...spec.rwRoots, ...(spec.roRoots ?? [])].map((r) => path.resolve(r));
  if (roots.length === 0) refuse(opts.context, 'no sandbox root named by the call site');
  const cwd = path.resolve(spec.workingDir);
  if (!roots.some((r) => isWithin(cwd, r))) {
    refuse(opts.context, `working directory ${cwd} lies outside every sandbox root (${roots.join(', ')})`);
  }

  const launcher = ensureLauncher(opts.context, opts.identity ?? childSpawnIdentity());
  const sandboxArgs = composeSandboxArgs({
    ...spec,
    extraRw: [...(spec.extraRw ?? []), ...envPathList('ANT_CHILD_SANDBOX_RW')],
    extraRo: [...(spec.extraRo ?? []), ...envPathList('ANT_CHILD_SANDBOX_RO')],
  });
  return { command: launcher, args: [...sandboxArgs, '--', command, ...args] };
}

export interface UserChildSpawnOptions {
  /** Names the spawn in isolation refusals (`preview:install:node`, `run_command`). */
  context: string;
  sandbox: ChildSandboxRoots;
  cwd: string;
  /** The COMPOSED env (`composeChildEnv` / `composeCommandChildEnv`), never `process.env`. */
  env: NodeJS.ProcessEnv;
  stdio?: StdioOptions;
  detached?: boolean;
  /** Node's `shell: true` semantics — the joined command line runs under `/bin/sh -c` inside the sandbox. */
  shell?: boolean;
  /** Defaults to `childSpawnIdentity()`; the credentialed fetch passes its own. */
  identity?: ChildSpawnIdentity;
}

/**
 * The ONE way to spawn user-authored code: identity gate, identity drop, and
 * mount namespace composed in that order, in one call. Every preview / deploy /
 * `run_command` site goes through here — a bare `spawn()` of user code is the
 * offense `tests/policy/credential-isolation.test.ts` pins.
 */
export function spawnUserChild(command: string, args: readonly string[], o: UserChildSpawnOptions): ChildProcess {
  assertUserCodeIsolationOrThrow(o.context);
  const identity = o.identity ?? childSpawnIdentity();

  let cmd = command;
  let argv = [...args];
  let shell = o.shell ?? false;
  if (shell && childSandboxMode() === 'on') {
    // Node's own shell:true is `/bin/sh -c "<file> <args...>"` on POSIX; do the
    // same join explicitly so the shell runs INSIDE the namespace.
    argv = ['-c', [command, ...args].join(' ')];
    cmd = '/bin/sh';
    shell = false;
  }
  const launch = wrapChildInSandbox(cmd, argv, { ...o.sandbox, workingDir: o.cwd, env: o.env }, { context: o.context, identity });
  return spawn(launch.command, launch.args, {
    cwd: o.cwd,
    env: o.env,
    stdio: o.stdio,
    detached: o.detached,
    shell,
    ...identity,
  });
}

/**
 * For spawns an SDK performs on our behalf (stdio MCP): the command re-exec'd
 * under `setpriv` (identity) around `bwrap` (namespace) around the command —
 * the same nesting `spawnUserChild` gets from spawn options.
 */
export function wrapCommandForUserChild(
  command: string,
  args: readonly string[],
  spec: SandboxSpec,
  context: string,
): { command: string; args: string[] } {
  const sandboxed = wrapChildInSandbox(command, args, spec, { context, identity: childSpawnIdentity() });
  return wrapCommandForChildIdentity(sandboxed.command, sandboxed.args);
}

/**
 * The service's own checkout — the one tree of OURS a child may read, and only
 * where the child runs our code (the static preview server). Topmost
 * `pnpm-workspace.yaml` above the CLI root, so the pnpm store the bundle's
 * symlinks resolve through is inside it (cloud nests the OSS repo one level down).
 */
export function serviceCodeRoot(): string {
  const cliRoot = WorkspacePathResolver.getCliRoot();
  let top = path.resolve(cliRoot, '..', '..', '..');
  let dir = cliRoot;
  while (path.dirname(dir) !== dir) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) top = dir;
    dir = path.dirname(dir);
  }
  return top;
}

export const __testing = {
  reset: () => {
    warnedMode = false;
    bwrapPathCache = undefined;
    probeVerdicts.clear();
  },
};
