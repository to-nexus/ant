/**
 * Response parser for asset type + job mode classification.
 *
 * Expects: <classify>{ "assetType": "logo", "jobMode": "generate", "reasoning": "..." }</classify>
 * Fallback: { assetType: 'general', jobMode: 'generate' } on any parse failure.
 */

import { VISUAL_ASSET_TYPES } from '../types.js';
import type { VisualAssetType } from '../types.js';
import type { Mode } from '@ant/shared';

const VALID_JOB_MODES: readonly string[] = ['generate', 'explain'] as const;

export interface ClassifyResponse {
  assetType: VisualAssetType;
  intentId?: string;
  jobMode: Mode;
  reasoning: string;
}

const FALLBACK: ClassifyResponse = { assetType: 'general', jobMode: 'generate', reasoning: 'Classification failed — using defaults' };

export function parseClassifyResponse(response: string): ClassifyResponse {
  try {
    const xmlMatch = response.match(/<classify>\s*([\s\S]*?)\s*<\/classify>/);

    let jsonStr: string;
    if (xmlMatch) {
      jsonStr = xmlMatch[1];
    } else {
      const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) ||
                        response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn('⚠️ [ClassifyParser] No JSON found in response');
        return FALLBACK;
      }
      jsonStr = jsonMatch[1] || jsonMatch[0];
    }

    const parsed = JSON.parse(jsonStr);
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

    return {
      assetType,
      intentId: parsed.intentId || undefined,
      jobMode,
      reasoning: parsed.reasoning || '',
    };
  } catch (err: any) {
    console.warn(`⚠️ [ClassifyParser] Parse failed: ${err.message}`);
    return FALLBACK;
  }
}
