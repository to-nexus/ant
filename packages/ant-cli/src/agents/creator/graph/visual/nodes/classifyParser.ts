/**
 * Response parser for asset type + job mode classification.
 *
 * Expects: <classify>{ "assetType": "logo", "jobMode": "generate", "reasoning": "..." }</classify>
 * Fallback: { assetType: 'general', jobMode: 'generate' } on any parse failure.
 */

import { VISUAL_ASSET_TYPES } from '../types.js';
import type { VisualAssetType } from '../types.js';
import type { Mode, ExecutionTierId } from '@ant/shared';
import { parseExecutionTierTag, coerceExecutionTier } from '../../../../../core/executionTier/index.js';
import { extractJsonFromLlmResponse } from '../../../../../core/utils/llmResponseParser.js';

const VALID_JOB_MODES: readonly string[] = ['generate', 'explain'] as const;

export interface ClassifyResponse {
  assetType: VisualAssetType;
  intentId?: string;
  jobMode: Mode;
  reasoning: string;
  /**
   * 5-tier execution strategy — LLM emits `<executionTier>N</executionTier>`
   * alongside the `<classify>` block. Missing tag degrades to Tier 0 Reflex.
   */
  executionTier: ExecutionTierId;
}

const FALLBACK: ClassifyResponse = {
  assetType: 'general',
  jobMode: 'generate',
  reasoning: 'Classification failed — using defaults',
  executionTier: 0 as ExecutionTierId,
};

export function parseClassifyResponse(response: string): ClassifyResponse {
  try {
    const parsed = extractJsonFromLlmResponse<any>(response, {
      tag: 'classify',
      sanitize: true,
    });
    if (!parsed) {
      console.warn('⚠️ [ClassifyParser] No JSON found in response');
      return FALLBACK;
    }

    const rawType = (parsed.assetType || '').toLowerCase().trim();
    const rawMode = (parsed.jobMode || '').toLowerCase().trim();

    const assetType: VisualAssetType = VISUAL_ASSET_TYPES.includes(rawType as VisualAssetType)
      ? rawType as VisualAssetType
      : 'general';

    if (assetType === 'general' && rawType) {
      console.warn(`⚠️ [ClassifyParser] Unknown asset type "${rawType}" — falling back to general`);
    }

    const jobMode: Mode = VALID_JOB_MODES.includes(rawMode)
      ? rawMode as Mode
      : 'generate';

    if (!VALID_JOB_MODES.includes(rawMode) && rawMode) {
      console.warn(`⚠️ [ClassifyParser] Unknown jobMode "${rawMode}" — falling back to generate`);
    }

    const executionTier = coerceExecutionTier(
      parseExecutionTierTag(response),
      'Visual:Detect',
    );

    return {
      assetType,
      intentId: parsed.intentId || undefined,
      jobMode,
      reasoning: parsed.reasoning || '',
      executionTier,
    };
  } catch (err: any) {
    console.warn(`⚠️ [ClassifyParser] Parse failed: ${err.message}`);
    return FALLBACK;
  }
}
