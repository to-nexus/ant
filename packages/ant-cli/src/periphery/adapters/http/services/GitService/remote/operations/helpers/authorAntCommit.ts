import type { SimpleGit } from 'simple-git';
import { buildCommitPlan, type CommitGroup } from '../../../../../../../../core/context/commitMessage';
import type { UserContext } from '../../../../../../../../core/types/user';
import type { WorkspaceResolver } from '../../../../../../../../core/config/WorkspacePathResolver';
import { isBillingEnabled } from '../../../../../../../../core/config/billingCapability';
import { FilePromptAdapter } from '../../../../../../prompt/FilePromptAdapter';
import { loadWorkspaceConfigFromPath } from '../../../../../../config/FileConfigAdapter';
import { getInfrastructureFactory } from '../../../../../../../../infrastructure/adapters/InfrastructureFactory';

/** Cap the diff fed to the model — commit rationale needs shape, not every line. */
const MAX_DIFF_CHARS = 12000;
const RECENT_LOG_COUNT = 10;

function truncate(text: string, cap: number): string {
  return text.length <= cap ? text : `${text.slice(0, cap)}\n… (diff truncated)`;
}

/**
 * Build the ant-authored commit plan for a set of changed files. Gathers git
 * context (status / diff / recent log) from the live worktree, resolves the
 * `commit` auxiliary model from project config, and delegates to
 * `buildCommitPlan`. Never throws — `buildCommitPlan` always returns a usable
 * plan (timestamp fallback on any failure).
 */
export async function authorAntCommitPlan(
  git: SimpleGit,
  workspaceResolver: WorkspaceResolver,
  projectId: string,
  userContext: UserContext,
  allFiles: string[],
): Promise<CommitGroup[]> {
  // Intent-to-add so untracked files surface in `git diff` without staging
  // their content (per-group `git add` below stages for real).
  let diff = '';
  let statusShort = '';
  let recentLog = '';
  try {
    await git.raw(['add', '-N', '.']);
    diff = truncate(await git.diff(), MAX_DIFF_CHARS);
  } catch {
    /* diff is best-effort context */
  }
  try {
    statusShort = await git.raw(['status', '--short']);
  } catch {
    /* status is best-effort context */
  }
  try {
    recentLog = await git.raw(['log', `-n`, String(RECENT_LOG_COUNT), '--pretty=format:%s']);
  } catch {
    /* empty repo (no commits yet) → no convention to follow */
  }

  // The git-op commit runs in the shared API-server process, which has NO
  // `ANT_PROJECT_PATH` (that env var is set only for job-runner children). So
  // resolve the project path explicitly and load config via the env-free loader
  // — otherwise the merged `commit` aux-model default is never seen and the
  // model silently falls back to `AI_MODEL_NAME`/opus.
  const projectPath = workspaceResolver.getProjectPath(userContext, projectId);
  const workspaceConfig = await loadWorkspaceConfigFromPath(projectPath, projectId).catch((e) => {
    console.warn('⚠️  [AntCommit] config load failed, model resolution will use env defaults:', e);
    return undefined;
  });

  const { createLLMClient } = await import('../../../../../../llm/LLMClientFactory');
  let llm;
  try {
    llm = createLLMClient(undefined, undefined, { jobType: 'commit' }, workspaceConfig);
    console.log(`[AntCommit] commit model: ${llm.modelName}`);
  } catch {
    // No API key / provider misconfig → let buildCommitPlan fall back to the
    // deterministic timestamp message.
    return buildCommitPlan({
      status: statusShort,
      diff,
      recentLog,
      allFiles,
      allowMultiple: true,
    });
  }

  const promptPort = new FilePromptAdapter();
  const ledger = isBillingEnabled() ? getInfrastructureFactory().getCreditLedger() : undefined;

  return buildCommitPlan({
    status: statusShort,
    diff,
    recentLog,
    allFiles,
    allowMultiple: true,
    llm,
    promptPort,
    ledger,
    billing: ledger
      ? { orgId: userContext.organizationId, userId: userContext.userId, projectId }
      : undefined,
  });
}
