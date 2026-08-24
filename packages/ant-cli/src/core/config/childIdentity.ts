/**
 * OS identity for user-authored child processes — SSOT.
 *
 * `childEnv` decides WHAT a child can see in its environment. That is not enough
 * on its own: a child running under the service account's own UID can read
 * `/proc/<service-pid>/environ` and pick up everything the *parent* holds,
 * whatever the composed child env says (C-001). It can also rename and re-link
 * directory entries the service is about to write through, which is the substrate
 * the path-resolution findings ride on (H-003, M-NEW-003).
 *
 * Dropping to a second, unprivileged UID closes both: the child keeps its own
 * read access to the feature workspace (group-shared) and its own scratch HOME,
 * but the service's process environment and service-owned files are out of reach.
 *
 * Env-driven rather than hardcoded, because the ids belong to the image:
 *   ANT_CHILD_UID / ANT_CHILD_GID — numeric ids of the unprivileged child account.
 *
 * Unset (local single-developer CLI, `pnpm dev:all`) means "same identity as the
 * parent" — today's behaviour, and correct there: local mode is a single-user
 * trust boundary and there is no second account to drop to.
 *
 * ## Probe vs. gate
 * Changing a child's UID requires the spawning process to be privileged (root, or
 * holding an effective CAP_SETUID). The service containers run as the
 * unprivileged `ant` user, so whether the drop is *permitted* is decided by the
 * deployment — pod security context / container capabilities — not by this
 * codebase. `childSpawnIdentity()` probes ONCE and is fail-OPEN (returns `{}` with
 * a loud log) so a mis-provisioned deployment does not 500 every request on an
 * unrelated code path. That is NOT sufficient on its own: a spawn that actually
 * runs user-authored code must FAIL CLOSED when the drop is unavailable, via
 * {@link assertUserCodeIsolationOrThrow}. Cloud previews and LLM commands call
 * that gate before spawning; local mode (a single-user trust boundary) is exempt.
 * Asymmetric session keys (`JwtService`) remain the complementary control that
 * removes the authority worth stealing.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';

import { logger } from '../../utils/logger';

export interface ChildSpawnIdentity {
  uid?: number;
  gid?: number;
}

let warned = false;

/**
 * Absolute paths the UID-drop launcher may live at. Resolving `setpriv` by an
 * ABSOLUTE path (never the bare name) is the fix for H-014: a bare name is
 * looked up through the child env's PATH, which the tenant controls via the MCP
 * `env`, so an attacker-planted `setpriv` would run as the SERVICE UID before
 * the drop. An absolute launcher cannot be redirected that way.
 */
const SETPRIV_CANDIDATES = ['/usr/bin/setpriv', '/bin/setpriv', '/usr/sbin/setpriv', '/sbin/setpriv'] as const;
let setprivPathCache: string | null | undefined;

function resolveSetprivAbs(): string | undefined {
  if (setprivPathCache !== undefined) return setprivPathCache ?? undefined;
  for (const candidate of SETPRIV_CANDIDATES) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      setprivPathCache = candidate;
      return candidate;
    } catch {
      /* try next */
    }
  }
  setprivPathCache = null;
  return undefined;
}

function readId(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    if (!warned) {
      warned = true;
      logger.warn(
        `[childIdentity] ${name}=${JSON.stringify(raw)} is not a non-negative integer — ignoring, children keep the service identity`,
        { component: 'childIdentity' },
      );
    }
    return undefined;
  }
  return parsed;
}

/**
 * Spawn options fragment for a user-authored child. Spread it into every
 * `spawn()` that runs code the user wrote — dev servers, install scripts, build
 * commands, static servers:
 *
 *     spawn(cmd, args, { cwd, env, ...childSpawnIdentity() })
 *
 * Returns `{}` when no child account is configured, so the call site reads the
 * same in both deployments and there is no `if (cloud)` fork.
 */
export function childSpawnIdentity(): ChildSpawnIdentity {
  const uid = readId('ANT_CHILD_UID');
  const gid = readId('ANT_CHILD_GID');
  if (uid === undefined && gid === undefined) return {};

  const identity: ChildSpawnIdentity = {
    ...(uid !== undefined ? { uid } : {}),
    ...(gid !== undefined ? { gid } : {}),
  };
  return isDropPermitted(identity) ? identity : {};
}

// Keyed by the exact (uid,gid) probed — a single boolean cache answered a probe
// for one identity with a verdict taken for another. The capability is still a
// deployment fact, so each distinct identity is probed at most once.
const dropPermittedByIdentity = new Map<string, boolean>();

/**
 * One cheap probe: spawn the shortest possible process under the target identity.
 * `EPERM` means the platform does not let this process change UIDs, which is a
 * deployment fact rather than a per-spawn one — so it is cached per identity.
 * Any other failure is treated as "permitted" so a transient error does not
 * silently drop the boundary.
 */
function isDropPermitted(identity: ChildSpawnIdentity): boolean {
  const key = `${identity.uid ?? ''}:${identity.gid ?? ''}`;
  const cached = dropPermittedByIdentity.get(key);
  if (cached !== undefined) return cached;

  const probe = spawnSync(process.execPath, ['-e', '0'], {
    ...identity,
    stdio: 'ignore',
    timeout: 10_000,
  });
  const code = (probe.error as NodeJS.ErrnoException | undefined)?.code;
  const permitted = code !== 'EPERM' && code !== 'EACCES';
  dropPermittedByIdentity.set(key, permitted);

  if (!permitted) {
    logger.error(
      `[childIdentity] ANT_CHILD_UID/GID are set but this process may not change UIDs (${code}). ` +
      'User-authored children keep running under the service identity, so they can read the ' +
      "service's /proc environment. Grant the container the privilege to drop UIDs " +
      '(pod securityContext / capabilities), or unset ANT_CHILD_UID to silence this.',
      { component: 'childIdentity' },
    );
  } else {
    logger.info(
      `[childIdentity] user-authored children run as uid=${identity.uid ?? 'inherit'} gid=${identity.gid ?? 'inherit'}`,
      { component: 'childIdentity' },
    );
  }
  return permitted;
}

/**
 * Widen file-creation permissions so the service identity and the child identity
 * can each clean up the other's files in the shared workspace.
 *
 * They share the primary group, but the default `022` umask makes every new file
 * group-read-only — so a dev server's `.next/` would become undeletable by the
 * service, and an uploaded file unmodifiable by the child. `002` keeps group
 * write on both sides. A child inherits the umask of the process that spawned it,
 * so setting it once in the service covers every spawn.
 *
 * Call once at process bootstrap. No-op when unset (local mode, single identity).
 */
export function applySharedWorkspaceUmask(): void {
  const raw = process.env.ANT_CHILD_UMASK;
  if (!raw || !raw.trim()) return;
  const parsed = Number.parseInt(raw.trim(), 8);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0o777) {
    logger.warn(
      `[childIdentity] ANT_CHILD_UMASK=${JSON.stringify(raw)} is not an octal mask — ignoring`,
      { component: 'childIdentity' },
    );
    return;
  }
  process.umask(parsed);
}

/** Whether children run under a separate OS identity. Diagnostics only. */
export function hasChildIdentity(): boolean {
  const { uid, gid } = childSpawnIdentity();
  return uid !== undefined || gid !== undefined;
}

/**
 * Fail-closed gate for a cloud spawn of user-authored code.
 *
 * `childSpawnIdentity()` is deliberately fail-open (it returns `{}` and logs
 * loudly when the platform refuses the drop) so a mis-provisioned deployment
 * does not silently 500 every request. But a spawn that runs user code under the
 * SERVICE UID leaves the same-UID `/proc` and shared-workspace-rename vectors
 * open (M-015, M-NEW-015, M-NEW-016, M-014). Where the finding is "user code must
 * not share the service identity", the call site must fail closed instead — this
 * is that gate.
 *
 * In cloud it throws unless a child UID is configured, differs from the service
 * UID, and the platform actually permits the drop (config presence alone is not
 * enough — `hasChildIdentity()` passed on that and was the gap). Local mode is a
 * single-developer trust boundary with no second account, so it is a no-op.
 */
export function assertUserCodeIsolationOrThrow(context: string): void {
  if (process.env.ANT_SERVER_MODE !== 'cloud') return;

  const uid = readId('ANT_CHILD_UID');
  const gid = readId('ANT_CHILD_GID');
  const parentUid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  const distinct = uid !== undefined && (parentUid === undefined || uid !== parentUid);

  // GID is REQUIRED in cloud, not "typically": without it setpriv emits no
  // --regid and the dropped child keeps egid 0 + root's supplementary groups
  // (regression from wiring the service as user:"0:0"). Fail closed.
  if (distinct && gid !== undefined && isDropPermitted({ uid, gid })) return;

  throw new Error(
    `[childIdentity] Refusing to run user-authored code (${context}) without OS isolation. ` +
    'Cloud requires BOTH ANT_CHILD_UID and ANT_CHILD_GID set to an unprivileged account ' +
    'DIFFERENT from the service UID, with the container granted the privilege to change UID/GID. ' +
    'Same-UID children can read the service /proc environment and rename shared-workspace entries; ' +
    'an unset GID leaves the child at egid 0.',
  );
}

/**
 * Wrap a command so it drops to the child UID/GID even when the spawner cannot
 * pass `uid`/`gid` spawn options.
 *
 * `spawn(cmd, args, { uid, gid })` is how preview/deploy children drop — but the
 * MCP SDK's `StdioClientTransport` spawns internally (via cross-spawn) and
 * exposes no uid/gid, so a same-UID stdio MCP child can read the runner's
 * `/proc` environment and the shared credential store (H-014). On Linux we
 * instead re-exec the command under `setpriv` (resolved to an ABSOLUTE path so
 * the tenant's `env.PATH` cannot substitute it — see {@link resolveSetprivAbs}),
 * which changes the UID/GID before `exec`. Unset ids (local single-user mode)
 * return the command unchanged.
 *
 * FAIL-CLOSED in cloud: this is the only isolation the stdio MCP path has, so if
 * the drop cannot be guaranteed (non-Linux runtime, missing UID/GID, or no
 * `setpriv` on the image) it THROWS rather than spawning user code under the
 * service identity. Pair with {@link assertUserCodeIsolationOrThrow}.
 */
export function wrapCommandForChildIdentity(
  command: string,
  args: readonly string[],
): { command: string; args: string[] } {
  const uid = readId('ANT_CHILD_UID');
  const gid = readId('ANT_CHILD_GID');
  const isCloud = process.env.ANT_SERVER_MODE === 'cloud';

  const refuse = (why: string): never => {
    throw new Error(
      `[childIdentity] Refusing to launch a stdio MCP child without a guaranteed UID drop: ${why}. ` +
      'Cloud stdio MCP requires Linux, ANT_CHILD_UID and ANT_CHILD_GID (distinct from the service), ' +
      'and setpriv on the image.',
    );
  };

  if (uid === undefined && gid === undefined) {
    if (isCloud) refuse('no ANT_CHILD_UID/GID configured');
    return { command, args: [...args] };
  }
  if (process.platform !== 'linux') {
    if (isCloud) refuse('non-Linux runtime has no setpriv UID-drop path');
    return { command, args: [...args] };
  }
  if (isCloud && (uid === undefined || gid === undefined)) {
    refuse('cloud requires BOTH ANT_CHILD_UID and ANT_CHILD_GID');
  }
  const launcher = resolveSetprivAbs();
  if (!launcher) {
    if (isCloud) refuse('setpriv not found on the image (install util-linux)');
    return { command, args: [...args] };
  }

  const setprivArgs: string[] = [];
  if (uid !== undefined) setprivArgs.push('--reuid', String(uid));
  if (gid !== undefined) setprivArgs.push('--regid', String(gid));
  // ALWAYS drop root's supplementary groups when dropping identity, regardless
  // of whether --regid is present — otherwise a service running as root leaks
  // group membership into the child.
  setprivArgs.push('--clear-groups');
  setprivArgs.push('--', command, ...args);
  return { command: launcher, args: setprivArgs };
}

export const __testing = {
  reset: () => {
    warned = false;
    dropPermittedByIdentity.clear();
    setprivPathCache = undefined;
  },
};
