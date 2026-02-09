/**
 * Response Parsing for DetectEnvironment Node
 * 
 * ✅ Supports both old and new field names:
 * - Old: mode, modeReasoning, requireRagForDecompose
 * - New: jobMode, jobModeReasoning, requireRag
 */

export interface DetectEnvironmentResponse {
  mode: string;
  modeReasoning: string;
  environment: string;
  environmentReasoning: string;
  requireRagForDecompose: boolean;
  decomposeKeywords: {
    errorFiles: string[];
    keywords: string[];
    references: Array<{
      project: string;
      keywords: string[];
    }>;
  };
  profile?: {
    language: string;
    framework?: string;
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
    if (!mode || !modeReasoning || 
        !parsed.environment || !parsed.environmentReasoning || 
        requireRag === undefined) {
      throw new Error('Missing required fields in response');
    }
    
    return {
      mode,
      modeReasoning,
      environment: parsed.environment,
      environmentReasoning: parsed.environmentReasoning,
      requireRagForDecompose: requireRag,
      decomposeKeywords: {
        errorFiles: parsed.decomposeKeywords?.errorFiles || parsed.decomposeKeywords?.stackTrace || [],
        keywords: parsed.decomposeKeywords?.keywords || [],
        references: parsed.decomposeKeywords?.references || []
      },
      profile: parsed.profile ? {
        language: parsed.profile.language || 'typescript',
        framework: parsed.profile.framework
      } : {
        language: 'typescript',  // Default to TypeScript if not specified
        framework: undefined
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
        errorFiles: [],
        keywords: [],
        references: []
      },
      profile: {
        language: 'typescript',  // Safe default
        framework: undefined
      }
    };
  }
}
