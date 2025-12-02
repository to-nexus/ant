/**
 * DetectEnvironment Node
 * 
 * Responsibilities:
 * 1. Detect development environment (frontend/backend/fullstack/unknown)
 * 2. Determine if decompose needs RAG (requireRagForDecompose)
 * 3. Generate decompose keywords (used once, then discarded):
 *    - decomposeKeywords.codebase: Main project keywords
 *    - decomposeKeywords.references: Reference project keywords
 * 
 * Note: Plan node generates its own keywords per task (not stored in state)
 */

import { ArchitectGraphState } from '../state';
import { LLMClient } from '../../../../../core/ports';

interface DetectEnvironmentResponse {
  mode: 'generate' | 'refactor' | 'explain';
  modeReasoning: string;
  environment: 'frontend' | 'backend' | 'fullstack' | 'unknown';
  environmentReasoning: string;
  requireRagForDecompose: boolean;
  decomposeKeywords: {
    codebase: string[];
    references: Array<{
      project: string;
      keywords: string[];
    }>;
  };
}

export async function detectEnvironment(
  state: ArchitectGraphState
): Promise<Partial<ArchitectGraphState>> {
  
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  const llm = state.deps?.llm as LLMClient;
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Workflow instrumentation
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority
    } : undefined;
    
    const llmInfo = (llm as any)?.provider && (llm as any)?.modelName ? {
      provider: (llm as any).provider,
      model: (llm as any).modelName
    } : undefined;
    
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId,
      'detectEnvironment',
      taskInfo,
      llmInfo,
      state.recursionCount,
      state.recursionLimit
    );
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔍 DETECT ENVIRONMENT: Analyzing development context');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 1. Build Prompt (using PromptEngine)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const prompt = await buildDetectPrompt(state);
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 2. Call LLM (get complete response, no streaming needed)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const { getChatAPIClient } = await import('../../../../../core/adapters/ChatAPIClient');
  const chatAPI = getChatAPIClient();
  
  await chatAPI.showChatStatus('placeholder');
  
  // ✅ Accumulate complete response
  let response = '';
  for await (const event of llm.stream([
    { role: 'user', content: prompt }
  ], {
    temperature: 0.3,
    maxTokens: 16000
  })) {
    if (event.text) {
      response += event.text;
    }
  }
  
  // ✅ Transform and display result
  const { SpecialTagTransformer } = await import('../../../../../core/streaming/transformers/SpecialTagTransformer');
  const transformer = new SpecialTagTransformer('ko');
  const transformed = transformer.transform(response);
  
  if (transformed.text) {
    await chatAPI.sendLLMEvent({
      type: 'text',
      text: transformed.text
    });
  }
  
  await chatAPI.finalizeMessage();
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 3. Parse Response
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const parsed = parseDetectResponse(response);
  
  // Build decomposeKeywords
  const decomposeKeywords = {
    codebase: parsed.decomposeKeywords.codebase || [],
    references: new Map<string, string[]>()
  };
  
  if (parsed.decomposeKeywords.references) {
    for (const ref of parsed.decomposeKeywords.references) {
      decomposeKeywords.references.set(ref.project, ref.keywords || []);
    }
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 5. Update selectedDesignFiles (based on environment)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const selectedDesignFiles = selectDesignFiles(parsed.environment, state.designDocs);
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 6. Log Results
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log(`✅ Mode: ${parsed.mode}`);
  console.log(`   Mode Reasoning: ${parsed.modeReasoning}`);
  console.log(`✅ Environment: ${parsed.environment}`);
  console.log(`   Environment Reasoning: ${parsed.environmentReasoning}`);
  console.log(`   Require RAG for Decompose: ${parsed.requireRagForDecompose}`);
  
  if (parsed.requireRagForDecompose && decomposeKeywords.codebase.length > 0) {
    console.log(`   Decompose Keywords (codebase): ${decomposeKeywords.codebase.join(', ')}`);
  }
  
  if (decomposeKeywords.references.size > 0) {
    console.log(`   Decompose Keywords (references):`);
    decomposeKeywords.references.forEach((keywords, project) => {
      console.log(`     - ${project}: ${keywords.join(', ')}`);
    });
  }
  
  console.log(`   Selected Design Files: ${selectedDesignFiles.join(', ')}\n`);
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 7. Workflow instrumentation: Exit node
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (state.deps?.workflowUpdate && state._httpJobId) {
    state.deps.workflowUpdate.exitNode(state._httpJobId, 'detectEnvironment');
  }
  
  return {
    mode: parsed.mode,
    modeReasoning: parsed.modeReasoning,
    detectedEnvironment: parsed.environment,
    environmentReasoning: parsed.environmentReasoning,
    selectedDesignFiles,
    requireRagForDecompose: parsed.requireRagForDecompose,
    decomposeKeywords,
  };
}

/**
 * Build detection prompt using PromptEngine
 */
async function buildDetectPrompt(state: ArchitectGraphState): Promise<string> {
  const promptEngine = state.deps?.promptEngine;
  if (!promptEngine) {
    throw new Error('[DetectEnvironment] PromptEngine not available');
  }
  
  const designDocs = state.designDocs 
    ? Object.keys(state.designDocs).filter(key => 
        state.designDocs![key as keyof typeof state.designDocs]
      )
    : [];
  
  return await promptEngine.buildDetectEnvironmentPrompt(
    state.directive || '',
    designDocs,
    state.profile
  );
}

/**
 * Parse LLM response
 */
function parseDetectResponse(response: string): DetectEnvironmentResponse {
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
        codebase: parsed.decomposeKeywords?.codebase || [],
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
        codebase: [],
        references: []
      }
    };
  }
}

/**
 * Select design files based on environment
 */
function selectDesignFiles(
  environment: string,
  designDocs?: {
    apiContract?: string;
    feDesign?: string;
    beDesign?: string;
    unifiedDesign?: string;
  }
): string[] {
  const selectedFiles: string[] = [];
  
  if (!designDocs) {
    return selectedFiles;
  }
  
  // Always include API contract if available
  if (designDocs.apiContract) {
    selectedFiles.push('api-contract.md');
  }
  
  // Environment-specific design docs
  if (environment === 'frontend' && designDocs.feDesign) {
    selectedFiles.push('fe-system-design.md');
  } else if (environment === 'backend' && designDocs.beDesign) {
    selectedFiles.push('be-system-design.md');
  } else if (environment === 'fullstack') {
    if (designDocs.feDesign) selectedFiles.push('fe-system-design.md');
    if (designDocs.beDesign) selectedFiles.push('be-system-design.md');
  }
  
  // Fallback to unified design if no environment-specific doc
  if (selectedFiles.length === 0 && designDocs.unifiedDesign) {
    selectedFiles.push('system-design.md');
  } else if (selectedFiles.length === 1 && designDocs.unifiedDesign) {
    // If only api-contract, add unified design
    selectedFiles.push('system-design.md');
  }
  
  return selectedFiles;
}
