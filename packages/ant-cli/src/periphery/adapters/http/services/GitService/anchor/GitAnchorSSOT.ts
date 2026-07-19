import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import simpleGit, { SimpleGit } from 'simple-git';
import { UserContext } from '../../../../../../core/types/user';
import { GitHelper, SIMPLE_GIT_DEFAULT_OPTS } from '../helper/GitHelper';
import { GitConfigError } from '../errors';
import { logger } from '../../../../../../utils/logger';

export type GitAnchorFailureReason =
  | 'permissionDenied'
  | 'gitBinaryMissing'
  | 'gitInitFailed'
  | 'gitCommitFailed'
  | 'safeDirectory'
  | 'userConfig'
  | 'unknown';

export interface EnsureAnchorRequest {
  projectId: string;
  anchorPath: string;
  branchBase: string;
  userContext: UserContext;
}

/**
 * GitAnchorSSOT
 *
 * Single owner of the project's bare git anchor (`{project}/repo.git`).
 * The anchor is the only real repository — every feature is a linked worktree
 * whose branch name is exactly the feature name. The anchor HEAD symbolic-ref
 * always points at `refs/heads/{branchBase}`.
 *
 * The anchor is created lazily by the FIRST feature; a fresh project has no
 * git and no codebase. All operations here are plumbing-safe on empty repos
 * and require only git >= 2.30.
 */
export class GitAnchorSSOT {
  private readonly component = 'GitAnchorSSOT';

  private git(anchorPath: string): SimpleGit {
    // Explicit GIT_DIR keeps bare usage legal under
    // `safe.bareRepository=explicit` (cwd-discovery of bare repos is
    // rejected in that mode).
    return simpleGit({ baseDir: anchorPath, ...SIMPLE_GIT_DEFAULT_OPTS })
      .env(GitHelper.bareAnchorEnv(anchorPath));
  }

  /**
   * Ensure the bare anchor exists (idempotent). Creates `repo.git` via
   * `git init --bare` when missing, points HEAD at branchBase, and applies
   * safe.directory + repo-local user config.
   */
  async ensureAnchor(request: EnsureAnchorRequest): Promise<{ created: boolean }> {
    const { projectId, anchorPath, branchBase, userContext } = request;
    let created = false;

    try {
      if (!GitHelper.isBareAnchorReady(anchorPath)) {
        await fs.promises.mkdir(anchorPath, { recursive: true });
        await simpleGit(SIMPLE_GIT_DEFAULT_OPTS).raw(['init', '--bare', anchorPath]);
        created = true;
      }

      await GitHelper.ensureSafeDirectory(anchorPath);
      const git = this.git(anchorPath);
      await GitHelper.ensureUserConfig(git, userContext);

      // Keep HEAD aligned with branchBase (harmless when the branch doesn't
      // exist yet — the first worktree/commit will materialize it).
      const head = await this.readHeadBranch(anchorPath);
      if (head !== branchBase) {
        await this.setHeadBranch(anchorPath, branchBase);
      }

      if (created) {
        logger.info('gitAnchorCreated', {
          component: this.component,
          organizationId: userContext.organizationId,
          userId: userContext.userId,
          projectId,
        }, { anchorPath, branchBase });
      }

      return { created };
    } catch (error) {
      const reason = this.classifyFailureReason(error);
      const message = error instanceof Error ? error.message : String(error);
      logger.error('gitAnchorFailure', {
        component: this.component,
        organizationId: userContext.organizationId,
        userId: userContext.userId,
        projectId,
      }, { anchorPath, branchBase, reason, error: message });
      throw new GitConfigError(
        `Failed to prepare git anchor (${reason}): ${message}`,
        { retryable: false }
      );
    }
  }

  async branchExists(anchorPath: string, name: string): Promise<boolean> {
    try {
      await this.git(anchorPath).raw(['show-ref', '--verify', `refs/heads/${name}`]);
      return true;
    } catch {
      return false;
    }
  }

  async remoteBranchExists(anchorPath: string, name: string): Promise<boolean> {
    try {
      await this.git(anchorPath).raw(['show-ref', '--verify', `refs/remotes/origin/${name}`]);
      return true;
    } catch {
      return false;
    }
  }

  async hasOriginRemote(anchorPath: string): Promise<boolean> {
    if (!GitHelper.isBareAnchorReady(anchorPath)) return false;
    try {
      const remotes = await this.git(anchorPath).getRemotes();
      return remotes.some((r) => r.name === 'origin');
    } catch {
      return false;
    }
  }

  async readHeadBranch(anchorPath: string): Promise<string | null> {
    try {
      const ref = await this.git(anchorPath).raw(['symbolic-ref', '--short', 'HEAD']);
      return ref.trim() || null;
    } catch {
      return null;
    }
  }

  async setHeadBranch(anchorPath: string, branch: string): Promise<void> {
    await this.git(anchorPath).raw(['symbolic-ref', 'HEAD', `refs/heads/${branch}`]);
  }

  /**
   * Create an initial (empty-tree) commit on `branch` inside an empty bare
   * anchor via plumbing — version-safe alternative to `worktree add --orphan`
   * (git 2.42+). The first worktree attaches to this commit and seeds real
   * content with a normal commit.
   */
  async createInitialCommitOnBranch(
    anchorPath: string,
    branch: string,
    userContext: UserContext
  ): Promise<string> {
    const git = this.git(anchorPath);
    // Empty tree via `hash-object -t tree <devNull>` — object-format-agnostic
    // (sha1/sha256) and stdin-free (`mktree` would block forever waiting for
    // stdin EOF under simple-git).
    const tree = (await git.raw(['hash-object', '-w', '-t', 'tree', os.devNull])).trim();
    const env = {
      ...GitHelper.bareAnchorEnv(anchorPath),
      GIT_AUTHOR_NAME: userContext.userId,
      GIT_AUTHOR_EMAIL: `${userContext.userId}@${userContext.organizationId}`,
      GIT_COMMITTER_NAME: userContext.userId,
      GIT_COMMITTER_EMAIL: `${userContext.userId}@${userContext.organizationId}`,
    };
    const commit = (
      await git.env(env).raw(['commit-tree', tree, '-m', 'Initial commit from ANT'])
    ).trim();
    await git.raw(['update-ref', `refs/heads/${branch}`, commit]);
    logger.info('gitAnchorInitialCommit', { component: this.component }, {
      anchorPath,
      branch,
      commit,
    });
    return commit;
  }

  /**
   * Detect the remote default branch of the anchor's `origin`.
   * 1. `git ls-remote --symref origin HEAD` (network, authoritative)
   * 2. anchor HEAD set by `git clone --bare` (local fallback)
   * 3. null
   */
  async detectRemoteHeadBranch(anchorPath: string): Promise<string | null> {
    try {
      const out = await this.git(anchorPath).raw(['ls-remote', '--symref', 'origin', 'HEAD']);
      const match = out.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD/m);
      if (match?.[1]) return match[1];
    } catch {
      // network unavailable / auth failed — fall back to local HEAD
    }
    return this.readHeadBranch(anchorPath);
  }

  private classifyFailureReason(error: unknown): GitAnchorFailureReason {
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();

    if (message.includes('permission denied') || message.includes('eacces') || message.includes('eperm')) {
      return 'permissionDenied';
    }
    if (
      message.includes('git') &&
      (message.includes('not found') || message.includes('enoent') || message.includes('spawn'))
    ) {
      return 'gitBinaryMissing';
    }
    if (message.includes('safe.directory') || message.includes('dubious ownership')) {
      return 'safeDirectory';
    }
    if (message.includes('user.email') || message.includes('user.name') || message.includes('author identity')) {
      return 'userConfig';
    }
    if (message.includes('commit')) {
      return 'gitCommitFailed';
    }
    if (message.includes('init') || message.includes('initialize')) {
      return 'gitInitFailed';
    }
    return 'unknown';
  }
}

/** Shared singleton — the class is stateless. */
export const gitAnchor = new GitAnchorSSOT();
