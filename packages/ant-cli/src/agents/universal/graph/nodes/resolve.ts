/**
 * Universal resolve node — strategy for the common createResolveNode factory.
 *
 * Loads the active custom-job definition (activated by job-runner before the
 * graph starts), ensures the artifact tree exists, and builds the top-level
 * artifact overview (existence band — deep listing stays on-demand via
 * list_files / search_files, large-tree safe).
 *
 * Also the SINGLE writer of `state.turnContext` — every field is
 * deterministic from runner inputs plus the loaded definition (explicit
 * `@intent:`/`@ctx:` mentions, the `@plan` flag, the catalog's `default`
 * intent), so no LLM pass is involved. Unpinned turns resolve
 * explicit → catalog default intent → `['general']`; under `general` every
 * definition injection stays on the TOC, where the rendered Intent Catalog
 * (id + criterion per row — see `buildCustomJobSystemBlock`) is what makes
 * read_file self-selection an informed choice. The resolution is announced to
 * chat here (`turnContextChat`) — `unpinned` is otherwise a silent fallback
 * indistinguishable from the intent the author meant.
 *
 * And the plan-consumption gate's deterministic half: lists existing plan
 * documents under `plan/{agentId}/{jobId}/` (disk = SSOT, survives
 * crash/pause) into `state.planDocs`; whether THIS turn consumes one is the
 * agent's judgment, prompted by the Plan Documents band.
 */

import { GENERAL_INTENT } from '@ant/shared';
import type { ResolveStrategy } from '../../../common/graph/nodes/resolve/types';
import type { UniversalGraphState, UniversalTurnContext } from '../state';
import { getChatAPIClient } from '../../../../core/adapters/ChatAPIClient';
import { requireActiveCustomJob } from '../../../../core/customAgents/activeCustomJob';
import { defaultIntentOf } from '../../../../core/customAgents/intents';
import { formatTurnContextForChat } from '../../../../core/customAgents/turnContextChat';
import type { ResolvedCustomJob } from '../../../../core/customAgents/types';

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

/**
 * Unpinned turns resolve `explicit → catalog default intent → general` —
 * still a pure function; the default is an author registration-time
 * declaration, so its activation (injections AND the clarify knob) carries
 * the same authority as a pinned mention.
 */
export function buildTurnContext(
  state: Pick<UniversalGraphState, 'explicitIntents' | 'explicitContext' | 'planRequested'>,
  defaultIntentId: string | undefined,
): UniversalTurnContext {
  const explicit = (state.explicitIntents?.length ?? 0) > 0 || (state.explicitContext?.length ?? 0) > 0;
  const intents = state.explicitIntents?.length
    ? state.explicitIntents
    : [defaultIntentId ?? GENERAL_INTENT];
  return {
    intents,
    context: state.explicitContext ?? [],
    planTurn: state.planRequested === true,
    source: explicit ? 'pinned' : defaultIntentId ? 'default' : 'unpinned',
  };
}

/**
 * Announce the resolved turn context in chat. Non-blocking: a render or
 * transport failure must never fail the turn (same acceptance as every other
 * chat emission on this path).
 */
async function emitTurnContextCard(
  state: UniversalGraphState,
  resolved: ResolvedCustomJob,
  turnContext: UniversalTurnContext,
): Promise<void> {
  try {
    const active = new Set(turnContext.intents);
    const activeInjections = resolved.intents
      .filter((i) => active.has(i.id))
      .flatMap((i) => i.injections ?? []);

    const text = formatTurnContextForChat(
      {
        agentName: resolved.agentName,
        jobName: resolved.jobName,
        intents: turnContext.intents,
        source: turnContext.source,
        catalog: resolved.intents,
        activeInjections: Array.from(new Set(activeInjections)),
        context: turnContext.context,
        planTurn: turnContext.planTurn,
      },
      state.language === 'en' ? 'en' : 'ko',
    );

    const chatAPI = getChatAPIClient();
    await chatAPI.startMessage();
    await chatAPI.sendLLMEvent({ type: 'text', text });
    await chatAPI.finalizeMessage();
  } catch (e) {
    console.warn('⚠️ [Universal:Resolve] Turn-context card emit failed:', e instanceof Error ? e.message : String(e));
  }
}

async function resolveCommon(state: UniversalGraphState): Promise<Partial<UniversalGraphState>> {
  const resolved = requireActiveCustomJob();
  console.log(`🧭 [Universal:Resolve] ${resolved.agentId}/${resolved.jobId} (scope: ${resolved.scope})`);

  const artifactsOverview = await buildArtifactsOverview(state);
  const planDocs = await listPlanDocs(state, `plan/${resolved.agentId}/${resolved.jobId}`);
  const turnContext = buildTurnContext(state, defaultIntentOf(resolved.intents)?.id);
  await emitTurnContextCard(state, resolved, turnContext);
  return { artifactsOverview, planDocs, turnContext };
}

export const universalResolveStrategy: ResolveStrategy<UniversalGraphState> = {
  async loadArtifacts(state) {
    return resolveCommon(state);
  },
  async onResume(state) {
    return resolveCommon(state);
  },
};
