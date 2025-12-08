/**
 * Response Parsing for DetectEnvironment Node
 */

export interface DetectEnvironmentResponse {
  mode: string;
  modeReasoning: string;
  environment: string;
  environmentReasoning: string;
  requireRagForDecompose: boolean;
  decomposeKeywords: {
    stackTrace: string[];
    keywords: string[];
    references: Array<{
      project: string;
      keywords: string[];
    }>;
  };
}

export function parseDetectResponse(response: string): DetectEnvironmentResponse {
  try {
    // ✅ Priority 1: Extract from <detect> XML tag
    const detectMatch = response.match(/<detect>\s*([\s\S]*?)\s*<\/detect>/);
    
    let jsonStr: string;
    if (detectMatch) {
      jsonStr = detectMatch[1];
    } else {
      // Fallback: Try ```json or plain JSON
      const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) || 
                        response.match(/{[\s\S]*}/);
      
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      
      jsonStr = jsonMatch[1] || jsonMatch[0];
    }
    
    const parsed = JSON.parse(jsonStr);
    
    // Validate required fields
    if (!parsed.mode || !parsed.modeReasoning || 
        !parsed.environment || !parsed.environmentReasoning || 
        parsed.requireRagForDecompose === undefined) {
      throw new Error('Missing required fields in response');
    }
    
    return {
      mode: parsed.mode,
      modeReasoning: parsed.modeReasoning,
      environment: parsed.environment,
      environmentReasoning: parsed.environmentReasoning,
      requireRagForDecompose: parsed.requireRagForDecompose,
      decomposeKeywords: {
        stackTrace: parsed.decomposeKeywords?.stackTrace || [],
        keywords: parsed.decomposeKeywords?.keywords || [],
        references: parsed.decomposeKeywords?.references || []
      }
    };
    
  } catch (error) {
    console.error('❌ [DetectEnvironment] Failed to parse LLM response:', error);
    console.error('Raw response:', response.substring(0, 500));
    
    // Fallback to safe defaults
    return {
      mode: 'generate',
      modeReasoning: 'Failed to parse LLM response',
      environment: 'unknown',
      environmentReasoning: 'Failed to parse LLM response',
      requireRagForDecompose: false,
      decomposeKeywords: {
        stackTrace: [],
        keywords: [],
        references: []
      }
    };
  }
}
