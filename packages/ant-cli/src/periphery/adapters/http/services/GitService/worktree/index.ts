import * as fs from 'fs';
import * as path from 'path';
import { SimpleGit } from 'simple-git';
import { WorkspaceResolver } from '../../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../../core/types/user';
import { GitHubAuthService } from '../../../../auth/GitHubAuthService';
import { GitHelper } from '../helper/GitHelper';
import { resolveCommitIdentity } from '../helper/resolveCommitIdentity';
import { assertValidFeatureName } from '../helper/featureNameGuard';
import { ensureCanonicalStructure } from '../../../../../../core/utils/sessionPaths';
import { readBranchBase } from '../../../../../../core/utils/branchUtils';
import { logger } from '../../../../../../utils/logger';
import { GitAuthError, GitNetworkError, GitOperationError } from '../errors';
import { gitAnchor } from '../anchor/GitAnchorSSOT';
import { applyAfterRemoteConverge, BranchBaseContext } from '../anchor/branchBaseLifecycle';
import { GitignoreGenerator } from '../remote/helpers/GitignoreGenerator';

export interface WorktreeInfo {
  path: string;
  branch: string;
  isMain: boolean;
}

/**
 * WorktreeService
 *
 * Manages Git worktrees for feature-based codebase isolation.
 *
 * The project's only real repository is the hidden bare anchor at
 * `{project}/repo.git`. Every feature is an equal linked worktree at
 * `features/{name}/codebase/` whose branch name is EXACTLY the feature name.
 * A project without features has no codebase; the anchor is created lazily
 * by the first feature.
 *
 * Key operations:
 * - createWorktree: attach/track/fork/bootstrap a worktree for a feature
 * - removeWorktree: remove worktree and delete its branch
 * - listWorktrees: list active worktrees from the anchor
 */
export class WorktreeService {
  constructor(
    private readonly workspaceResolver: WorkspaceResolver,
    private readonly githubAuthService?: GitHubAuthService
  ) {}

  private isLocalRepoType(userContext: UserContext, projectId: string): boolean {
    const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
    try {
      const configPath = path.join(projectPath, 'config.json');
      if (!fs.existsSync(configPath)) return false;
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return config.repoType === 'local' && !!config.localPath;
    } catch {
      return false;
    }
  }

  /**
   * Create a worktree for a feature.
   *
   * Branch selection (branch name == feature name), after origin convergence
   * ({@link syncOriginState} — attaches origin from config.githubRepo when the
   * anchor lacks it, e.g. legacy pre-anchor projects):
   * 1. remote branch exists            → track origin/{name} (drops any shadowing
   *                                       local head from a bare-clone import first)
   * 2. local branch exists (no remote) → attach
   * 3. local branchBase exists         → fork from branchBase
   * 4. remote branchBase exists        → fork from origin/{branchBase}, --no-track
   * 5. any commit reachable from HEAD  → fork from HEAD
   * 6. empty anchor (first feature)    → plumbing initial commit, then attach
   */
  async createWorktree(
    projectId: string,
    featureName: string,
    userContext: UserContext
  ): Promise<WorktreeInfo> {
    assertValidFeatureName(featureName);

    const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
    const branchBase = readBranchBase(projectPath);

    // repoType:'local' — user-mapped external codebase shared by every
    // feature. No anchor, no worktrees, no branch mutations of the user's
    // own repository; the feature is a logical alias.
    if (this.isLocalRepoType(userContext, projectId)) {
      logger.info(`Worktree skipped — repoType:'local' shares one codebase`, {
        component: 'WorktreeService',
        projectId,
        featureName,
      });
      const localPath = this.workspaceResolver.getCodebasePath(userContext, projectId, featureName);
      const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
      await fs.promises.mkdir(featurePath, { recursive: true });
      await ensureCanonicalStructure(featurePath);
      return { path: localPath, branch: branchBase, isMain: true };
    }

    const anchorPath = this.workspaceResolver.getGitAnchorPath(userContext, projectId);
    const worktreePath = this.workspaceResolver.getCodebasePath(userContext, projectId, featureName);
    const branchName = featureName;

    logger.info(`Creating worktree for feature: ${featureName}`, {
      component: 'WorktreeService',
      projectId,
      featureName
    });

    // Ensure canonical feature structure (visual/ui/{ant,figma,handoff}, sessions/*, etc).
    // Critical for Git-remote operations (Clone/Sync/Pull/Commit/Push) that materialize feature
    // worktrees without routing through FeatureCrudService.createFeature — this is the single
    // guard that keeps canonical directories consistent for every worktree entry point. Idempotent.
    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    await fs.promises.mkdir(featurePath, { recursive: true });
    await ensureCanonicalStructure(featurePath);

    // Lazy anchor bootstrap — the FIRST feature creates `repo.git`.
    await gitAnchor.ensureAnchor({ projectId, anchorPath, branchBase, userContext });

    const git = GitHelper.getBareGitInstance(anchorPath);
    if (!git) {
      throw new GitOperationError('Git anchor is not ready after bootstrap');
    }
    await GitHelper.ensureUserConfig(git, userContext, await resolveCommitIdentity(this.githubAuthService, userContext));

    // Ensure worktree parent directory exists
    await fs.promises.mkdir(path.dirname(worktreePath), { recursive: true });

    // Handle existing directory at worktree path.
    // Stage-4 validity check (HEAD/commondir verified) — partial gitdir from a
    // previous interrupted attempt no longer false-positives as valid.
    if (fs.existsSync(worktreePath)) {
      const validity = GitHelper.isWorktreeStructureValid(worktreePath);
      if (validity.valid) {
        logger.info(`Valid worktree already exists, skipping creation`, {
          component: 'WorktreeService', projectId, featureName
        });
        return { path: worktreePath, branch: branchName, isMain: false };
      }
      // FeatureCrudService.createFeature mkdir's an empty `codebase/` immediately
      // before WorktreeService.createWorktree — every fresh feature fires
      // `no-git-file` here. That is normal, not a partial-write scenario; warn-level
      // `worktreeValidityFailure` would be a false alarm. Other reasons mean prior
      // attempts left real git artifacts (invalid marker / ghost gitdir / incomplete meta).
      if (!validity.valid && validity.reason === 'no-git-file') {
        logger.info(`Pre-existing empty dir at worktree path; cleaning up before fresh create`, {
          component: 'WorktreeService', projectId, featureName,
        }, { workspacePath: worktreePath, reason: validity.reason });
      } else {
        emitWorktreeValidityFailure({
          callSite: 'createWorktree.preExisting',
          projectId, featureName,
          workspacePath: worktreePath,
          validity,
        });
      }
      // Directory exists without valid worktree structure — clean up properly.
      try { await git.raw(['worktree', 'remove', worktreePath, '--force']); } catch { /* may not be registered */ }
      try { await git.raw(['worktree', 'prune']); } catch { /* non-critical */ }
      if (fs.existsSync(worktreePath)) {
        await fs.promises.rm(worktreePath, { recursive: true, force: true });
      }
      // Second prune AFTER rm — `git worktree add` does NOT auto-prune, so a
      // partial meta dir whose worktree path was just removed would otherwise
      // make the next add fail with "missing but already registered worktree".
      // `--expire=now` bypasses the 1h safe.expire window.
      try { await git.raw(['worktree', 'prune', '--expire=now']); } catch { /* non-critical */ }
    }

    // Converge origin state (attach/refresh origin + refspec from config,
    // fetch), then check whether a remote branch matches the feature name.
    const { originReady, branchBase: effectiveBase } = await this.syncOriginState(
      git,
      anchorPath,
      projectId,
      userContext,
      branchBase
    );
    let remoteExists = false;
    if (originReady) {
      remoteExists = await gitAnchor.remoteBranchExists(anchorPath, branchName);
      logger.info(`Remote branch check: ${branchName} ${remoteExists ? 'EXISTS' : 'NOT FOUND'}`, {
        component: 'WorktreeService',
        projectId,
        featureName
      });
    }

    const localExists = await gitAnchor.branchExists(anchorPath, branchName);
    let bootstrappedInitialCommit = false;

    if (remoteExists) {
      // A matching remote branch is authoritative — the worktree must track it.
      // `git clone --bare` imports every remote branch as a local head
      // (refs/heads/*); such a surplus head would otherwise shadow this path and
      // pin the worktree to the stale clone-time commit with no upstream. Drop it
      // so the worktree is (re)created tracking origin/{name} at its current tip.
      // Safe: at create time a local head with a remote counterpart is a
      // bare-clone artifact — feature deletion `branch -D`s user branches.
      if (localExists) {
        await git.raw(['branch', '-D', branchName]);
      }
      await git.raw(['worktree', 'add', '--track', '-b', branchName, worktreePath, `origin/${branchName}`]);
      logger.info(`Created worktree tracking remote branch: origin/${branchName}`, {
        component: 'WorktreeService',
        projectId,
        featureName
      });
    } else if (localExists) {
      // Branch exists locally (no remote counterpart) - create worktree pointing to it
      await git.raw(['worktree', 'add', worktreePath, branchName]);
      logger.info(`Created worktree from existing local branch: ${branchName}`, {
        component: 'WorktreeService',
        projectId,
        featureName
      });
    } else if (await gitAnchor.branchExists(anchorPath, effectiveBase)) {
      // Fork from the base branch
      await git.raw(['worktree', 'add', '-b', branchName, worktreePath, effectiveBase]);
      logger.info(`Created worktree forked from base branch: ${effectiveBase} → ${branchName}`, {
        component: 'WorktreeService',
        projectId,
        featureName
      });
    } else if (originReady && await gitAnchor.remoteBranchExists(anchorPath, effectiveBase)) {
      // Connected anchor with no local base head (lazily-converged legacy
      // anchor: fetch populates refs/remotes/origin/* only, unlike clone).
      // Fork the NEW branch from the remote base tip. --no-track is
      // load-bearing — branch.autoSetupMerge would otherwise set upstream to
      // origin/{branchBase}, making the FE offer pull/sync against the wrong
      // branch instead of Publish for a genuinely-new branch.
      await git.raw(['worktree', 'add', '--no-track', '-b', branchName, worktreePath, `origin/${effectiveBase}`]);
      logger.info(`Created worktree forked from remote base: origin/${effectiveBase} → ${branchName}`, {
        component: 'WorktreeService',
        projectId,
        featureName
      });
    } else if (await this.hasAnyCommit(git)) {
      // branchBase branch is missing but the anchor has history — fork from HEAD.
      await git.raw(['worktree', 'add', '-b', branchName, worktreePath, 'HEAD']);
      logger.info(`Created worktree forked from HEAD (base branch '${effectiveBase}' missing)`, {
        component: 'WorktreeService',
        projectId,
        featureName
      });
    } else {
      // Empty anchor — FIRST feature. Create an initial commit via plumbing
      // (version-safe alternative to `worktree add --orphan`), attach, then
      // seed .gitignore/README with a normal commit from the worktree.
      await gitAnchor.createInitialCommitOnBranch(anchorPath, branchName, userContext);
      await git.raw(['worktree', 'add', worktreePath, branchName]);
      bootstrappedInitialCommit = true;
      logger.info(`Created first worktree with initial commit: ${branchName}`, {
        component: 'WorktreeService',
        projectId,
        featureName
      });
    }

    // Ensure safe.directory for the worktree
    await GitHelper.ensureSafeDirectory(worktreePath);

    if (bootstrappedInitialCommit) {
      await this.seedInitialWorktree(worktreePath, projectId, userContext);
    }

    // Post-create probe — verify gitdir actually has HEAD/commondir on EFS.
    // `git worktree add` returning exit-code 0 is not enough: NFS partial
    // writes on EFS can leave the meta directory incomplete. We poll briefly
    // to absorb eventual-consistency lag, then throw if still invalid so the
    // caller surfaces the failure to the user (retry → ensureGitRepository
    // self-heal). Without this, silent partial worktrees survive and only
    // break later in GitStatusService.
    const probe = await pollWorktreeValidity(worktreePath, 3, 100);
    if (!probe.valid) {
      emitWorktreeValidityFailure({
        callSite: 'createWorktree.postCreate',
        projectId, featureName,
        workspacePath: worktreePath,
        validity: probe,
      });
      throw new GitOperationError(
        `Worktree creation reported success but validity check failed (${probe.reason}). ` +
          `Likely cause: NFS partial write on EFS. ` +
          `Retry — ensureGitRepository will self-heal.`,
        500,
      );
    }

    return { path: worktreePath, branch: branchName, isMain: false };
  }

  private async hasAnyCommit(git: SimpleGit): Promise<boolean> {
    try {
      await git.raw(['rev-parse', '--verify', 'HEAD']);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Seed the very first worktree of a fresh anchor with `.gitignore` +
   * README and commit them from the worktree (normal porcelain commit —
   * keeps plumbing usage minimal).
   */
  private async seedInitialWorktree(
    worktreePath: string,
    projectId: string,
    userContext: UserContext
  ): Promise<void> {
    try {
      const gitignorePath = path.join(worktreePath, '.gitignore');
      if (!fs.existsSync(gitignorePath)) {
        const gitignoreContent = await GitignoreGenerator.generate(worktreePath);
        await fs.promises.writeFile(gitignorePath, gitignoreContent, 'utf-8');
      }
      const readmePath = path.join(worktreePath, 'README.md');
      if (!fs.existsSync(readmePath)) {
        await fs.promises.writeFile(
          readmePath,
          `# ${projectId}\n\nGenerated by ANT\n`,
          'utf-8'
        );
      }
      const wtGit = GitHelper.getGitInstanceSafe(worktreePath);
      if (!wtGit) return;
      await GitHelper.ensureUserConfig(wtGit, userContext, await resolveCommitIdentity(this.githubAuthService, userContext));
      await wtGit.add('.');
      const status = await wtGit.status();
      if (status.files.length > 0) {
        await wtGit.commit('Initial commit from ANT');
      }
    } catch (error) {
      logger.warn(`Initial worktree seed failed (non-critical)`, { component: 'WorktreeService' }, {
        worktreePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Remove a worktree for a feature.
   * Also deletes the local branch after removal.
   *
   * NOTE: when the feature IS the base branch, the caller
   * (FeatureCrudService.deleteFeature) repoints the anchor HEAD via
   * `applyBeforeBaseFeatureDelete` BEFORE calling this — `branch -D` on the
   * HEAD branch of the bare anchor would otherwise be refused.
   */
  async removeWorktree(
    projectId: string,
    featureName: string,
    userContext: UserContext
  ): Promise<void> {
    // repoType:'local' — never touch the user-owned repository (no worktree
    // was created, and deleting a branch named after the feature could hit a
    // real user branch).
    if (this.isLocalRepoType(userContext, projectId)) {
      logger.info(`Worktree remove skipped — repoType:'local'`, {
        component: 'WorktreeService',
        projectId,
        featureName,
      });
      return;
    }

    const anchorPath = this.workspaceResolver.getGitAnchorPath(userContext, projectId);
    const worktreePath = this.workspaceResolver.getCodebasePath(userContext, projectId, featureName);
    const branchName = featureName;

    logger.info(`Removing worktree for feature: ${featureName}`, {
      component: 'WorktreeService',
      projectId,
      featureName
    });

    const git = GitHelper.getBareGitInstance(anchorPath);
    if (!git) {
      // No anchor - just remove the directory
      if (fs.existsSync(worktreePath)) {
        await fs.promises.rm(worktreePath, { recursive: true, force: true });
      }
      return;
    }

    // Remove the worktree
    try {
      await git.raw(['worktree', 'remove', worktreePath, '--force']);
      logger.info(`Worktree removed: ${worktreePath}`, {
        component: 'WorktreeService',
        projectId,
        featureName
      });
    } catch (err: any) {
      // Worktree might not be registered (e.g., if the anchor didn't exist when feature was created)
      logger.warn(`Worktree remove failed (cleaning up directory): ${err.message}`, {
        component: 'WorktreeService',
        projectId,
        featureName
      });
      if (fs.existsSync(worktreePath)) {
        await fs.promises.rm(worktreePath, { recursive: true, force: true });
      }
    }

    // Sweep corrupt `repo.git/worktrees/{id}` metadata that bare prune
    // would leave behind for `safe.expire` (1h default).
    await WorktreeService.pruneCorruptWorktreeMeta(anchorPath);

    // Delete the local branch
    try {
      await git.branch(['-D', branchName]);
      logger.info(`Deleted local branch: ${branchName}`, {
        component: 'WorktreeService',
        projectId,
        featureName
      });
    } catch (err: any) {
      logger.warn(`Could not delete branch ${branchName} (may not exist): ${err.message}`, {
        component: 'WorktreeService',
        projectId,
        featureName
      });
    }
  }

  /**
   * Sweep corrupted / orphaned worktree metadata under `repo.git/worktrees/`.
   *
   * Distinct from `ProjectCrudService.repairGitWorktrees` (which calls
   * `git worktree repair {paths}` to refresh absolute paths after a project
   * rename). This helper covers the opposite case: the worktree on disk is
   * gone but the metadata directory under `repo.git/worktrees/` lingers.
   *
   * Steps:
   *   1. Walk `repo.git/worktrees/` directly. Each subdir's `gitdir` file
   *      contains the absolute path to the worktree's `.git` marker —
   *      its dirname is the actual worktree directory.
   *   2. If that directory is missing OR its `.git` marker is gone,
   *      `fs.rm` the meta directory. (Independent of branch name —
   *      git names meta dirs after the worktree path basename, not the
   *      branch.)
   *   3. `git worktree prune --expire=now` — bypass the 1h safe-expire
   *      window that bare `prune` honours.
   *
   * Public + static so cloud-ide.routes.ts can call it (throttled) before
   * pod start without instantiating WorktreeService.
   *
   * @param anchorPath - the project's bare anchor (`{project}/repo.git`)
   */
  static async pruneCorruptWorktreeMeta(anchorPath: string): Promise<void> {
    const git = GitHelper.getBareGitInstance(anchorPath);
    if (!git) return;

    const worktreesDir = path.join(anchorPath, 'worktrees');
    let removed = 0;

    try {
      const metaEntries = await fs.promises.readdir(worktreesDir, { withFileTypes: true });
      for (const entry of metaEntries) {
        if (!entry.isDirectory()) continue;
        const metaDir = path.join(worktreesDir, entry.name);
        const gitdirFile = path.join(metaDir, 'gitdir');

        let worktreeMarkerPath: string | null = null;
        try {
          const content = await fs.promises.readFile(gitdirFile, 'utf-8');
          worktreeMarkerPath = content.trim();
        } catch {
          // gitdir file missing → meta is corrupt; remove
        }

        // Weak orphan check: marker file or worktree dir gone.
        const physicalOrphan =
          worktreeMarkerPath === null ||
          !fs.existsSync(worktreeMarkerPath) ||
          !fs.existsSync(path.dirname(worktreeMarkerPath));
        // Strong orphan check (Stage-4): worktree dir exists but the meta gitdir
        // is partial (HEAD or commondir missing). Catches NFS partial-write
        // remnants that would otherwise survive bare `git worktree prune`.
        let structuralOrphan = false;
        if (!physicalOrphan && worktreeMarkerPath) {
          const validity = GitHelper.isWorktreeStructureValid(path.dirname(worktreeMarkerPath));
          if (!validity.valid) {
            structuralOrphan = true;
            emitWorktreeValidityFailure({
              callSite: 'pruneCorruptWorktreeMeta',
              projectId: undefined,
              featureName: undefined,
              workspacePath: path.dirname(worktreeMarkerPath),
              validity,
            });
          }
        }
        const orphan = physicalOrphan || structuralOrphan;
        if (!orphan) continue;

        try {
          await fs.promises.rm(metaDir, { recursive: true, force: true });
          removed += 1;
          logger.info(`[WorktreeService] Pruned orphan worktree meta: ${metaDir}`, { component: 'WorktreeService' });
        } catch (err: any) {
          logger.warn(`[WorktreeService] Failed to rm orphan meta ${metaDir}: ${err.message}`, { component: 'WorktreeService' });
        }
      }
    } catch (err: any) {
      // worktrees dir may not exist yet (no features) — that's fine
      if (err?.code !== 'ENOENT') {
        logger.warn(`[WorktreeService] readdir worktrees failed: ${err.message}`, { component: 'WorktreeService' });
      }
    }

    // Final prune — bypass the 1-hour safe.expire window so any internal
    // bookkeeping git tracks separately from the meta dirs is also cleared.
    try {
      await git.raw(['worktree', 'prune', '--expire=now']);
    } catch (err: any) {
      logger.warn(`[WorktreeService] worktree prune --expire=now failed: ${err.message}`, { component: 'WorktreeService' });
    }

    if (removed > 0) {
      logger.info(`[WorktreeService] pruneCorruptWorktreeMeta removed ${removed} orphan(s) under ${worktreesDir}`, {
        component: 'WorktreeService',
      });
    }
  }

  /**
   * List all worktrees for a project (the bare anchor entry is excluded).
   */
  async listWorktrees(
    projectId: string,
    userContext: UserContext
  ): Promise<WorktreeInfo[]> {
    const anchorPath = this.workspaceResolver.getGitAnchorPath(userContext, projectId);

    const git = GitHelper.getBareGitInstance(anchorPath);
    if (!git) {
      return [];
    }

    try {
      const output = await git.raw(['worktree', 'list', '--porcelain']);
      const worktrees: WorktreeInfo[] = [];

      const blocks = output.split('\n\n').filter(b => b.trim());
      for (const block of blocks) {
        const lines = block.split('\n');
        let wtPath = '';
        let branch = '';
        let isBare = false;

        for (const line of lines) {
          if (line.startsWith('worktree ')) {
            wtPath = line.substring('worktree '.length);
          }
          if (line.startsWith('branch ')) {
            branch = line.substring('branch refs/heads/'.length);
          }
          if (line.trim() === 'bare') {
            isBare = true;
          }
        }

        if (wtPath && !isBare) {
          worktrees.push({
            path: wtPath,
            branch: branch || 'HEAD',
            isMain: false,
          });
        }
      }

      return worktrees;
    } catch {
      return [];
    }
  }

  /**
   * Converge the anchor's origin state with the project config before the
   * branch-selection ladder runs, and fetch so remote-branch checks see
   * fresh refs.
   *
   * `config.githubRepo` is written by project setup BEFORE clone/init runs,
   * so "githubRepo set" does not mean "connected". Convergence is therefore
   * transactional: origin (+ fetch refspec) is added, probed with a fetch,
   * and KEPT only when the probe proves a live remote with at least one
   * branch. Otherwise the added origin is rolled back — origin presence is
   * load-bearing (branchBase lock, Init/Publish eligibility) and must keep
   * meaning "clone/init/converge actually exchanged refs with a live remote".
   *
   * This is how legacy projects (pre-bare-anchor, connected via the old
   * `{project}/codebase/.git`) converge onto the anchor: their first
   * post-migration feature attaches origin and tracks the existing remote
   * branches instead of bootstrapping an orphan history.
   */
  private async syncOriginState(
    git: SimpleGit,
    anchorPath: string,
    projectId: string,
    userContext: UserContext,
    branchBase: string
  ): Promise<{ originReady: boolean; branchBase: string }> {
    if (!this.githubAuthService) return { originReady: false, branchBase };

    const hadOrigin = await gitAnchor.hasOriginRemote(anchorPath);
    const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);

    let authenticatedUrl: string | null = null;
    const githubRepo = this.readGithubRepo(projectPath);
    if (githubRepo) {
      try {
        authenticatedUrl = await this.githubAuthService.buildAuthenticatedUrl(
          { org: userContext.organizationId, user: userContext.userId },
          githubRepo
        );
      } catch {
        // PAT unavailable — cannot (re)wire origin; fall through to the
        // best-effort fetch of whatever origin already exists.
        logger.info(`PAT unavailable — skipping origin convergence`, {
          component: 'WorktreeService',
          projectId
        });
      }
    }

    if (!authenticatedUrl) {
      if (hadOrigin) {
        try {
          await git.fetch(['origin']);
        } catch {
          logger.info(`Could not fetch origin (non-critical)`, {
            component: 'WorktreeService',
            projectId
          });
        }
      }
      return { originReady: hadOrigin, branchBase };
    }

    const { added } = await gitAnchor.ensureOriginWithRefspec(anchorPath, authenticatedUrl);

    try {
      await git.fetch(['origin']);
    } catch (error) {
      if (added) {
        await gitAnchor.removeOriginRemote(anchorPath);
      }
      const message = error instanceof Error ? error.message : String(error);
      const lower = message.toLowerCase();

      if (
        lower.includes('repository not found') ||
        lower.includes('does not appear to be a git repository')
      ) {
        // Publish(init) flow — githubRepo is declared before the repo
        // exists on GitHub. Proceed with the local ladder.
        return { originReady: false, branchBase };
      }
      if (!added) {
        // Origin pre-existed (cloned/converged earlier) — a transient fetch
        // failure must not block feature creation. Proceed on the stale
        // remote-tracking refs when they exist; tracking set from a stale
        // tip heals on the next pull.
        const hasStaleRefs = await gitAnchor.hasAnyRemoteTrackingRef(anchorPath);
        logger.warn(`Origin fetch failed — proceeding with stale remote refs`, {
          component: 'WorktreeService',
          projectId
        }, { error: message, hasStaleRefs });
        return { originReady: hasStaleRefs, branchBase };
      }
      if (await this.hasAnyCommit(git)) {
        // Anchor has history — creation can fork the local base; a stale
        // remote check only degrades tracking, not correctness.
        logger.warn(`Origin fetch failed (non-critical, anchor has history)`, {
          component: 'WorktreeService',
          projectId
        }, { error: message });
        return { originReady: false, branchBase };
      }
      // The no-origin→origin transition failed on an EMPTY anchor of a
      // connected-looking project: falling through would bootstrap an orphan
      // history permanently diverged from the remote. Fail loud instead —
      // the error is actionable/retryable.
      if (
        lower.includes('authentication failed') ||
        lower.includes('could not read from remote repository')
      ) {
        throw new GitAuthError(
          `GitHub authentication failed while connecting the project repository (${githubRepo}). ` +
            `Fix your PAT and retry creating the feature.`,
          { cause: error }
        );
      }
      throw new GitNetworkError(
        `Could not reach the remote repository (${githubRepo}) while creating the first feature: ${message}. ` +
          `Retry once the remote is reachable.`,
        { cause: error }
      );
    }

    if (added && !(await gitAnchor.hasAnyRemoteTrackingRef(anchorPath))) {
      // Empty remote (e.g. leftover of a failed init that created the GitHub
      // repo but rolled back origin) — not meaningfully connected. Keep the
      // anchor unlocked so the Publish(init) retry path stays open.
      await gitAnchor.removeOriginRemote(anchorPath);
      return { originReady: false, branchBase };
    }

    if (added) {
      const ctx: BranchBaseContext = { projectId, projectPath, anchorPath, userContext };
      const converged = await applyAfterRemoteConverge(ctx);
      logger.info(`Anchor origin converged from project config`, {
        component: 'WorktreeService',
        projectId
      }, { branchBase: converged });
      return { originReady: true, branchBase: converged };
    }

    return { originReady: true, branchBase };
  }

  private readGithubRepo(projectPath: string): string | null {
    try {
      const configPath = path.join(projectPath, 'config.json');
      if (!fs.existsSync(configPath)) return null;
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return typeof config.githubRepo === 'string' && config.githubRepo ? config.githubRepo : null;
    } catch {
      return null;
    }
  }
}

/**
 * Poll {@link GitHelper.isWorktreeStructureValid} to absorb NFS eventual
 * consistency lag immediately after `git worktree add`. Returns the first
 * `valid` result, or the last `invalid` result after exhausting retries.
 */
async function pollWorktreeValidity(
  worktreePath: string,
  retries: number,
  delayMs: number,
): Promise<ReturnType<typeof GitHelper.isWorktreeStructureValid>> {
  let result = GitHelper.isWorktreeStructureValid(worktreePath);
  for (let i = 0; i < retries && !result.valid; i += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    result = GitHelper.isWorktreeStructureValid(worktreePath);
  }
  return result;
}

/**
 * Diagnostic logging — single emit point for worktree validity failures so we
 * can correlate user-reported breakages with the underlying scenario without
 * manual EFS inspection. Heuristic scenario classification:
 * - `no-git-file`        → S1 (race / never created)
 * - `head-missing` /
 *   `commondir-missing`  → S2 (NFS partial write)
 * - `gitdir-missing`     → S3 (stale `.git` marker from previous attempt)
 * - `invalid-marker`     → S4 (corrupted marker file)
 *
 * Single SSOT — three call sites (createWorktree.preExisting /
 * createWorktree.postCreate / pruneCorruptWorktreeMeta) plus the
 * `ensureGitRepository` stage-4 path emit through this helper.
 */
type WorktreeValidityCallSite =
  | 'createWorktree.preExisting'
  | 'createWorktree.postCreate'
  | 'pruneCorruptWorktreeMeta'
  | 'ensureGitRepository.stage4'
  | 'StatusService.autoRecover';

export interface EmitWorktreeValidityFailureInput {
  callSite: WorktreeValidityCallSite;
  projectId: string | undefined;
  featureName: string | undefined;
  workspacePath: string;
  validity: ReturnType<typeof GitHelper.isWorktreeStructureValid>;
}

export function emitWorktreeValidityFailure(input: EmitWorktreeValidityFailureInput): void {
  if (input.validity.valid) return;
  const reason = input.validity.reason;

  // Best-effort filesystem snapshot — read the .git marker (if any) and
  // list the meta gitdir (if reachable) so the operator can confirm the
  // exact partial-write shape from the log alone.
  let gitFile: { exists: boolean; size: number | null; content: string | null } = {
    exists: false,
    size: null,
    content: null,
  };
  let gitdirContents: string[] | null = null;
  try {
    const gitPath = path.join(input.workspacePath, '.git');
    if (fs.existsSync(gitPath)) {
      const stat = fs.statSync(gitPath);
      gitFile = {
        exists: true,
        size: stat.isFile() ? stat.size : null,
        content: stat.isFile() ? fs.readFileSync(gitPath, 'utf-8').trim() : null,
      };
    }
  } catch { /* best-effort */ }
  try {
    const abs = GitHelper.resolveWorktreeAbsPaths(input.workspacePath);
    if (abs) {
      // Try to derive the meta gitdir from the marker; if marker is a directory
      // (base case) or missing, abs would be null and we skip the listing.
      const markerContent = gitFile.content;
      const match = markerContent ? markerContent.match(/^gitdir:\s*(.+)$/) : null;
      const gitdirPath = match ? match[1].trim() : null;
      if (gitdirPath && fs.existsSync(gitdirPath)) {
        gitdirContents = fs.readdirSync(gitdirPath).slice(0, 20);
      }
    }
  } catch { /* best-effort */ }

  const scenario =
    reason === 'no-git-file'
      ? 'S1-race-or-never-created'
      : reason === 'head-missing' || reason === 'commondir-missing'
        ? 'S2-nfs-partial-write'
        : reason === 'gitdir-missing'
          ? 'S3-stale-marker-from-previous-attempt'
          : 'S4-corrupt-marker';

  logger.warn(
    'worktreeValidityFailure',
    {
      component: 'WorktreeValidity',
      projectId: input.projectId,
      featureName: input.featureName,
    },
    {
      callSite: input.callSite,
      reason,
      scenario,
      workspacePath: input.workspacePath,
      gitFile,
      gitdirContents,
    },
  );
}
