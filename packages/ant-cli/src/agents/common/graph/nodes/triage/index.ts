/**
 * Triage Node — Phase B v2 (Intent Lookup Single Site)
 *
 * SSOT: triage performs ONE responsibility — resolve the user directive
 * to a single IntentId from the matrix. All other fields (group / mode /
 * domain) are derived by the matrix; nothing is judged
 * about progressibility (workStatus / missing prerequisites / choices) —
 * that lives in `detect` from Phase C onward.
 *
 * LLM output schema: `<intentId>X</intentId>`  (single tag).
 */

import * as fs from 'fs';
import * as path from 'path';
import { TriageableState, TriageResult, WorkspaceState } from './types.js';
import { analyzeWorkspace, formatWorkspaceState } from './workspaceAnalyzer.js';
import { parseIntentIdTag, extractIntentIdRaw } from './parser.js';
import {
  deriveTriageGroup,
  deriveTriageMode,
  deriveTriageDomain,
  validateIntentId,
} from './derive.js';
import { AgentRegistry } from './AgentRegistry.js';
import { runEstimatingLLM } from '../../llmHelpers.js';
import { getEstimatingLabel, type UILocale } from '../../timing/estimatingLabels.js';
import { getSessionDebugDir } from '../../../../../core/utils/sessionPaths.js';
import { extractLLMInfo } from '../../../../../core/ports/workflow.js';
import type { PromptPort } from '../../../../../core/ports/prompt.js';
import { hydrateFeatureContext } from '../../../../../core/context/featureContextBuilder.js';
import { recordUserTurnMeta } from '../../../../../core/executionTier/recordUserTurnMeta.js';
import {
  INTENT_DEFINITIONS,
  type IntentId,
  type JobType,
} from '@ant/shared';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Intent catalog cache
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const TRIAGE_BASE_TEMPLATE = 'jobs/shared/nodes/triage/variants/default/base';
const TRIAGE_RULES_TEMPLATE = 'jobs/shared/nodes/triage/variants/default/rules';

let intentCatalogCache: string | null = null;

/**
 * Render the 34-row intent catalog (id + group + label + description) so
 * the LLM sees every option in one place. Cached after first build —
 * INTENT_DEFINITIONS is `as const`, so the table never changes at runtime.
 */
function renderIntentCatalog(): string {
  if (intentCatalogCache) return intentCatalogCache;
  const rows = INTENT_DEFINITIONS.map((d) => {
    const label = d.label.en || '';
    const desc = d.description.en || '';
    return `| ${d.id} | ${d.intentGroup} | ${label} | ${desc} |`;
  }).join('\n');
  intentCatalogCache = [
    '| id | group | label | description |',
    '|---|---|---|---|',
    rows,
  ].join('\n');
  return intentCatalogCache;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Job-type derivation (for recordUserTurnMeta)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const KNOWN_JOB_TYPES: ReadonlyArray<JobType> = [
  'code', 'design', 'learn', 'ask', 'plan', 'inline-ask', 'visual',
];

function coerceJobType(s: string | undefined): JobType | undefined {
  if (!s) return undefined;
  return (KNOWN_JOB_TYPES as ReadonlyArray<string>).includes(s)
    ? (s as JobType)
    : undefined;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Triage node
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Triage — single-tag intent lookup. Pre-step: per-turn featureContext
 * re-hydrate (skipCompaction). Post-step: emit user_turn_meta with the
 * resolved actionMetadata so next turn's hydrate sees it.
 */
export async function triage<T extends TriageableState>(state: T): Promise<Partial<T>> {
  const phaseStart = Date.now();

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🏥 TRIAGE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    const locale = (state._uiLocale ?? 'en') as UILocale;
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('triage', locale), 'triage');
  }

  await AgentRegistry.initialize();

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Step 1: Workspace state (cheap; always run, used by domain hint + logs)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const featurePath = state.featurePath || state.context?.featurePath || '';
  const workspaceState = await analyzeWorkspace(featurePath, {
    memory: state.deps?.memory,
    projectId: state.context?.project,
  });
  if (state.overrideDirective) workspaceState.hasMetaDirectives = true;
  console.log(formatWorkspaceState(workspaceState));
  console.log('');

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Step 1.5: Per-turn featureContext re-hydrate (Phase A — skipCompaction)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const { featureContext: rehydratedContext, turnId: rehydratedTurnId } =
    await hydrateFeatureContext(
      {
        session: state.deps?.session,
        llm: state.deps?.llm,
        promptPort: state.deps?.promptBuilder,
      },
      {
        jobId: (state as any).jobId,
        logPrefix: 'Triage',
        skipCompaction: true,
      },
    );
  if (rehydratedContext) (state as any).featureContext = rehydratedContext;
  if (rehydratedTurnId) (state as any).turnId = rehydratedTurnId;

  const turnId: string | undefined = rehydratedTurnId || (state as any).turnId;
  const jobId: string | undefined = (state as any).jobId || state._httpJobId;
  const jobType = coerceJobType(state.currentJob);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Step 2: Skip path — skipTriage flag or explicit actionMetadata.intent
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (state.skipTriage || state.actionMetadata?.intent) {
    const reason = state.skipTriage
      ? 'skipTriage=true'
      : `actionMetadata.intent=${state.actionMetadata!.intent}`;
    console.log(`⏭️  Triage LLM skipped (${reason})\n`);

    if (state.skipTriage && !state.actionMetadata?.intent) {
      // skipTriage with no explicit intent — nothing to assemble. Older
      // graphs route to detect on `!triageResult`.
      return {
        workspaceState,
        ...(rehydratedContext ? { featureContext: rehydratedContext } : {}),
        ...(rehydratedTurnId ? { turnId: rehydratedTurnId } : {}),
      } as unknown as Partial<T>;
    }

    const intentId = state.actionMetadata!.intent as IntentId;
    const triageResult = buildTriageResult(intentId, state, workspaceState);
    await emitUserTurnMeta({ state, turnId, jobId, jobType, triageResult });
    logTriageResult(triageResult);

    const _phaseTimings = { ...(state._phaseTimings || {}), triage: Date.now() - phaseStart };
    return {
      triageResult,
      workspaceState,
      _phaseTimings,
      ...(rehydratedContext ? { featureContext: rehydratedContext } : {}),
      ...(rehydratedTurnId ? { turnId: rehydratedTurnId } : {}),
    } as unknown as Partial<T>;
  }

  const llm = state.deps?.llm;
  if (!llm) throw new Error('LLM is required for triage');

  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'triage', 0, undefined, extractLLMInfo(llm));
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Step 3: Build prompt and call LLM (single-tag output expected)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const userInput = state.overrideDirective || state.directive || '';
  const currentJob = state.currentJob || 'unknown';
  const currentAgent = state.currentAgent || 'architect';

  const promptPort = state.deps?.promptBuilder;
  if (!promptPort) throw new Error('promptBuilder is required for triage');
  const { system: systemPrompt, user: userPrompt } = await buildTriagePrompt({
    userInput,
    currentJob,
    currentAgent,
    workspaceState,
    featureContext: rehydratedContext,
    promptPort,
  });

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const intentId = await invokeAndParseWithRetry(state, llm, messages, {
    systemLen: systemPrompt.length,
    userLen: userPrompt.length,
    featurePath,
    currentAgent,
    jobId: state._httpJobId || 'unknown',
  });

  const triageResult = buildTriageResult(intentId, state, workspaceState);
  await emitUserTurnMeta({ state, turnId, jobId, jobType, triageResult });

  logTriageResult(triageResult);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Step 4: Clear estimating banner when the turn will terminate
  // (ask/work routing is the host graph's responsibility; we just
  // signal whether tasks are about to spawn.)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const willTerminate = triageResult.group === 'ask';
  if (willTerminate && state.deps?.kanbanUpdate?.clearEstimatingActivity) {
    state.deps.kanbanUpdate.clearEstimatingActivity();
  }

  const _phaseTimings = { ...(state._phaseTimings || {}), triage: Date.now() - phaseStart };

  if (state.deps?.workflowUpdate && state._httpJobId) {
    state.deps.workflowUpdate.exitNode(state._httpJobId, 'triage', 0);
  }

  return {
    triageResult,
    workspaceState,
    tokenUsage: state.tokenUsage,
    _phaseTimings,
    ...(rehydratedContext ? { featureContext: rehydratedContext } : {}),
    ...(rehydratedTurnId ? { turnId: rehydratedTurnId } : {}),
  } as unknown as Partial<T>;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function buildTriageResult(
  intentId: IntentId,
  state: TriageableState,
  workspaceState: WorkspaceState,
): TriageResult {
  validateIntentId(intentId);
  const group = deriveTriageGroup(intentId);
  const mode = deriveTriageMode(intentId);
  const domain = deriveTriageDomain(intentId, workspaceState, state.actionMetadata);
  return {
    resolvedIntentId: intentId,
    group,
    mode,
    domain,
  };
}

async function emitUserTurnMeta(args: {
  state: TriageableState;
  turnId: string | undefined;
  jobId: string | undefined;
  jobType: JobType | undefined;
  triageResult: TriageResult;
}): Promise<void> {
  const { state, turnId, jobId, jobType, triageResult } = args;
  if (!jobType) {
    console.warn(`⚠️  [Triage] recordUserTurnMeta skipped: unknown jobType (currentJob=${state.currentJob})`);
    return;
  }
  await recordUserTurnMeta({
    session: state.deps?.session,
    turnId,
    jobId,
    jobType,
    actionMetadata: {
      intent: triageResult.resolvedIntentId,
      mode: triageResult.mode,
      domain: triageResult.domain,
    },
    nodeLabel: 'Triage',
  });
}

async function invokeAndParseWithRetry(
  state: TriageableState,
  llm: any,
  messages: Array<{ role: string; content: string }>,
  meta: {
    systemLen: number;
    userLen: number;
    featurePath: string;
    currentAgent: string;
    jobId: string;
  },
): Promise<IntentId> {
  const attempt = async (): Promise<{ raw: string; intent: IntentId | null }> => {
    let raw: string;
    if (llm.invokeWithUsage) {
      const { content } = await runEstimatingLLM(
        state as any,
        'triage',
        () => llm.invokeWithUsage(messages),
        { promptChars: meta.systemLen + meta.userLen },
      );
      raw = content;
    } else {
      raw = await llm.invoke(messages);
    }
    logTriagePromptAndResponse({
      featurePath: meta.featurePath,
      currentAgent: meta.currentAgent,
      jobId: meta.jobId,
      systemPromptLength: meta.systemLen,
      userPromptLength: meta.userLen,
      responseText: raw,
    });
    const intent = parseIntentIdTag(raw);
    return { raw, intent };
  };

  const first = await attempt();
  if (first.intent) return first.intent;
  console.warn(
    `[Triage] Single-tag parse failed — retrying once. Raw="${extractIntentIdRaw(first.raw) ?? '<missing>'}"`,
  );
  const retry = await attempt();
  if (retry.intent) return retry.intent;
  throw new Error(
    'Triage LLM did not emit a valid <intentId> tag after retry. ' +
      'See prompt log for the raw response.',
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Prompt builder
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function buildTriagePrompt(params: {
  userInput: string;
  currentJob: string;
  currentAgent: string;
  workspaceState: WorkspaceState;
  featureContext?: unknown;
  promptPort: PromptPort;
}): Promise<{ system: string; user: string }> {
  const { userInput, currentJob, currentAgent, workspaceState, featureContext, promptPort } = params;

  const vars = {
    currentAgent,
    currentJob,
    userInput,
    intentCatalog: renderIntentCatalog(),
    featureContext: featureContext ?? undefined,
    hasPlan: workspaceState.hasPlan,
    planPath: workspaceState.planPath || 'available',
    hasMetaDirectives: workspaceState.hasMetaDirectives,
    hasAssets: workspaceState.hasAssets,
    assetCount: workspaceState.assetCount || 0,
    hasFigmaConfig: workspaceState.hasFigmaConfig,
    hasVisualUi: workspaceState.hasVisualUi,
    hasVisualGameArt: workspaceState.hasVisualGameArt,
    hasArchitectureSystem: workspaceState.hasArchitectureSystem,
    hasArchitectureSpec: workspaceState.hasArchitectureSpec,
    hasCodebase: workspaceState.hasCodebase,
    indexedFileCount: workspaceState.indexedFileCount || 'unknown',
    hasDesignDoc: workspaceState.hasDesignDoc,
  };

  const [user, system] = await Promise.all([
    promptPort.render(TRIAGE_BASE_TEMPLATE, vars),
    promptPort.render(TRIAGE_RULES_TEMPLATE, {}),
  ]);
  return { system, user };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Logging
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function logTriageResult(result: TriageResult): void {
  console.log('📊 Triage Result:');
  console.log(`   Intent: ${result.resolvedIntentId}`);
  console.log(`   Group:  ${result.group}`);
  console.log(`   Mode:   ${result.mode}`);
  console.log(`   Domain: ${result.domain}`);
  console.log('');
}

/**
 * Route after triage — Phase B v2 (group based, ask externalised).
 *
 *   - missing result (LLM failure or no-intent skip path) → fall through
 *     to detect when there is no resume queue; revise on resume.
 *   - group === 'ask' → __end__ (ask graph dispatches separately at the
 *     host-graph level when Phase D wires routeToAskGraph; for now we
 *     end the triage subgraph and let the outer runner decide).
 *   - group === 'work' → detect (or revise on resume).
 */
export function routeAfterTriage<T extends TriageableState>(state: T): string {
  const result = state.triageResult;
  const isResume = state.isResume === true;
  const taskQueue = (state as any).taskQueue;
  const hasTaskQueue = taskQueue && !taskQueue.isEmpty();

  if (!result) {
    if (isResume && hasTaskQueue) {
      console.log('[TriageRouter] no result + resume queue → revise');
      return 'revise';
    }
    // Intentional skip path: skipTriage flag or explicit actionMetadata.intent.
    // The triage node returned early without populating triageResult, but
    // detect can still run from actionMetadata directly.
    if (state.skipTriage || state.actionMetadata?.intent) {
      console.log('[TriageRouter] no result (skip/explicit) → detect');
      return 'detect';
    }
    // LLM failure or unhandled state — terminate so the graph doesn't
    // wander into detect with no intent to act on.
    console.log('[TriageRouter] no result (unexpected) → __end__');
    return '__end__';
  }

  if (result.group === 'ask') {
    console.log('[TriageRouter] group=ask → __end__ (ask externalised)');
    return '__end__';
  }

  // group === 'work'
  if (isResume && hasTaskQueue) {
    console.log('[TriageRouter] group=work + resume queue → revise');
    return 'revise';
  }
  console.log('[TriageRouter] group=work → detect');
  return 'detect';
}

function logTriagePromptAndResponse(params: {
  featurePath: string;
  currentAgent: string;
  jobId: string;
  systemPromptLength: number;
  userPromptLength: number;
  responseText: string;
}): void {
  const { featurePath, currentAgent, jobId, systemPromptLength, userPromptLength, responseText } = params;
  if (!featurePath) return;

  const agent = currentAgent === 'planner' ? 'planner' : 'architect';
  const logDir = getSessionDebugDir(featurePath, agent, 'prompts');
  const logFile = path.join(logDir, `prompt-${jobId}.md`);

  const tokenEst = Math.ceil((systemPromptLength + userPromptLength) / 3.5);
  const content = `## Node: triage

- **Timestamp**: ${new Date().toISOString()}
- **System Prompt**: \`jobs/shared/nodes/triage/variants/default/rules.md\` (${systemPromptLength.toLocaleString()} chars)
- **User Prompt**: \`jobs/shared/nodes/triage/variants/default/base.md\` rendered (${userPromptLength.toLocaleString()} chars)
- **Total**: ${(systemPromptLength + userPromptLength).toLocaleString()} chars (~${tokenEst.toLocaleString()} tokens)

### LLM Raw Response

\`\`\`
${responseText}
\`\`\`

---

`;

  try {
    fs.mkdirSync(logDir, { recursive: true });
    if (fs.existsSync(logFile)) {
      const existing = fs.readFileSync(logFile, 'utf-8');
      fs.writeFileSync(logFile, content + existing);
    } else {
      const header = `# Prompt Log: Triage\n\n- **Job ID**: ${jobId}\n- **Created**: ${new Date().toISOString()}\n\n---\n\n`;
      fs.writeFileSync(logFile, header + content);
    }
    console.log(`📋 [TriageLogger] Logged triage prompt/response for ${jobId}`);
  } catch (error) {
    console.error('❌ [TriageLogger] Failed to write log:', error);
  }
}

// Re-export
export * from './types.js';
export { AgentRegistry } from './AgentRegistry.js';
export { analyzeWorkspace, formatWorkspaceState } from './workspaceAnalyzer.js';
export { parseIntentIdTag } from './parser.js';
export {
  deriveTriageGroup,
  deriveTriageMode,
  deriveTriageDomain,
  validateIntentId,
} from './derive.js';
