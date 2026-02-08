/**
 * DetectEnvironment Node (Refactored with DetectionReport)
 * 
 * Responsibilities:
 * 1. Detect job mode (generate/refactor/explain)
 * 2. Detect development environment (frontend/backend/fullstack/unknown)
 * 3. Determine if decompose needs RAG (requireRag)
 * 4. Generate decompose keywords (used once, then discarded)
 * 
 * ✅ Uses unified DetectionReport for all detection results
 */

import { ArchitectGraphState } from '../../state';
import { LLMClient } from '../../../../../../core/ports';
import { logPrompt } from '../../../../../../core/utils/promptLogger';
import { LLM_TEMPERATURE, LLM_MAX_TOKENS } from '../../../common/llmConfig';
import { 
  createCodeDetectionReport, 
  formatDetectionReportForChat,
  JobMode,
  JobEnvironment 
} from '../../../../../../core/types/detection';

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
    state.profile,
    state.prd
  );
  
  // ✅ Log prompt structure (not content)
  const jobId = state._httpJobId || 'unknown';
  if (state.context.featurePath) {
    try {
      await logPrompt(
        state.context.featurePath,
        jobId,
        'code',
        'detectEnvironment',
        prompt.length,
        {
          templatePath: 'code/phases/detect/base',
          usedTemplates: ['code/phases/detect/rules'],
          injectedVariables: {
            directive: state.directive ? `[${state.directive.length} chars]` : undefined,
            designDocs: state.designDocs ? 'SET' : undefined,
            profile: state.profile ? 'SET' : undefined,
            prd: state.prd ? `[${state.prd.length} chars]` : undefined,
          },
        }
      );
    } catch (logError) {
      console.warn(`⚠️  [DetectEnv] Failed to log prompt:`, logError);
    }
  }
  
  // 2. Call LLM
  const { getChatAPIClient } = await import('../../../../../../core/adapters/ChatAPIClient');
  const chatAPI = getChatAPIClient();
  
  await chatAPI.showChatStatus('placeholder');
  
  let response = '';
  let capturedUsage: any = undefined;
  
  for await (const event of llm.stream([
    { role: 'user', content: prompt }
  ], {
    temperature: LLM_TEMPERATURE.DETECT,
    maxTokens: LLM_MAX_TOKENS.DETECT
  })) {
    if (event.text) {
      response += event.text;
    }
    
    // ✅ Extract token usage from done event
    const { extractTokenUsageFromStreamEvent } = await import('../../../common/llmHelpers');
    const usage = extractTokenUsageFromStreamEvent(event);
    if (usage) {
      capturedUsage = usage;
    }
  }
  
  // ✅ Accumulate token usage to job-level (not task-level, as detectEnvironment runs before tasks)
  if (capturedUsage) {
    const { accumulateTokenUsage } = await import('../../../common/llmHelpers');
    accumulateTokenUsage(state as any, capturedUsage, { taskLevel: false, jobLevel: true });
    console.log(`   Tokens: ${capturedUsage.totalTokens} total (${capturedUsage.inputTokens} in, ${capturedUsage.outputTokens} out)`);
  }
  
  // 3. Parse Response
  const parsed = parseDetectResponse(response);
  
  // 4. Create DetectionReport
  const detectionReport = createCodeDetectionReport({
    jobMode: parsed.mode as JobMode,
    jobModeReasoning: parsed.modeReasoning,
    environment: parsed.environment as JobEnvironment,
    environmentReasoning: parsed.environmentReasoning,
    profile: parsed.profile ? {
      language: parsed.profile.language,
      framework: parsed.profile.framework,
    } : undefined,
    requireRag: parsed.requireRagForDecompose,
  });
  
  // 5. Display in Chat UI using formatDetectionReportForChat
  const formattedReport = formatDetectionReportForChat(detectionReport, 'ko');
  await chatAPI.sendLLMEvent({
    type: 'text',
    text: formattedReport
  });
  await chatAPI.finalizeMessage();
  
  // 6. Build decomposeKeywords
  const decomposeKeywords = {
    errorFiles: parsed.decomposeKeywords.errorFiles || [],
    keywords: parsed.decomposeKeywords.keywords || [],
    references: new Map<string, string[]>()
  };
  
  if (parsed.decomposeKeywords.references) {
    for (const ref of parsed.decomposeKeywords.references) {
      decomposeKeywords.references.set(ref.project, ref.keywords || []);
    }
  }
  
  // 7. Select design files
  const selectedDesignFiles = selectDesignFiles(parsed.environment, state.designDocs);
  
  // 8. Log Environment Analysis
  console.log(`✅ Job Mode: ${detectionReport.jobMode}`);
  console.log(`   Reasoning: ${detectionReport.jobModeReasoning}`);
  console.log(`✅ Environment: ${detectionReport.environment}`);
  console.log(`   Reasoning: ${detectionReport.environmentReasoning}`);
  console.log(`✅ Profile: ${detectionReport.profile?.language || 'unknown'}${detectionReport.profile?.framework ? ` + ${detectionReport.profile.framework}` : ''}`);
  console.log(`   Require RAG: ${detectionReport.requireRag}`);
  
  // ✅ CRITICAL: Log selected design files (for debugging fullstack)
  if (selectedDesignFiles.length > 0) {
    console.log(`📄 Selected Design Documents (${selectedDesignFiles.length}):`);
    selectedDesignFiles.forEach(file => console.log(`   - ${file}`));
  } else {
    console.log(`⚠️  No design documents selected`);
  }
  
  // ✅ Display keywords in Chat UI (analyzed status - keywords only)
  const errorFileCount = decomposeKeywords.errorFiles.length;
  const semanticCount = decomposeKeywords.keywords.length;
  const totalCount = errorFileCount + semanticCount;
  
  let summary: string;
  const filesList: string[] = [];
  
  if (totalCount === 0) {
    summary = 'No keywords generated (proceeding without RAG)';
  } else {
    // Build summary
    const parts: string[] = [];
    if (errorFileCount > 0) {
      parts.push(`${errorFileCount} from errors`);
    }
    if (semanticCount > 0) {
      parts.push(`${semanticCount} semantic keywords`);
    }
    summary = `Analyzed: ${parts.join(', ')}`;
    
    // Build file list with type tags
    decomposeKeywords.errorFiles.forEach(file => {
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
    if (errorFileCount > 0) {
      console.log(`   📍 Stack trace: ${decomposeKeywords.errorFiles.join(', ')}`);
    }
    if (semanticCount > 0) {
      console.log(`   🔍 Keywords: ${decomposeKeywords.keywords.join(', ')}`);
    }
  }
  
  // ✅ Send analyzing status first
  const analyzingIndex = await chatAPI.showChatStatus('analyzing', {
    keywordCount: 0,
    filesList: []
  });
  
  await chatAPI.showChatStatus('analyzed', {
    content: summary,
    keywordCount: totalCount,
    errorFileCount,
    semanticCount,
    filesList,
    _mergeIndex: analyzingIndex
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
  // Supports both legacy single docs and multi-package (monorepo/MSA) patterns
  let filteredDesignDocs: typeof state.designDocs = undefined;
  let filteredDesign = '';
  
  if (selectedDesignFiles.length > 0 && state.designDocs) {
    filteredDesignDocs = {};
    const parts: string[] = [];
    
    // Patterns for multi-package files
    const feMultiPattern = /^fe-system-design-(.+)\.md$/;
    const beMultiPattern = /^be-system-design-(.+)\.md$/;
    
    for (const fileName of selectedDesignFiles) {
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Legacy single docs
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Multi-package frontend: fe-system-design-{pkg}.md
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      else {
        const feMatch = fileName.match(feMultiPattern);
        if (feMatch && state.designDocs.feDesigns) {
          const pkgName = feMatch[1];
          if (state.designDocs.feDesigns[pkgName]) {
            if (!filteredDesignDocs.feDesigns) filteredDesignDocs.feDesigns = {};
            filteredDesignDocs.feDesigns[pkgName] = state.designDocs.feDesigns[pkgName];
            parts.push(`# Frontend: ${pkgName}\n\n` + state.designDocs.feDesigns[pkgName]);
          }
        }
        
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // Multi-package backend (MSA): be-system-design-{svc}.md
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        const beMatch = fileName.match(beMultiPattern);
        if (beMatch && state.designDocs.beDesigns) {
          const svcName = beMatch[1];
          if (state.designDocs.beDesigns[svcName]) {
            if (!filteredDesignDocs.beDesigns) filteredDesignDocs.beDesigns = {};
            filteredDesignDocs.beDesigns[svcName] = state.designDocs.beDesigns[svcName];
            parts.push(`# Backend: ${svcName} Service\n\n` + state.designDocs.beDesigns[svcName]);
          }
        }
      }
    }
    
    filteredDesign = parts.join('\n\n────────────────────────────────────────\n\n');
    
    // ✅ Log combined design size (for debugging)
    const tokenEstimate = Math.ceil(filteredDesign.length / 4);
    console.log(`   📊 Combined Design Context: ${tokenEstimate.toLocaleString()} tokens (${selectedDesignFiles.length} documents)\n`);
  }
  
  // Save detectionReport to session (enables decompose-direct routing on resume)
  if (state.deps?.session && state.context.featureFolder) {
    try {
      const session = await state.deps.session.load(
        state.context.project,
        state.context.featureFolder,
        'code'
      );
      await state.deps.session.updateArtifacts(
        state.context.project,
        state.context.featureFolder,
        'code',
        {
          state: {
            ...session.state,
            detectionReport,
          }
        }
      );
    } catch (err) {
      // Non-critical
    }
  }
  
  // Workflow exit
  if (state.deps?.workflowUpdate && state._httpJobId) {
    state.deps.workflowUpdate.exitNode(state._httpJobId, 'detectEnvironment');
  }
  
  return {
    detectionReport,
    selectedDesignFiles,
    decomposeKeywords,
    profile: detectionReport.profile ? {
      language: detectionReport.profile.language,
      framework: detectionReport.profile.framework,
    } : state.profile,
    designDocs: filteredDesignDocs || state.designDocs,
    design: filteredDesign || state.design,
    tokenUsage: (state as any).tokenUsage,
    recursionCount: state.recursionCount,   // ✅ FIX: Propagate to LangGraph channel (Partial return requires explicit inclusion)
    recursionLimit: state.recursionLimit,   // ✅ FIX: Propagate to LangGraph channel
  };
}
