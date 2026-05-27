import * as fs from 'fs';
import * as path from 'path';
import type {
  FileChange,
  GitSnapshot,
  GitPatState,
} from '@ant/shared';

// Internal wire shapes for the private `getGitStatus` / `getGitChanges`
// helpers that `getSnapshot` composes. These used to be part of the FE
// contract via `GitStatusResponse`/`GitChangesResponse`; at greenfield
// cutover they collapsed into `GitSnapshot` and now exist purely as an
// implementation detail of `StatusService`.
interface InternalGitStatus {
  hasGit: boolean;
  hasCodebase: boolean;
  codebaseHasFiles: boolean;
  hasFeatures: boolean;
  currentBranch?: string;
  remoteUrl?: string;
}

interface InternalGitChanges {
  staged: FileChange[];
  unstaged: FileChange[];
  untracked: FileChange[];
  ahead: number;
  behind: number;
  isGitInitialized: boolean;
  hasUpstream: boolean;
}
import { WorkspaceResolver } from '../../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../../core/types/user';
import { GitHelper } from '../helper/GitHelper';
import { GitHubAuthService } from '../../../../auth/GitHubAuthService';
import { RemoteChecker } from '../remote/helpers/RemoteChecker';
import { emitWorktreeValidityFailure } from '../worktree';
import { detectCodebasePresence } from '../../../../../../core/codebase/detectCodebasePresence';

/**
 * TTL for the GitHub "repo exists" probe cache (milliseconds). Keeps the
 * Setup menu snappy without hammering GitHub's 5000 req/hour PAT quota.
 */
const REMOTE_EXISTS_TTL_MS = 60_000;

interface RemoteExistsCacheEntry {
  value: boolean;
  expiresAt: number;
}

/**
 * StatusService
 *
 * Owner of every Git *read* path. All reads share a single `simple-git`
 * bootstrap and safe-directory guard.
 *
 * Public surface:
 * - {@link StatusService.getSnapshot} — the canonical {@link GitSnapshot}
 *   (readonly, deep-frozen) that the whole FE/BE contract revolves around.
 * - {@link StatusService.getPat} — minimal PAT read path used by the SSE
 *   reconnect refill.
 * - {@link StatusService.checkCloneStatus} — thin probe retained for the
 *   Project Wizard's post-clone polling helper.
 *
 * Internal helpers (`getGitStatus`, `getGitChanges`) compose `getSnapshot`
 * and are not exported from the service boundary.
 */
export class StatusService {
  private readonly workspaceResolver: WorkspaceResolver;
  private readonly githubAuthService?: GitHubAuthService;
  private readonly remoteExistsCache = new Map<string, RemoteExistsCacheEntry>();

  constructor(
    workspaceResolver: WorkspaceResolver,
    githubAuthService?: GitHubAuthService,
  ) {
    this.workspaceResolver = workspaceResolver;
    this.githubAuthService = githubAuthService;
  }

  async getGitStatus(
    projectId: string,
    userContext: UserContext,
    featureName?: string,
  ): Promise<InternalGitStatus> {
    try {
      const codebasePath = this.workspaceResolver.getCodebasePath(userContext, projectId, featureName);

      // `hasCodebase` is the manifest-based SSOT (a real dependency/build
      // manifest is present) — shared with triage's `WorkspaceState`. The raw
      // physical facts stay local: `codebaseDirExists` guards the readdir, and
      // `codebaseHasFiles` (any non-hidden, non-node_modules file) drives
      // ref-entry resolution on the FE.
      const codebaseDirExists = fs.existsSync(codebasePath);
      const hasCodebase = detectCodebasePresence(codebasePath);
      const gitDir = path.join(codebasePath, '.git');
      const hasGit = fs.existsSync(gitDir);

      let codebaseHasFiles = false;
      if (codebaseDirExists) {
        try {
          const items = fs.readdirSync(codebasePath);
          codebaseHasFiles = items.some(name => !name.startsWith('.') && name !== 'node_modules');
        } catch { /* empty */ }
      }

      const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
      const featuresPath = path.join(projectPath, 'features');
      const hasFeatures = fs.existsSync(featuresPath) &&
        fs.readdirSync(featuresPath).filter(f => !f.startsWith('.')).length > 0;

      let currentBranch: string | undefined;
      let remoteUrl: string | undefined;
      if (hasGit) {
        try {
          await GitHelper.ensureSafeDirectory(codebasePath);

          const git = GitHelper.getGitInstanceSafe(codebasePath);
          if (git) {
            currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);

            try {
              const raw = await git.remote(['get-url', 'origin']);
              if (raw) {
                remoteUrl = raw.trim()
                  .replace(/\/\/[^@]+@/, '//')
                  .replace(/\.git$/, '');
              }
            } catch { /* no remote configured */ }
          }
        } catch (error) {
          console.warn('[GitStatusService] Failed to get current branch:', error);
        }
      }

      return { hasGit, hasCodebase, codebaseHasFiles, hasFeatures, currentBranch, remoteUrl };
    } catch (error: any) {
      if (error?.code === 'ENOENT' || error?.code === 'EACCES') {
        return { hasGit: false, hasCodebase: false, codebaseHasFiles: false, hasFeatures: false };
      }
      console.error('[GitStatusService] Error checking Git status:', error);
      throw error;
    }
  }

  async getGitChanges(
    projectId: string,
    userContext: UserContext,
    featureName?: string,
  ): Promise<InternalGitChanges> {
    try {
      const codebasePath = this.workspaceResolver.getCodebasePath(userContext, projectId, featureName);

      await GitHelper.ensureSafeDirectory(codebasePath);

      const git = GitHelper.getGitInstanceSafe(codebasePath);
      if (!git) {
        return {
          staged: [],
          unstaged: [],
          untracked: [],
          ahead: 0,
          behind: 0,
          isGitInitialized: false,
          hasUpstream: false,
        };
      }

      const status = await git.status();

      const staged: FileChange[] = [];
      const unstaged: FileChange[] = [];
      const untracked: FileChange[] = [];

      for (const file of status.files) {
        if (file.index === '?' && file.working_dir === '?') {
          untracked.push({ path: file.path, status: 'new' });
          continue;
        }
        if (file.index && file.index !== ' ' && file.index !== '?') {
          const st = file.index === 'A' ? 'new' as const
            : file.index === 'D' ? 'deleted' as const
            : file.index === 'R' ? 'renamed' as const
            : 'modified' as const;
          staged.push({ path: file.path, status: st });
        }
        if (file.working_dir && file.working_dir !== ' ' && file.working_dir !== '?') {
          const st = file.working_dir === 'D' ? 'deleted' as const : 'modified' as const;
          unstaged.push({ path: file.path, status: st });
        }
      }

      let ahead = status.ahead || 0;
      let behind = status.behind || 0;
      let hasUpstream = true;

      try {
        const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
        try {
          await git.revparse(['--abbrev-ref', `${currentBranch}@{upstream}`]);
        } catch {
          hasUpstream = false;
          ahead = 0;
          behind = 0;
        }
      } catch (branchError) {
        console.warn('[GitStatusService] Failed to get current branch:', branchError);
        hasUpstream = false;
        ahead = 0;
        behind = 0;
      }

      return {
        staged,
        unstaged,
        untracked,
        ahead,
        behind,
        isGitInitialized: true,
        hasUpstream,
      };
    } catch (error) {
      // Defense-in-depth: surface partial-worktree breakages with structured
      // telemetry so the operator can correlate them with createWorktree /
      // ensureGitRepository self-heal events without manual EFS inspection.
      // The next cloud-ide.start will self-heal via Phase 4 — this branch
      // exists to capture status-poll-only callers.
      const errorMessage = (error as Error)?.message ?? String(error);
      if (/not a git repository/i.test(errorMessage)) {
        try {
          const codebasePath = this.workspaceResolver.getCodebasePath(userContext, projectId, featureName);
          const validity = GitHelper.isWorktreeStructureValid(codebasePath);
          if (!validity.valid) {
            emitWorktreeValidityFailure({
              callSite: 'StatusService.autoRecover',
              projectId,
              featureName,
              workspacePath: codebasePath,
              validity,
            });
          }
        } catch { /* best-effort diagnostic only */ }
      }
      console.error('[GitStatusService] Error getting Git changes:', error);
      throw error;
    }
  }

  /**
   * Check if GitHub repository clone is complete
   */
  async checkCloneStatus(projectId: string, userContext: UserContext): Promise<boolean> {
    try {
      const codebasePath = this.workspaceResolver.getCodebasePath(userContext, projectId);
      const gitDir = path.join(codebasePath, '.git');
      return fs.existsSync(gitDir);
    } catch (error) {
      console.error('[GitStatusService] Error checking clone status:', error);
      return false;
    }
  }

  /**
   * Unified canonical Git snapshot.
   *
   * Composes status + changes + (Setup-only) GitHub repo existence probe
   * into the single readonly {@link GitSnapshot}. The result is deep-frozen
   * so downstream code cannot mutate shared state — any would-be mutation
   * fails at runtime, complementing the `Readonly<...>` type-level guard.
   *
   * `remoteExists` is populated only in Setup states (`!hasGit || !hasRemote`)
   * and cached for {@link REMOTE_EXISTS_TTL_MS} ms to shield GitHub rate
   * limits. `opts.fresh === true` bypasses the cache (used by `?fresh=true`
   * on the `/git/state` endpoint).
   */
  async getSnapshot(
    projectId: string,
    userContext: UserContext,
    featureName?: string,
    opts: { fresh?: boolean } = {},
  ): Promise<GitSnapshot> {
    const [status, changes] = await Promise.all([
      this.getGitStatus(projectId, userContext, featureName),
      this.getGitChanges(projectId, userContext, featureName),
    ]);

    const hasRemote = Boolean(status.remoteUrl);
    const coreBase: Omit<GitSnapshot, 'remoteExists'> = {
      hasGit: status.hasGit,
      hasRemote,
      hasCodebase: status.hasCodebase,
      codebaseHasFiles: status.codebaseHasFiles,
      hasFeatures: status.hasFeatures,
      currentBranch: status.currentBranch,
      remoteUrl: status.remoteUrl,
      hasUpstream: changes.hasUpstream,
      ahead: changes.ahead,
      behind: changes.behind,
      staged: changes.staged,
      unstaged: changes.unstaged,
      untracked: changes.untracked,
    };

    let remoteExists: boolean | undefined;
    if (!coreBase.hasGit || !coreBase.hasRemote) {
      remoteExists = await this.probeRemoteExists(projectId, userContext, opts.fresh === true);
    }

    return deepFreezeSnapshot({ ...coreBase, remoteExists });
  }

  /**
   * Minimal PAT read surface used by the SSE reconnect refill path and the
   * {@link StatusService.getSnapshot} consumers that need to report PAT
   * state alongside the snapshot. Returns `{ configured: false }` when the
   * auth service is absent or the probe fails.
   */
  async getPat(userContext: UserContext): Promise<GitPatState> {
    if (!this.githubAuthService) {
      return { configured: false };
    }
    try {
      const cred = {
        org: userContext.organizationId,
        user: userContext.userId,
      };
      const pat = await this.githubAuthService.getPAT(cred);
      if (!pat) {
        return { configured: false };
      }
      // `getUsername` transparently backfills legacy credentials missing the
      // username. Tolerate failures so a transient GitHub outage doesn't
      // degrade the snapshot to `configured: false`.
      let username: string | undefined;
      try {
        const got = await this.githubAuthService.getUsername(cred);
        if (got) username = got;
      } catch { /* best-effort */ }
      return { configured: true, username };
    } catch (error: any) {
      console.warn('[StatusService] getPat probe failed:', error?.message ?? error);
      return { configured: false };
    }
  }

  private async probeRemoteExists(
    projectId: string,
    userContext: UserContext,
    fresh: boolean,
  ): Promise<boolean | undefined> {
    const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
    const configPath = path.join(projectPath, 'config.json');
    if (!fs.existsSync(configPath)) return undefined;

    let githubRepo: string | undefined;
    try {
      const config = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
      githubRepo = typeof config.githubRepo === 'string' ? config.githubRepo : undefined;
    } catch {
      return undefined;
    }
    if (!githubRepo) return undefined;

    const cacheKey = `${userContext.organizationId}:${userContext.userId}:${githubRepo}`;
    const now = Date.now();

    if (!fresh) {
      const cached = this.remoteExistsCache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        return cached.value;
      }
    }

    try {
      const exists = await RemoteChecker.exists(githubRepo, userContext, this.githubAuthService);
      this.remoteExistsCache.set(cacheKey, {
        value: exists,
        expiresAt: now + REMOTE_EXISTS_TTL_MS,
      });
      return exists;
    } catch (error: any) {
      // Auth/transport errors are not fatal — the UI falls back to the
      // `[Clone] [Publish]` two-button state when `remoteExists` is
      // undefined.
      console.warn('[StatusService] remoteExists probe failed:', error?.message ?? error);
      return undefined;
    }
  }
}

/**
 * Recursively freeze the snapshot object so mutation attempts throw in
 * strict mode. Matches the `Readonly<...>` type-level guard on
 * {@link GitSnapshot}.
 */
function deepFreezeSnapshot(snapshot: GitSnapshot): GitSnapshot {
  Object.freeze(snapshot);
  Object.freeze(snapshot.staged);
  Object.freeze(snapshot.unstaged);
  Object.freeze(snapshot.untracked);
  snapshot.staged.forEach((file) => Object.freeze(file));
  snapshot.unstaged.forEach((file) => Object.freeze(file));
  snapshot.untracked.forEach((file) => Object.freeze(file));
  return snapshot;
}
