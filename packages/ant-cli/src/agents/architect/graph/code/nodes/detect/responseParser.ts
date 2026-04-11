/**
 * Response Parsing for Code Detect Node
 * 
 * Parses: intentId + mode (lightweight — no keywords/primarySources)
 */

export interface DetectEnvironmentResponse {
  intentId?: string;
  mode: string;
  modeReasoning: string;
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
    
    const mode = parsed.jobMode || parsed.mode;
    const modeReasoning = parsed.jobModeReasoning || parsed.modeReasoning;
    
    if (!mode || !modeReasoning) {
      throw new Error('Missing required fields in response');
    }
    
    return {
      intentId: parsed.intentId || undefined,
      mode,
      modeReasoning,
    };
    
  } catch (error) {
    console.error('❌ [DetectEnvironment] Failed to parse LLM response:', error);
    console.error('Raw response:', response.substring(0, 500));
    
    return {
      mode: 'generate',
      modeReasoning: 'Failed to parse LLM response',
    };
  }
}
