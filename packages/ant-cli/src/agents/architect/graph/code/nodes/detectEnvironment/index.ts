/**
 * DetectEnvironment Node (Lightweight Router)
 * 
 * Responsibilities:
 * 1. Detect job mode (generate/refactor/explain)
 * 2. Determine if decompose needs RAG (requireRag)
 * 3. Generate decompose keywords (used once, then discarded)
 * 
 * NOTE: environment and profile detection moved to decompose node (SRP)
 * Design documents are passed through unfiltered to decompose.
 */

import { ArchitectGraphState } from '../../state';
import { LLMClient } from '../../../../../../core/ports';
import { logPrompt } from '../../../../../../core/utils/promptLogger';
import { LLM_TEMPERATURE, LLM_MAX_TOKENS } from '../../../../../common/graph/llmConfig';
import { 
  createCodeDetectionReport, 
  formatDetectionReportForChat,
  JobMode,
} from '../../../../../../core/types/detection';

// Import submodules
import { parseDetectResponse } from './responseParser';
import { getEstimatingLabel } from '../../../../../common/graph/timing/estimatingLabels';

export async function detectEnvironment(
  state: ArchitectGraphState
): Promise<Partial<ArchitectGraphState>> {
  const phaseStart = Date.now();
  
  // ✅ Node activity banner
  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('detect', state._uiLocale), 'detect');
  }
  
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Resume fast path: detectionReport already exists
  // Skip LLM call, pass all design docs through
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (state.detectionReport) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔍 DETECT ENVIRONMENT: Resume — using existing detectionReport (LLM skip)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log(`✅ Job Mode: ${state.detectionReport.jobMode} (from existing detectionReport)`);
    console.log(`   Require RAG: ${state.detectionReport.requireRag}`);

    // Workflow exit (if instrumented)
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.enterNode(
        state._httpJobId,
        'detectEnvironment',
        0,
        undefined,
        undefined,
        state.recursionCount,
        state.recursionLimit
      );
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'detectEnvironment', 0);
    }

    return {
      detectionReport: state.detectionReport,
      decomposeKeywords: state.decomposeKeywords || {
        errorFiles: [],
        keywords: [],
        references: new Map<string, string[]>()
      },
      // ✅ Pass all designDocs through unfiltered (decompose handles profile)
      designDocs: state.designDocs,
      design: state.design,
      profile: state.profile,
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
      _phaseTimings: { ...(state._phaseTimings || {}), detect: Date.now() - phaseStart },
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Normal path: LLM determines jobMode + requireRag + keywords
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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
      0,
      taskInfo,
      llmInfo,
      state.recursionCount,
      state.recursionLimit
    );
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔍 DETECT ENVIRONMENT: Analyzing development context');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // 1. Build Prompt (lightweight: directive + PRD only)
  const promptEngine = state.deps?.promptEngine;
  if (!promptEngine) {
    throw new Error('[DetectEnvironment] PromptEngine not available');
  }
  
  const prompt = await promptEngine.buildDetectEnvironmentPrompt(
    state.directive || '',
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
    const { extractTokenUsageFromStreamEvent } = await import('../../../../../common/graph/llmHelpers');
    const usage = extractTokenUsageFromStreamEvent(event);
    if (usage) {
      capturedUsage = usage;
    }
  }
  
  // ✅ Accumulate token usage to job-level (not task-level, as detectEnvironment runs before tasks)
  if (capturedUsage) {
    const { accumulateTokenUsage } = await import('../../../../../common/graph/llmHelpers');
    accumulateTokenUsage(state as any, capturedUsage, { taskLevel: false, jobLevel: true });
    console.log(`   Tokens: ${capturedUsage.totalTokens} total (${capturedUsage.inputTokens} in, ${capturedUsage.outputTokens} out)`);
    // ✅ Push live token update to Kanban UI during estimating phase
    if (state.deps?.kanbanUpdate?.updateTokenUsage && (state as any).tokenUsage) {
      state.deps.kanbanUpdate.updateTokenUsage((state as any).tokenUsage);
    }
  }
  
  // 3. Parse Response (jobMode + requireRag + keywords only)
  const parsed = parseDetectResponse(response);
  
  // 4. Create DetectionReport (without environment/profile — decompose fills those)
  const detectionReport = createCodeDetectionReport({
    jobMode: parsed.mode as JobMode,
    jobModeReasoning: parsed.modeReasoning,
    requireRag: parsed.requireRagForDecompose,
  });
  
  // 5. Display in Chat UI
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
  
  // 7. Log Analysis
  console.log(`✅ Job Mode: ${detectionReport.jobMode}`);
  console.log(`   Reasoning: ${detectionReport.jobModeReasoning}`);
  console.log(`   Require RAG: ${detectionReport.requireRag}`);
  
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
    state.deps.workflowUpdate.exitNode(state._httpJobId, 'detectEnvironment', 0);
  }
  
  return {
    detectionReport,
    decomposeKeywords,
    // ✅ Pass all designDocs through unfiltered (decompose determines profile + environment)
    designDocs: state.designDocs,
    design: state.design,
    profile: state.profile,
    tokenUsage: (state as any).tokenUsage,
    recursionCount: state.recursionCount,
    recursionLimit: state.recursionLimit,
    _phaseTimings: { ...(state._phaseTimings || {}), detect: Date.now() - phaseStart },
  };
}
