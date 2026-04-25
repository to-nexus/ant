/**
 * Plan Detect Strategy
 *
 * Rule-based + optional LLM intent detection for plan jobs.
 * Returns InferredAction with intentId ('gen-plan' | 'rev-plan' | 'explain-plan').
 * Target is always resolved to the PRD file path.
 *
 * Flow:
 *   - no existing target → intentId='gen-plan'
 *   - existing target → LLM determines 'rev-plan' vs 'explain-plan'
 */

import type { DetectStrategy, DetectResult } from '../../../../../common/graph/nodes/detect/types.js';
import type { PlanGraphState } from '../../state.js';
import type { Domain, InferredAction } from '@ant/shared';
import { runEstimatingLLMStream, upsertPhaseTokenUsage } from '../../../../../common/graph/llmHelpers.js';
import { parseExecutionTierTag, coerceExecutionTier, ExecutionTierId } from '../../../../../../core/executionTier/index.js';

export const planDetectStrategy: DetectStrategy<PlanGraphState> = {
  async run(state): Promise<DetectResult<PlanGraphState>> {
    // Phase 1 (10.2) — explicit > infer. When `actionMetadata.domain` is
    // set the LLM does NOT need to re-infer it; we suppress the `<domain>`
    // emission instruction in the prompt and short-circuit the parse.
    const explicitDomain = state.actionMetadata?.domain;
    const { intentId, reasoning, executionTier, domain: inferredDomain, domainReasoning: inferredDomainReasoning } =
      await determinePlanIntent(state, explicitDomain);

    const finalDomain = explicitDomain ?? inferredDomain;
    const finalDomainReasoning = explicitDomain
      ? `Explicit actionMetadata.domain=${explicitDomain} — LLM domain inference skipped.`
      : inferredDomainReasoning;

    console.log(`📋 [Plan:Detect] Determined intentId: ${intentId} (executionTier=${executionTier}, domain=${finalDomain ?? 'unset'}${explicitDomain ? ' [explicit]' : ''})`);

    const targets = resolveTargets(state);

    const inferred: InferredAction = {
      intentId,
      target: targets.length > 0 ? targets : ['inputs/sources/prd.md'],
      domain: finalDomain,
      reasoning: { intent: reasoning, domain: finalDomainReasoning },
      sourceJob: 'plan',
    };

    return {
      inferred,
      stateUpdates: { executionTier } as Partial<PlanGraphState>,
    };
  },
};

async function determinePlanIntent(
  state: PlanGraphState,
  explicitDomain: Domain | undefined,
): Promise<{ intentId: string; reasoning: string; executionTier: ExecutionTierId; domain?: Domain; domainReasoning?: string }> {
  const fs = await import('fs');
  const path = await import('path');
  const { normalizeTemplateDoc } = await import('../../../../../../core/utils/templateDetector.js');

  const targets = resolveTargets(state);
  const hasExistingTarget = targets.length > 0 && targets.some(t => {
    try {
      const raw = fs.readFileSync(path.join(state.featurePath, t), 'utf-8');
      return !!normalizeTemplateDoc(raw);
    } catch { return false; }
  });

  return await detectPlanIntentViaLLM(state, hasExistingTarget, explicitDomain);
}

function resolveTargets(state: PlanGraphState): string[] {
  if (state.actionMetadata?.target?.length) return state.actionMetadata.target;
  const sourceFileNames = state.workspaceState?.sourceFileNames;
  if (sourceFileNames?.includes('prd.md')) return ['inputs/sources/prd.md'];
  if (sourceFileNames?.length) return sourceFileNames.map(f => `inputs/sources/${f}`);
  return [];
}

async function detectPlanIntentViaLLM(
  state: PlanGraphState,
  hasExistingTarget: boolean,
  explicitDomain: Domain | undefined,
): Promise<{ intentId: string; reasoning: string; executionTier: ExecutionTierId; domain?: Domain; domainReasoning?: string }> {
  const directive = state.overrideDirective || state.directive || '';

  // Degenerate cases (no directive / no LLM / no promptBuilder) still need
  // deterministic intent. Default to tier 0 Reflex in these paths — the
  // LLM gets no chance to judge, so there is no "LLM SSOT" to honor.
  if (!directive) {
    const intentId = hasExistingTarget ? 'rev-plan' : 'gen-plan';
    return { intentId, reasoning: 'No directive', executionTier: ExecutionTierId.Reflex };
  }

  const llm = state.deps?.llm;
  const promptBuilder = state.deps?.promptBuilder;
  if (!llm || !promptBuilder) {
    const intentId = hasExistingTarget ? 'rev-plan' : 'gen-plan';
    return {
      intentId,
      reasoning: !llm ? 'No LLM available' : 'No PromptBuilder available',
      executionTier: ExecutionTierId.Reflex,
    };
  }

  const refs = extractRefs(state);
  // `explicitDomain` flips the prompt's `<domain>` instruction off via
  // Handlebars `{{#unless explicitDomain}}` — when the user has already
  // committed a domain, the LLM should not re-infer it.
  const vars = { directive, hasExistingTarget, refs, explicitDomain };

  let systemPrompt = '';
  let userPrompt = '';
  try {
    systemPrompt = await promptBuilder.render('jobs/plan/nodes/detect/variants/default/rules', vars);
    userPrompt = await promptBuilder.render('jobs/plan/nodes/detect/variants/default/base', vars);
  } catch (err) {
    console.warn(`   ⚠️ [Plan:Detect] Prompt render failed, using fallback:`, err);
    const intentId = hasExistingTarget ? 'rev-plan' : 'gen-plan';
    return { intentId, reasoning: 'Prompt render failed', executionTier: ExecutionTierId.Reflex };
  }

  try {
    const { response, usage } = await runEstimatingLLMStream(
      state as any,
      'detect',
      () => llm.stream(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        { temperature: 0, maxTokens: 256, enableThinking: false },
      ),
      () => {},
      { subNode: 'plan', promptChars: systemPrompt.length + userPrompt.length },
    );
    if (usage) {
      upsertPhaseTokenUsage(state, 'detect', usage);
    }

    const executionTier = coerceExecutionTier(
      parseExecutionTierTag(response),
      'Plan:Detect',
    );

    // Skip parsing `<domain>` when explicit metadata was supplied — the
    // strategy returns the explicit value directly via the caller path.
    const { domain, domainReasoning } = explicitDomain
      ? { domain: undefined, domainReasoning: undefined }
      : parseDomainTag(response);

    const match = response.match(/<detect>\s*([\s\S]*?)\s*<\/detect>/);
    if (match) {
      const parsed = JSON.parse(match[1]);
      const intentId = normalizePlanIntent(parsed.intentId, hasExistingTarget);
      return { intentId, reasoning: parsed.reasoning || '', executionTier, domain, domainReasoning };
    }

    const jsonMatch = response.match(/\{[\s\S]*?"intentId"\s*:\s*"(explain-plan|rev-plan|gen-plan)"[\s\S]*?\}/);
    if (jsonMatch) {
      const intentId = normalizePlanIntent(jsonMatch[1], hasExistingTarget);
      return { intentId, reasoning: '', executionTier, domain, domainReasoning };
    }

    // LLM produced no parseable intent — fall back based on document state.
    const intentId = hasExistingTarget ? 'rev-plan' : 'gen-plan';
    return { intentId, reasoning: 'LLM parse failed, defaulting based on target state', executionTier, domain, domainReasoning };
  } catch (err) {
    console.warn(`   ⚠️ DetectPlanIntent failed, defaulting to rev-plan:`, err);
  }

  const intentId = hasExistingTarget ? 'rev-plan' : 'gen-plan';
  return {
    intentId,
    reasoning: 'LLM call failed',
    executionTier: ExecutionTierId.Reflex,
  };
}

/**
 * Parse the `<domain>game|service</domain>` tag emitted by plan detect.
 * Phase 1: malformed / missing tag silently leaves `domain` unset; the RAC
 * fallback (`getEffectiveDomain` → `'service'`) keeps service projects as
 * the default. The signal guide in `rules.md` aims to keep this rare.
 */
function parseDomainTag(raw: string): { domain?: Domain; domainReasoning?: string } {
  const m = raw.match(/<domain>\s*([\s\S]*?)\s*<\/domain>/i);
  if (!m) return {};
  const value = m[1].trim().toLowerCase();
  if (value === 'game' || value === 'service') {
    return { domain: value, domainReasoning: 'Inferred by plan-detect LLM from directive signals.' };
  }
  return {};
}

function normalizePlanIntent(raw: string | undefined, hasExistingTarget: boolean): string {
  if (raw === 'explain-plan') return 'explain-plan';
  if (raw === 'gen-plan') return 'gen-plan';
  if (raw === 'rev-plan') return hasExistingTarget ? 'rev-plan' : 'gen-plan';
  return hasExistingTarget ? 'rev-plan' : 'gen-plan';
}

function extractRefs(state: PlanGraphState): Array<{ path: string; label: string }> {
  const artifacts = (state as any).resolvedArtifacts as
    | Array<{ path: string; role?: string; content?: string }>
    | undefined;
  if (!artifacts || !artifacts.length) return [];
  return artifacts
    .filter(a => a.role === 'ref' && typeof a.content === 'string' && a.content.trim().length > 0)
    .map(a => {
      const basename = a.path.slice(a.path.lastIndexOf('/') + 1) || a.path;
      const label = basename.replace(/\.md$/i, '');
      return { path: a.path, label };
    });
}
