/**
 * Response Parsing for DetectEnvironment Node
 * 
 * Parses: jobMode + requireRag + keywords
 * (environment and profile are now determined by decompose node)
 */

export interface DetectEnvironmentResponse {
  mode: string;
  modeReasoning: string;
  requireRagForDecompose: boolean;
  decomposeKeywords: {
    errorFiles: string[];
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
    
    // ✅ Support both old (mode) and new (jobMode) field names
    const mode = parsed.jobMode || parsed.mode;
    const modeReasoning = parsed.jobModeReasoning || parsed.modeReasoning;
    const requireRag = parsed.requireRag ?? parsed.requireRagForDecompose;
    
    // Validate required fields
    if (!mode || !modeReasoning || requireRag === undefined) {
      throw new Error('Missing required fields in response');
    }
    
    return {
      mode,
      modeReasoning,
      requireRagForDecompose: requireRag,
      decomposeKeywords: {
        errorFiles: parsed.decomposeKeywords?.errorFiles || parsed.decomposeKeywords?.stackTrace || [],
        keywords: parsed.decomposeKeywords?.keywords || [],
        references: parsed.decomposeKeywords?.references || []
      },
    };
    
  } catch (error) {
    console.error('❌ [DetectEnvironment] Failed to parse LLM response:', error);
    console.error('Raw response:', response.substring(0, 500));
    
    // Fallback to safe defaults
    return {
      mode: 'generate',
      modeReasoning: 'Failed to parse LLM response',
      requireRagForDecompose: true,
      decomposeKeywords: {
        errorFiles: [],
        keywords: [],
        references: []
      },
    };
  }
}
