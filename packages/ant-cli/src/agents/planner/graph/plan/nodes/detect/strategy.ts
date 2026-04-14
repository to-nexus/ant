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

import type { DetectStrategy, DetectResult } from '../../../../../common/nodes/detect/types.js';
import type { PlanGraphState } from '../../state.js';
import type { InferredAction } from '@ant/shared';
import { extractTokenUsageFromStreamEvent, accumulateTokenUsage, upsertPhaseTokenUsage } from '../../../../../common/graph/llmHelpers.js';

export const planDetectStrategy: DetectStrategy<PlanGraphState> = {
  async run(state): Promise<DetectResult<PlanGraphState>> {
    const { intentId, reasoning } = await determinePlanIntent(state);
    console.log(`📋 [Plan:Detect] Determined intentId: ${intentId}`);

    const targets = resolveTargets(state);

    const inferred: InferredAction = {
      intentId,
      target: targets.length > 0 ? targets : ['inputs/sources/prd.md'],
      reasoning: { intent: reasoning },
      sourceJob: 'plan',
    };

    return { inferred };
  },
};

async function determinePlanIntent(
  state: PlanGraphState,
): Promise<{ intentId: string; reasoning: string }> {
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

  if (!hasExistingTarget) {
    return { intentId: 'gen-plan', reasoning: 'No existing target — generating new document' };
  }

  return await detectPlanIntentViaLLM(state);
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
): Promise<{ intentId: string; reasoning: string }> {
  const directive = state.overrideDirective || state.directive || '';
  if (!directive) return { intentId: 'rev-plan', reasoning: 'Existing target present, no directive' };

  const llm = state.deps?.llm;
  if (!llm) return { intentId: 'rev-plan', reasoning: 'No LLM available, defaulting to refactor' };

  const prompt = `Classify the following user directive about an existing document.

Directive: "${directive}"

Select the appropriate intentId:

| intentId | When to select |
|----------|---------------|
| rev-plan | User wants to MODIFY, IMPROVE, UPDATE, FIX, EXPAND the document |
| explain-plan | User wants to UNDERSTAND, ANALYZE, QUERY, SUMMARIZE the document (no modification) |

Respond with ONLY a JSON object inside <detect> tags:
<detect>
{ "intentId": "rev-plan" or "explain-plan", "reasoning": "one sentence" }
</detect>`;

  try {
    let response = '';
    for await (const event of llm.stream(
      [{ role: 'user', content: prompt }],
      { temperature: 0, maxTokens: 150, enableThinking: false },
    )) {
      if (event.type === 'retry') { response = ''; continue; }
      if (event.text) response += event.text;
      if (event.type === 'done') {
        const capturedUsage = extractTokenUsageFromStreamEvent(event);
        if (capturedUsage) {
          accumulateTokenUsage(state, capturedUsage, { taskLevel: false, jobLevel: true });
          upsertPhaseTokenUsage(state, 'detect', capturedUsage);
        }
      }
    }

    const match = response.match(/<detect>\s*([\s\S]*?)\s*<\/detect>/);
    if (match) {
      const parsed = JSON.parse(match[1]);
      const intentId = parsed.intentId === 'explain-plan' ? 'explain-plan' : 'rev-plan';
      return { intentId, reasoning: parsed.reasoning || '' };
    }

    const jsonMatch = response.match(/\{[\s\S]*?"intentId"\s*:\s*"(explain-plan|rev-plan)"[\s\S]*?\}/);
    if (jsonMatch) return { intentId: jsonMatch[1], reasoning: '' };
  } catch (err) {
    console.warn(`   ⚠️ DetectPlanIntent failed, defaulting to rev-plan:`, err);
  }

  return { intentId: 'rev-plan', reasoning: 'LLM parse failed, defaulting to refactor' };
}
