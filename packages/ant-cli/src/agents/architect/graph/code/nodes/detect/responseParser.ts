/**
 * Response Parsing for Code Detect Node
 *
 * Parses: intentId + reasoning from <detect> tag (no mode/profile)
 */

import { isValidIntentId } from '@ant/shared';

export interface DetectEnvironmentResponse {
  intentId?: string;
  reasoning?: string;
}

export function parseDetectResponse(response: string): DetectEnvironmentResponse {
  try {
    const detectMatch = response.match(/<detect>\s*([\s\S]*?)\s*<\/detect>/);

    let jsonStr: string;
    if (detectMatch) {
      jsonStr = detectMatch[1];
    } else {
      const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) ||
                        response.match(/{[\s\S]*}/);

      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      jsonStr = jsonMatch[1] || jsonMatch[0];
    }

    const parsed = JSON.parse(jsonStr);

    const intentId = parsed.intentId;
    if (!intentId || !isValidIntentId(intentId)) {
      console.error(`❌ [DetectEnvironment] Invalid or missing intentId: "${intentId}"`);
      return {};
    }

    return {
      intentId,
      reasoning: parsed.reasoning || parsed.jobModeReasoning || parsed.modeReasoning,
    };
  } catch (error) {
    console.error('❌ [DetectEnvironment] Failed to parse LLM response:', error);
    console.error('Raw response:', response.substring(0, 500));
    return {};
  }
}
