/**
 * DetectEnvironment Node (Refactored)
 * 
 * Responsibilities:
 * 1. Detect development environment (frontend/backend/fullstack/unknown)
 * 2. Determine if decompose needs RAG (requireRagForDecompose)
 * 3. Generate decompose keywords (used once, then discarded)
 * 
 * ✅ MODULAR ARCHITECTURE:
 * - responseParser.ts: LLM response parsing
 * - designSelector.ts: Design file selection based on environment
 */

import { ArchitectGraphState } from '../../state';
import { LLMClient } from '../../../../../../core/ports';

// Import submodules
import { parseDetectResponse } from './responseParser';
import { selectDesignFiles } from './designSelector';

export async function detectEnvironment(
  state: ArchitectGraphState
): Promise<Partial<ArchitectGraphState>> {
  
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  const llm = state.deps?.llm as LLMClient;
  
  // Workflow instrumentation
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
  
  // 1. Build Prompt
  const promptEngine = state.deps?.promptEngine;
  if (!promptEngine) {
    throw new Error('[DetectEnvironment] PromptEngine not available');
  }
  
  const prompt = await promptEngine.buildDetectEnvironmentPrompt(
    state.directive || '',
    state.designDocs,
    state.profile
  );
  
  // 2. Call LLM
  const { getChatAPIClient } = await import('../../../../../../core/adapters/ChatAPIClient');
  const chatAPI = getChatAPIClient();
  
  await chatAPI.showChatStatus('placeholder');
  
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
  
  // Transform and display
  const { SpecialTagTransformer } = await import('../../../../../../core/streaming/transformers/SpecialTagTransformer');
  const transformer = new SpecialTagTransformer('ko');
  const transformed = transformer.transform(response);
  
  if (transformed.text) {
    await chatAPI.sendLLMEvent({
      type: 'text',
      text: transformed.text
    });
  }
  
  await chatAPI.finalizeMessage();
  
  // 3. Parse Response
  const parsed = parseDetectResponse(response);
  
  // Build decomposeKeywords
  const decomposeKeywords = {
    stackTrace: parsed.decomposeKeywords.stackTrace || [],
    keywords: parsed.decomposeKeywords.keywords || [],
    references: new Map<string, string[]>()
  };
  
  if (parsed.decomposeKeywords.references) {
    for (const ref of parsed.decomposeKeywords.references) {
      decomposeKeywords.references.set(ref.project, ref.keywords || []);
    }
  }
  
  // 4. Select design files
  const selectedDesignFiles = selectDesignFiles(parsed.environment, state.designDocs);
  
  // 5. Log & Display
  console.log(`✅ Mode: ${parsed.mode}`);
  console.log(`   Mode Reasoning: ${parsed.modeReasoning}`);
  console.log(`✅ Environment: ${parsed.environment}`);
  console.log(`   Environment Reasoning: ${parsed.environmentReasoning}`);
  console.log(`✅ Profile: ${parsed.profile?.language || 'unknown'}${parsed.profile?.framework ? ` + ${parsed.profile.framework}` : ''}`);
  console.log(`   Require RAG for Decompose: ${parsed.requireRagForDecompose}`);
  
  // Display keywords in Chat UI - 항상 표시
  const stackTraceCount = decomposeKeywords.stackTrace.length;
  const semanticCount = decomposeKeywords.keywords.length;
  const totalCount = stackTraceCount + semanticCount;
  
  let summary: string;
  const filesList: string[] = [];
  
  if (totalCount === 0) {
    summary = 'No keywords generated (proceeding without RAG)';
  } else {
    // Build summary
    const parts: string[] = [];
    if (stackTraceCount > 0) {
      parts.push(`${stackTraceCount} from stack traces`);
    }
    if (semanticCount > 0) {
      parts.push(`${semanticCount} semantic keywords`);
    }
    summary = `Analyzed: ${parts.join(', ')}`;
    
    // Build file list with type tags
    decomposeKeywords.stackTrace.forEach(file => {
      filesList.push(`[stacktrace] ${file}`);
    });
    
    // Limit semantic keywords display to 15
    const displayKeywords = decomposeKeywords.keywords.slice(0, 15);
    displayKeywords.forEach(keyword => {
      filesList.push(`[semantic] ${keyword}`);
    });
    
    if (decomposeKeywords.keywords.length > 15) {
      filesList.push(`[semantic] ... and ${decomposeKeywords.keywords.length - 15} more`);
    }
    
    // Log to console
    if (stackTraceCount > 0) {
      console.log(`   📍 Stack trace: ${decomposeKeywords.stackTrace.join(', ')}`);
    }
    if (semanticCount > 0) {
      console.log(`   🔍 Keywords: ${decomposeKeywords.keywords.join(', ')}`);
    }
  }
  
  await chatAPI.showChatStatus('analyzed', {
    content: summary,
    keywordCount: totalCount,
    stackTraceCount,
    semanticCount,
    filesList
  });
  
  if (decomposeKeywords.references.size > 0) {
    console.log(`   Decompose Keywords (references):`);
    decomposeKeywords.references.forEach((keywords, project) => {
      console.log(`     - ${project}: ${keywords.join(', ')}`);
    });
  }
  
  console.log(`   Selected Design Files: ${selectedDesignFiles.join(', ')}\n`);
  
  // ✅ Filter designDocs based on selectedDesignFiles
  // Update state with filtered docs so subsequent nodes don't need to filter again
  let filteredDesignDocs: typeof state.designDocs = undefined;
  let filteredDesign = '';
  
  if (selectedDesignFiles.length > 0 && state.designDocs) {
    filteredDesignDocs = {};
    const parts: string[] = [];
    
    for (const fileName of selectedDesignFiles) {
      if (fileName === 'api-contract.md' && state.designDocs.apiContract) {
        filteredDesignDocs.apiContract = state.designDocs.apiContract;
        parts.push('# API Contract\n\n' + state.designDocs.apiContract);
      } else if (fileName === 'fe-system-design.md' && state.designDocs.feDesign) {
        filteredDesignDocs.feDesign = state.designDocs.feDesign;
        parts.push('# Frontend System Design\n\n' + state.designDocs.feDesign);
      } else if (fileName === 'be-system-design.md' && state.designDocs.beDesign) {
        filteredDesignDocs.beDesign = state.designDocs.beDesign;
        parts.push('# Backend System Design\n\n' + state.designDocs.beDesign);
      } else if (fileName === 'system-design.md' && state.designDocs.unifiedDesign) {
        filteredDesignDocs.unifiedDesign = state.designDocs.unifiedDesign;
        parts.push('# System Design\n\n' + state.designDocs.unifiedDesign);
      }
    }
    
    filteredDesign = parts.join('\n\n────────────────────────────────────────\n\n');
  }
  
  // Workflow exit
  if (state.deps?.workflowUpdate && state._httpJobId) {
    state.deps.workflowUpdate.exitNode(state._httpJobId, 'detectEnvironment');
  }
  
  return {
    mode: parsed.mode as 'generate' | 'refactor' | 'explain',
    modeReasoning: parsed.modeReasoning,
    detectedEnvironment: parsed.environment as 'frontend' | 'backend' | 'fullstack' | 'unknown',
    environmentReasoning: parsed.environmentReasoning,
    selectedDesignFiles,
    requireRagForDecompose: parsed.requireRagForDecompose,
    decomposeKeywords,
    profile: parsed.profile,  // ✅ Add profile to state (language/framework from LLM)
    designDocs: filteredDesignDocs || state.designDocs,  // ✅ Update with filtered docs
    design: filteredDesign || state.design,  // ✅ Update with filtered content
  };
}

