/**
 * Universal resolve node — strategy for the common createResolveNode factory.
 *
 * Loads the active custom-job definition (activated by job-runner before the
 * graph starts), ensures the artifact tree exists, and builds the top-level
 * artifact overview (existence band — deep listing stays on-demand via
 * list_files / search_files, large-tree safe).
 *
 * Also the SINGLE writer of `state.turnContext` — every field is
 * deterministic from runner inputs (explicit `@intent:`/`@ctx:` mentions,
 * the `@plan` flag), so no LLM pass is involved. Inferred-intent turns get
 * `['general']`, which keeps every definition injection on the TOC
 * (progressive disclosure via read_file on the definition mount).
 *
 * And the plan-consumption gate's deterministic half: lists existing plan
 * documents under `plan/{agentId}/{jobId}/` (disk = SSOT, survives
 * crash/pause) into `state.planDocs`; whether THIS turn consumes one is the
 * agent's judgment, prompted by the Plan Documents band.
 */

import { GENERAL_INTENT } from '@ant/shared';
import type { ResolveStrategy } from '../../../common/graph/nodes/resolve/types';
import type { UniversalGraphState, UniversalTurnContext } from '../state';
import { requireActiveCustomJob } from '../../../../core/customAgents/activeCustomJob';

const OVERVIEW_MAX_ENTRIES = 50;
const PLAN_DOCS_MAX = 20;

async function buildArtifactsOverview(state: UniversalGraphState): Promise<string> {
  const fileSystem = state.deps?.fileSystem;
  if (!fileSystem) return '(artifact tree unavailable)';
  try {
    await fileSystem.createDirectory('.');
    const entries = await fileSystem.readDirectory('.');
    if (entries.length === 0) return '(empty — no artifacts yet)';
    const listed = entries
      .slice(0, OVERVIEW_MAX_ENTRIES)
      .map((e: { name: string; isDirectory: boolean }) => (e.isDirectory ? `${e.name}/` : e.name))
      .join('\n');
    const more = entries.length > OVERVIEW_MAX_ENTRIES ? `\n… ${entries.length - OVERVIEW_MAX_ENTRIES} more entries` : '';
    return listed + more;
  } catch (e) {
    return `(failed to list artifact tree: ${e instanceof Error ? e.message : String(e)})`;
  }
}

/** Existing plan documents for the active (agent, job) pair — relative paths. */
async function listPlanDocs(state: UniversalGraphState, planDocsDir: string): Promise<string[]> {
  const fileSystem = state.deps?.fileSystem;
  if (!fileSystem) return [];
  try {
    const entries = await fileSystem.readDirectory(planDocsDir);
    return entries
      .filter((e: { name: string; isDirectory: boolean }) => !e.isDirectory)
      .slice(0, PLAN_DOCS_MAX)
      .map((e: { name: string }) => `${planDocsDir}/${e.name}`);
  } catch {
    return []; // dir absent = no plans yet — not an error
  }
}

function buildTurnContext(state: UniversalGraphState): UniversalTurnContext {
  const explicit = (state.explicitIntents?.length ?? 0) > 0 || (state.explicitContext?.length ?? 0) > 0;
  return {
    intents: state.explicitIntents?.length ? state.explicitIntents : [GENERAL_INTENT],
    context: state.explicitContext ?? [],
    planTurn: state.planRequested === true,
    source: explicit ? 'explicit' : 'infer',
  };
}

async function resolveCommon(state: UniversalGraphState): Promise<Partial<UniversalGraphState>> {
  const resolved = requireActiveCustomJob();
  console.log(`🧭 [Universal:Resolve] ${resolved.agentId}/${resolved.jobId} (scope: ${resolved.scope})`);

  const artifactsOverview = await buildArtifactsOverview(state);
  const planDocs = await listPlanDocs(state, `plan/${resolved.agentId}/${resolved.jobId}`);
  return { artifactsOverview, planDocs, turnContext: buildTurnContext(state) };
}

export const universalResolveStrategy: ResolveStrategy<UniversalGraphState> = {
  async loadArtifacts(state) {
    return resolveCommon(state);
  },
  async onResume(state) {
    return resolveCommon(state);
  },
};
