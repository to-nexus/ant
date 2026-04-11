/**
 * Plan Detect Strategy
 *
 * Rule-based + optional LLM mode detection for plan jobs.
 * Extracted from the former resolve node's inline detect logic.
 *
 * Flow:
 *   - explain intent → mode='explain'
 *   - gen-plan intent or no existing target → mode='generate'
 *   - existing target → LLM detectPlanMode (refactor vs explain)
 */

import type { DetectStrategy, DetectResult } from '../../../../common/nodes/detect/types.js';
import type { PlanGraphState } from '../state.js';
import type { DetectionReport, Mode } from '@ant/shared';
import { synthesizePlanIntent } from '@ant/shared';
import { extractTokenUsageFromStreamEvent, accumulateTokenUsage, upsertPhaseTokenUsage } from '../../../../common/graph/llmHelpers.js';

export const planDetectStrategy: DetectStrategy<PlanGraphState> = {
  async run(state): Promise<DetectResult<PlanGraphState>> {
    const detectedMode = await determinePlanMode(state);
    console.log(`📋 [Plan:Detect] Determined mode: ${detectedMode}`);

    const detectionReport: DetectionReport = {
      detectedMode,
      detectedModeReasoning: detectedMode === 'explain' ? 'User intent is to understand/analyze the document'
        : detectedMode === 'refactor' ? 'Existing target document detected — modification expected'
        : 'No existing target — generating new document',
      sourceJob: 'plan',
      intentId: state.actionMetadata?.intent,
      detectedAt: new Date().toISOString(),
    };

    return { detectionReport };
  },

  synthesizeFallback(report) {
    return synthesizePlanIntent(report.detectedMode);
  },
};

/**
 * Detect plan mode when existing documents are present.
 * Uses lightweight LLM call to distinguish refactor vs explain.
 */
async function determinePlanMode(state: PlanGraphState): Promise<Mode> {
  const actionMetadata = state.actionMetadata;
  if (actionMetadata?.intent === 'explain-plan') return 'explain';
  if (actionMetadata?.intent === 'gen-plan') return 'generate';

  // Check if target documents exist
  const fs = await import('fs');
  const path = await import('path');
  const { normalizeTemplateDoc } = await import('../../../../../core/utils/templateDetector.js');

  const targets = resolveTargets(state);
  const hasExistingTarget = targets.length > 0 && targets.some(t => {
    try {
      const raw = fs.readFileSync(path.join(state.featurePath, t), 'utf-8');
      return !!normalizeTemplateDoc(raw);
    } catch { return false; }
  });

  if (!hasExistingTarget) return 'generate';

  return await detectPlanModeViaLLM(state);
}

function resolveTargets(state: PlanGraphState): string[] {
  if (state.actionMetadata?.target?.length) return state.actionMetadata.target;
  const sourceFileNames = state.workspaceState?.sourceFileNames;
  if (sourceFileNames?.includes('prd.md')) return ['inputs/sources/prd.md'];
  if (sourceFileNames?.length) return sourceFileNames.map(f => `inputs/sources/${f}`);
  return [];
}

async function detectPlanModeViaLLM(state: PlanGraphState): Promise<'refactor' | 'explain'> {
  const directive = state.overrideDirective || state.directive || '';
  if (!directive) return 'refactor';

  const llm = state.deps?.llm;
  if (!llm) return 'refactor';

  const prompt = `Classify the following user directive about an existing document.

Directive: "${directive}"

Is the user asking to:
A) UNDERSTAND/ANALYZE the content (explain, describe, query, check what's in it) — no modification expected
B) MODIFY/IMPROVE the document (refactor, add, fix, update, expand, improve) — changes expected

Respond with ONLY a JSON object:
<detect>
{ "mode": "explain" | "refactor", "reasoning": "one sentence" }
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
      const mode = parsed.mode === 'explain' ? 'explain' : 'refactor';
      console.log(`   DetectPlanMode: ${mode} (${parsed.reasoning || 'no reasoning'})`);
      return mode;
    }

    const jsonMatch = response.match(/\{[\s\S]*?"mode"\s*:\s*"(explain|refactor)"[\s\S]*?\}/);
    if (jsonMatch) return jsonMatch[1] as 'explain' | 'refactor';
  } catch (err) {
    console.warn(`   ⚠️ DetectPlanMode failed, defaulting to refactor:`, err);
  }

  return 'refactor';
}
