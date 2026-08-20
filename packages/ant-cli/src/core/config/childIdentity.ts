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

import { logger } from '../../utils/logger';

export interface ChildSpawnIdentity {
  uid?: number;
  gid?: number;
}

let warned = false;

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

let dropPermitted: boolean | undefined;

/**
 * One cheap probe: spawn the shortest possible process under the target identity.
 * `EPERM` means the platform does not let this process change UIDs, which is a
 * deployment fact rather than a per-spawn one — so it is cached for the process
 * lifetime. Any other failure is treated as "permitted" so a transient error does
 * not silently drop the boundary.
 */
function isDropPermitted(identity: ChildSpawnIdentity): boolean {
  if (dropPermitted !== undefined) return dropPermitted;

  const probe = spawnSync(process.execPath, ['-e', '0'], {
    ...identity,
    stdio: 'ignore',
    timeout: 10_000,
  });
  const code = (probe.error as NodeJS.ErrnoException | undefined)?.code;
  dropPermitted = code !== 'EPERM' && code !== 'EACCES';

  if (!dropPermitted) {
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
  return dropPermitted;
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

  if (distinct && isDropPermitted({ uid, gid })) return;

  throw new Error(
    `[childIdentity] Refusing to run user-authored code (${context}) without OS isolation. ` +
    'Cloud requires ANT_CHILD_UID (and typically ANT_CHILD_GID) set to an unprivileged account ' +
    'DIFFERENT from the service UID, with the container granted the privilege to change UIDs. ' +
    'Same-UID children can read the service /proc environment and rename shared-workspace entries.',
  );
}

export const __testing = {
  reset: () => {
    warned = false;
    dropPermitted = undefined;
  },
};
