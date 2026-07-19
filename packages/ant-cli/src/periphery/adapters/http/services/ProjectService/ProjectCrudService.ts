import * as fs from 'fs';
import * as path from 'path';
import simpleGit from 'simple-git';
import { WorkspaceResolver, GIT_ANCHOR_DIR } from '../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../core/types/user';
import { OrgConfig, buildDefaultGitHubRepoUrl } from '../../../../../core/types/orgConfig';
import { logger } from '../../../../../utils/logger';
import { GitHelper } from '../GitService/helper/GitHelper';
import { DeletionVerificationError } from './errors';
import { DEFAULT_MODELS, MODEL_REGISTRY } from '@ant/shared';

/**
 * ProjectCrudService
 *
 * Handles project CRUD operations (Create, Read, Update, Delete)
 */
export class ProjectCrudService {
  private readonly workspaceResolver: WorkspaceResolver;

  constructor(workspaceResolver: WorkspaceResolver) {
    this.workspaceResolver = workspaceResolver;
  }
  
  /**
   * List all projects for a user
   */
  async listProjects(userContext: UserContext): Promise<string[]> {
    try {
      const workspacePath = this.workspaceResolver.getWorkspacePath(userContext);
      
      // Check if workspace exists
      try {
        await fs.promises.access(workspacePath);
      } catch {
        // Workspace doesn't exist, return empty array
        return [];
      }
      
      const projects = await fs.promises.readdir(workspacePath);
      
      // Filter out hidden files and get only directories
      const projectDirs = await Promise.all(
        projects
          .filter(p => !p.startsWith('.'))
          .map(async (p) => {
            const stat = await fs.promises.stat(path.join(workspacePath, p));
            return stat.isDirectory() ? p : null;
          })
      );
      
      return projectDirs.filter(Boolean) as string[];
    } catch (error) {
      console.error('[ProjectCrudService] Error listing projects:', error);
      return [];
    }
  }
  
  /**
   * Sanitize project name for use in file paths
   * Removes special characters except hyphens and underscores
   */
  private sanitizeProjectName(projectId: string): string {
    return projectId
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')  // replace invalid chars with hyphen
      .replace(/-+/g, '-')           // collapse multiple hyphens
      .replace(/^-+|-+$/g, '');       // trim leading/trailing hyphens
  }

  /**
   * Create a new project.
   *
   * Throws `Error('Project already exists')` when the project directory is
   * already on disk. The HTTP route maps that to a 409 with
   * `canForceCleanup: true` so the FE wizard can offer a "force overwrite"
   * confirmation flow. Force-recreate is wired in `ProjectService.createProject`
   * (it deletes first when `opts.force` is set).
   *
   * @param id - Project ID
   * @param userContext - User context for workspace path
   */
  async createProject(id: string, userContext: UserContext): Promise<void> {
    // Validate project ID (no special characters except hyphens and underscores)
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw new Error('Project ID can only contain letters, numbers, hyphens, and underscores');
    }
    
    const projectPath = this.workspaceResolver.getProjectPath(userContext, id);
    
    // Check if project already exists
    try {
      await fs.promises.access(projectPath);
      throw new Error('Project already exists');
    } catch (error: any) {
      if (error.message === 'Project already exists') {
        throw error;
      }
      // Project doesn't exist, which is what we want
    }
    
    // Create project directory structure
    await fs.promises.mkdir(projectPath, { recursive: true });
    
    // Sanitize project name for repo path
    const sanitizedName = this.sanitizeProjectName(id);
    
    // Create config with proper defaults
    const configPath = path.join(projectPath, 'config.json');
    
    // ✅ Get LLM config from environment variables
    const envModel = process.env.AI_MODEL_NAME;
    const modelOpus = envModel || DEFAULT_MODELS.opusTier;
    const modelSonnet = envModel || DEFAULT_MODELS.sonnetTier;
    
    // ✅ Read effective GitHub owner: user override > org config
    const effectiveOwner = await this.resolveEffectiveGitHubOwner(userContext);
    const defaultGithubRepo = effectiveOwner
      ? buildDefaultGitHubRepoUrl({ github: { owner: effectiveOwner } }, sanitizedName)
      : undefined;

    logger.debug('Creating project config', { component: 'ProjectCrudService', organizationId: userContext.organizationId, userId: userContext.userId, projectId: id }, {
      modelOpus,
      modelSonnet,
      defaultGithubRepo,
    });

    // repoType defaults to 'cloud' (workspace-managed codebase). 'local' is an
    // opt-in mode where the user explicitly maps the codebase to an external
    // localPath; it is reachable only when the user provides those fields
    // through the wizard's advanced config — never auto-derived from
    // userContext (auto-local previously caused the worktree path-collision
    // class of bugs). Three-axis split: repoType is independent of git
    // bootstrap (`.git`) and of remote linkage (githubRepo).
    // branchBase is intentionally omitted — it will be auto-detected at clone/init time.
    // All runtime reads already fall back to 'main' when branchBase is absent.
    const config: Record<string, any> = {
      repositoryName: sanitizedName,
      repoType: 'cloud',
      ...(defaultGithubRepo ? { githubRepo: defaultGithubRepo } : {}),
      llmModels: {
        design: {
          default: modelSonnet,
          decompose: modelSonnet,
          plan: modelOpus,
          execute: modelSonnet,
        },
        code: {
          default: modelSonnet,
          decompose: modelOpus,
          plan: modelSonnet,
          execute: modelSonnet,
        },
        learn: {
          default: modelSonnet,
        },
        plan: {
          default: modelSonnet,
          plan: modelOpus,
          execute: modelSonnet,
        },
        visual: {
          default: 'gemini-3-flash',
          direct: 'gemini-3.1-pro-preview',
          explain: 'gemini-3.1-pro-preview',
          sketch: 'gemini-3.1-flash-image',
          render: 'gemini-3-pro-image',
          engrave: 'gemini-3.1-pro-preview',
        },
        reviewer: {
          default: modelOpus,
        },
        doc: {
          default: modelOpus,
        },
      }
    };

    // branchBase is intentionally omitted — a fresh project has NO git and NO
    // codebase. The first feature creates the bare anchor and auto-sets the
    // pointer; all runtime reads fall back to 'main' while absent.
    await fs.promises.writeFile(
      configPath,
      JSON.stringify(config, null, 2),
      'utf-8'
    );
  }

  /**
   * Resolve effective GitHub owner: user override > org config
   */
  private async resolveEffectiveGitHubOwner(userContext: UserContext): Promise<string | undefined> {
    const workspacesPath = this.workspaceResolver.getPhysicalWorkspacesPath();

    // 1. Check user-level override first
    try {
      const userConfigPath = path.join(workspacesPath, userContext.organizationId, userContext.userId, '.ant', 'user-config.json');
      const userData = await fs.promises.readFile(userConfigPath, 'utf-8');
      const userConfig = JSON.parse(userData);
      if (userConfig.github?.ownerOverride) {
        return userConfig.github.ownerOverride;
      }
    } catch {
      // No user config or parse error — fall through to org config
    }

    // 2. Fallback to org config
    try {
      const orgConfigPath = path.join(workspacesPath, userContext.organizationId, '.ant', 'org-config.json');
      const orgData = await fs.promises.readFile(orgConfigPath, 'utf-8');
      const orgConfig = JSON.parse(orgData) as OrgConfig;
      return orgConfig.github?.owner;
    } catch {
      return undefined;
    }
  }

  /**
   * Rename a project (rename the project directory)
   */
  async renameProject(oldId: string, newId: string, userContext: UserContext): Promise<void> {
    if (oldId === newId) {
      return;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(newId)) {
      throw new Error('Project ID can only contain letters, numbers, hyphens, and underscores');
    }

    const oldPath = this.workspaceResolver.getProjectPath(userContext, oldId);
    const newPath = this.workspaceResolver.getProjectPath(userContext, newId);

    try {
      await fs.promises.access(oldPath);
    } catch {
      throw new Error('Project not found');
    }

    try {
      await fs.promises.access(newPath);
      throw new Error('A project with the new name already exists');
    } catch (error: any) {
      if (error.message === 'A project with the new name already exists') {
        throw error;
      }
    }

    await fs.promises.rename(oldPath, newPath);

    // EFS / NFS rename is not strictly atomic across pod boundaries — open
    // file handles can leave silly-rename `.nfsXXXX` orphans or leave
    // `oldPath` partially populated. Mirror the deleteProject verification
    // loop (200ms × 50 = 10s) before declaring success.
    let oldExists = false;
    let newExists = false;
    for (let i = 0; i < 50; i++) {
      oldExists = await fs.promises.access(oldPath).then(() => true).catch(() => false);
      newExists = await fs.promises.access(newPath).then(() => true).catch(() => false);
      if (!oldExists && newExists) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (oldExists || !newExists) {
      let leftovers: string[] = [];
      try {
        leftovers = (await fs.promises.readdir(oldPath)).slice(0, 20);
      } catch {
        // oldPath may not exist — that's fine; the throw still surfaces newPath absence
      }
      throw new Error(
        `Project rename verification failed: oldPath=${oldPath} (exists=${oldExists}) newPath=${newPath} (exists=${newExists}). ` +
          `Leftovers (top ${leftovers.length}): ${leftovers.join(', ') || '<none>'}. ` +
          `Likely partial rename due to EFS/NFS open file handles — retry after 30s.`,
      );
    }

    try {
      await this.repairGitWorktrees(newPath);
    } catch (error: any) {
      logger.warn(`Git worktree repair after rename failed (non-critical): ${error.message}`, {
        component: 'ProjectCrudService',
      });
    }

    logger.info(`Project renamed: ${oldId} → ${newId}`, {
      component: 'ProjectCrudService',
      organizationId: userContext.organizationId,
      userId: userContext.userId,
    });
  }

  /**
   * Repair git worktree absolute paths after a project directory rename.
   * Git worktrees store absolute paths bidirectionally; a directory rename
   * breaks these references. `git worktree repair` (Git 2.30+) fixes them.
   */
  private async repairGitWorktrees(projectPath: string): Promise<void> {
    const anchorPath = path.join(projectPath, GIT_ANCHOR_DIR);
    if (!GitHelper.isBareAnchorReady(anchorPath)) return;

    const featuresDir = path.join(projectPath, 'features');
    const worktreePaths: string[] = [];

    if (fs.existsSync(featuresDir)) {
      const features = await fs.promises.readdir(featuresDir);
      for (const feat of features) {
        const featureCodebase = path.join(featuresDir, feat, 'codebase');
        const featureGitFile = path.join(featureCodebase, '.git');
        if (fs.existsSync(featureGitFile)) {
          worktreePaths.push(featureCodebase);
        }
      }
    }

    if (worktreePaths.length === 0) return;

    await GitHelper.ensureSafeDirectory(anchorPath);
    const git = simpleGit(anchorPath);
    await git.raw(['worktree', 'repair', ...worktreePaths]);

    logger.info(`Repaired ${worktreePaths.length} git worktree(s) after rename`, {
      component: 'ProjectCrudService',
    });
  }

  /**
   * Delete a project (disk-level only).
   *
   * Verification loop closes the NFS/EFS eventual-consistency window: an
   * IDE pod / job-runner child / preview process holding open file handles
   * causes silly-rename `.nfsXXXX` orphans to survive the initial `fs.rm`,
   * leaving the project dir partially populated. Without verification the
   * next createProject's `fs.access` succeeds and surfaces a confusing 409.
   *
   * Caller (`ProjectService.deleteProject`) is responsible for the cascade
   * BEFORE this runs: K8s pod wait → preview pub/sub ack → child exit wait
   * → Redis state cleanup → THIS deleteProject.
   *
   * On timeout, throws a typed `DeletionVerificationError` carrying the
   * leftover paths so the caller (`ProjectService.deleteProject`) can wrap
   * it into a `ProjectDeletionError` for the route response. `force = true`
   * extends the poll window from 10s to 20s so NFS silly-rename has more
   * time to release file handles before giving up.
   */
  async deleteProject(id: string, userContext: UserContext, opts: { force?: boolean } = {}): Promise<void> {
    const projectPath = this.workspaceResolver.getProjectPath(userContext, id);

    // Check if project exists
    try {
      await fs.promises.access(projectPath);
    } catch {
      throw new Error('Project not found');
    }

    // Initial recursive remove. Errors are tolerated here — the verification
    // loop below is the source of truth for completion.
    await fs.promises.rm(projectPath, { recursive: true, force: true });

    // Verify completion. NFS silly-rename + slow file-handle release means
    // the path can briefly resurface after the rm resolves; poll for up to
    // 10s (default) or 20s (force mode — gives a stuck holder more time to
    // release before we surface a verify error).
    const POLL_INTERVAL_MS = 200;
    const MAX_POLL_ATTEMPTS = opts.force ? 100 : 50; // 200ms × N
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      const exists = await fs.promises
        .access(projectPath)
        .then(() => true)
        .catch(() => false);
      if (!exists) return;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    // Still there → collect diagnostic info so the user can identify the holder.
    let leftovers: string[] = [];
    try {
      const all = await fs.promises.readdir(projectPath);
      leftovers = all.slice(0, 20);
    } catch {
      // Path read failed — likely transient; leave leftovers empty.
    }

    throw new DeletionVerificationError(projectPath, leftovers);
  }
  
  /**
   * Get project configuration
   */
  async getProjectConfig(id: string, userContext: UserContext): Promise<any> {
    const projectPath = this.workspaceResolver.getProjectPath(userContext, id);
    const configPath = path.join(projectPath, 'config.json');
    
    // Get environment variable defaults for LLM (per-job)
    const envModel = process.env.AI_MODEL_NAME || process.env.MODEL_NAME;
    const fallbackOpus = envModel || DEFAULT_MODELS.opusTier;
    const fallbackSonnet = envModel || DEFAULT_MODELS.sonnetTier;
    
    try {
      const configData = await fs.promises.readFile(configPath, 'utf-8');
      const config = JSON.parse(configData);
      
      // ✅ Normalize + heal llmModels: fill missing defaults AND migrate ids
      // that are no longer in MODEL_REGISTRY (removed models) to the current
      // tier default. Legacy `selectable:false` ids stay untouched — they are
      // still in the registry (`isKnown` true), so they keep working and are
      // rendered as-is by the FE picker. Only truly-removed ids are healed.
      // `llmModelsChanged` gates a persist so the healed config is written back.
      const isKnownModel = (id?: string): boolean => !!id && !!MODEL_REGISTRY[id];
      let llmModelsChanged = false;

      if (!config.llmModels) {
        config.llmModels = {};
        llmModelsChanged = true;
      }

      // Text jobs → single tier default per job.
      const textJobDefaults: Record<string, string> = {
        design: fallbackSonnet,
        code: fallbackSonnet,
        learn: fallbackSonnet,
        plan: fallbackSonnet,
        reviewer: fallbackOpus,
        doc: fallbackOpus,
      };
      for (const [job, def] of Object.entries(textJobDefaults)) {
        const jobCfg = config.llmModels[job];
        if (!jobCfg) {
          config.llmModels[job] = { default: def };
          llmModelsChanged = true;
          continue;
        }
        if (!isKnownModel(jobCfg.default)) {
          jobCfg.default = def;
          llmModelsChanged = true;
        }
        // Drop any node override pointing at a removed model — it then inherits
        // the (now-known) job default. Known legacy overrides are preserved.
        for (const nodeKey of Object.keys(jobCfg)) {
          if (nodeKey === 'default') continue;
          if (jobCfg[nodeKey] && !isKnownModel(jobCfg[nodeKey])) {
            delete jobCfg[nodeKey];
            llmModelsChanged = true;
          }
        }
      }

      // Visual job → per-node gemini defaults.
      const visualDefaults: Record<string, string> = {
        default: 'gemini-3.1-pro-preview',
        direct: 'gemini-3.1-pro-preview',
        sketch: 'gemini-3.1-flash-image',
        render: 'gemini-3-pro-image',
        engrave: 'gemini-3.1-pro-preview',
      };
      if (!config.llmModels.visual) {
        config.llmModels.visual = { ...visualDefaults };
        llmModelsChanged = true;
      } else {
        const visual = config.llmModels.visual;
        for (const [node, def] of Object.entries(visualDefaults)) {
          if (!isKnownModel(visual[node])) {
            visual[node] = def;
            llmModelsChanged = true;
          }
        }
        // Drop unknown extra visual overrides outside the default node set.
        for (const nodeKey of Object.keys(visual)) {
          if (visualDefaults[nodeKey] === undefined && visual[nodeKey] && !isKnownModel(visual[nodeKey])) {
            delete visual[nodeKey];
            llmModelsChanged = true;
          }
        }
      }

      // Persist the healed config so runtime reads (which take workspaceConfig
      // as-is) and subsequent loads see the current ids — best-effort write.
      if (llmModelsChanged) {
        try {
          await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
        } catch { /* best-effort */ }
      }

      // branchBase is a pointer owned by the branchBase lifecycle SSOT
      // (auto-apply on feature create/delete, remote HEAD written once at
      // clone) — no git-sync on read.
      return config;
    } catch (error) {
      // If config doesn't exist, return minimal default config.
      // repoType defaults to 'cloud' regardless of userContext — same SSOT as
      // createProject (auto-local is forbidden; explicit user opt-in only).
      console.warn('[ProjectCrudService] Config not found, returning defaults');
      return {
        repositoryName: this.sanitizeProjectName(id),
        repoType: 'cloud',
        llmModels: {
          design: {
            default: fallbackSonnet,
          },
          code: {
            default: fallbackSonnet,
          },
          learn: {
            default: fallbackSonnet,
          },
          plan: {
            default: fallbackSonnet,
          },
          visual: {
            default: 'gemini-3.1-pro-preview',
            direct: 'gemini-3.1-pro-preview',
            sketch: 'gemini-3.1-flash-image',
            render: 'gemini-3-pro-image',
            engrave: 'gemini-3.1-pro-preview',
          },
          reviewer: {
            default: fallbackOpus,
          },
          doc: {
            default: fallbackOpus,
          },
        }
      };
    }
  }
  
  /**
   * Update project configuration
   *
   * Persists the project `config.json` (including `WorkspaceConfig.domain`)
   * to disk. Asset pool layout is owned by the canonical structure —
   * domain toggles MUST NOT trigger any disk relocation.
   */
  async updateProjectConfig(projectId: string, config: any, userContext: UserContext): Promise<void> {
    const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
    const configPath = path.join(projectPath, 'config.json');

    await fs.promises.mkdir(projectPath, { recursive: true });

    // branchBase is a BE-owned pointer: manual changes go through the
    // lifecycle SSOT (existing-feature + not-remote-locked validation, anchor
    // HEAD update); an omitted field never clobbers the stored pointer.
    const { readBranchBase, setBranchBaseManual } = await import('../GitService/anchor/branchBaseLifecycle');
    const prevBranchBase = readBranchBase(projectPath);
    const nextBranchBase = typeof config?.branchBase === 'string' ? config.branchBase : undefined;
    if (nextBranchBase && nextBranchBase !== prevBranchBase) {
      await setBranchBaseManual(
        {
          projectId,
          projectPath,
          anchorPath: this.workspaceResolver.getGitAnchorPath(userContext, projectId),
          userContext,
        },
        nextBranchBase
      );
    } else if (!nextBranchBase && config && typeof config === 'object') {
      config.branchBase = prevBranchBase;
    }

    await fs.promises.writeFile(
      configPath,
      JSON.stringify(config, null, 2),
      'utf-8'
    );
  }
}

