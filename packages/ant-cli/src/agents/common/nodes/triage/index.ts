/**
 * Triage Node
 * 
 * Analyzes user input to determine appropriate processing path
 * - Intent classification (ask / work)
 * - Work status determination (proceed / redirect / blocked)
 * 
 * KEY PRINCIPLE: LLM makes all classification decisions.
 * This node provides data, LLM decides.
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import Handlebars from 'handlebars';
import { TriageableState, TriageResult, WorkspaceState } from './types.js';
import { analyzeWorkspace, formatWorkspaceState } from './workspaceAnalyzer.js';
import { parseTriageResponse } from './parser.js';
import { AgentRegistry } from './AgentRegistry.js';
import { accumulateTokenUsage, upsertPhaseTokenUsage } from '../../graph/llmHelpers.js';
import { runAskGraph } from '../../../architect/graph/ask/runner.js';
import { ChatAPIClient } from '../../../../core/adapters/ChatAPIClient.js';
import { WorkspacePathResolver } from '../../../../infrastructure/workspace/WorkspaceResolver.js';
import { getEstimatingLabel, type UILocale } from '../../graph/timing/estimatingLabels.js';
import { getSessionDebugDir } from '../../../../core/utils/sessionPaths.js';
import { extractLLMInfo } from '../../../../core/ports/workflow.js';
import { synthesizeAskIntent, resolveFromInfer } from '@ant/shared';
import type { ResolvedActionContext, DetectionReport } from '@ant/shared';

// Cache for loaded templates
let triageBaseTemplate: HandlebarsTemplateDelegate | null = null;
let triageRulesContent: string | null = null;

/**
 * Load triage templates from disk
 */
function loadTriageTemplates(): { base: HandlebarsTemplateDelegate; rules: string } {
  if (triageBaseTemplate && triageRulesContent) {
    return { base: triageBaseTemplate, rules: triageRulesContent };
  }
  
  const templateDir = path.join(WorkspacePathResolver.getPromptTemplatesPath(), 'triage');
  
  const basePath = path.join(templateDir, 'base.md');
  const rulesPath = path.join(templateDir, 'rules.md');
  
  const baseContent = fs.readFileSync(basePath, 'utf-8');
  triageRulesContent = fs.readFileSync(rulesPath, 'utf-8');
  triageBaseTemplate = Handlebars.compile(baseContent);
  
  return { base: triageBaseTemplate, rules: triageRulesContent };
}

/**
 * Check whether the workspace has input materials for the target job.
 * Directive is excluded — it is always present when the user types anything.
 */
export function hasTargetJobPrerequisites(targetJob: string, ws: WorkspaceState): boolean {
  switch (targetJob) {
    case 'plan':
      return true;
    case 'design':
      return ws.hasPrd || ws.hasScreens || ws.hasComponents || ws.hasAssets || ws.hasFigmaConfig;
    case 'code':
      return ws.hasDesignDoc || ws.hasCodebase;
    case 'learn':
      return ws.hasCodebase;
    case 'visual':
      return true;
    default:
      return true;
  }
}

/**
 * Triage Node
 * 
 * Entry point for analyzing user input and determining the correct path
 */
export async function triage<T extends TriageableState>(state: T): Promise<Partial<T>> {
  const phaseStart = Date.now();
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🏥 TRIAGE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // ✅ Node activity banner (only when kanbanUpdate is available — learn job has none)
  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    const locale = (state._uiLocale ?? 'en') as UILocale;
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('triage', locale), 'triage');
  }
  
  // ✅ Skip triage if explicitly requested or intent is already determined
  if (state.skipTriage || state.actionMetadata?.intent) {
    const reason = state.skipTriage ? 'skipTriage=true' : `actionMetadata.intent=${state.actionMetadata!.intent}`;
    console.log(`⏭️  Triage skipped (${reason})\n`);
    return {} as Partial<T>;
  }
  
  // ✅ Initialize AgentRegistry (loads YAML data)
  await AgentRegistry.initialize();
  
  // ✅ LLM is required
  const llm = state.deps?.llm;
  if (!llm) {
    throw new Error('LLM is required for triage');
  }
  
  // ✅ Workflow instrumentation: Enter node
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'triage', 0, undefined, extractLLMInfo(llm));
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Step 1: Analyze Workspace State
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('📋 Analyzing workspace state...');
  
  // featurePath: use state-level featurePath (simple string channel, reliable in LangGraph)
  const featurePath = state.featurePath || state.context?.featurePath || '';
  
  const workspaceState = await analyzeWorkspace(featurePath, {
    memory: state.deps?.memory,
    projectId: state.context?.project,
  });
  
  // Check if chat input provides directive
  if (state.overrideDirective) {
    workspaceState.hasDirective = true;
  }
  
  console.log(formatWorkspaceState(workspaceState));
  console.log('');
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Step 2: Build Prompt with Job Capabilities
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  const userInput = state.overrideDirective || state.directive || '';
  const currentJob = state.currentJob || 'unknown';
  const currentAgent = state.currentAgent || 'architect';
  
  // Detect language from user input (for LLM to respond in same language)
  const language = AgentRegistry.detectLanguage(userInput);
  console.log(`🌐 Detected language: ${language}`);
  
  // Get job capabilities from YAML data
  const jobCapabilities = AgentRegistry.generatePromptContext();
  
  const { system: systemPrompt, user: userPrompt } = buildTriagePrompt({
    userInput,
    currentJob,
    currentAgent,
    workspaceState,
    jobCapabilities,
  });
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Step 3: Call LLM (system = classification rules, user = data to analyze)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('🤖 Calling LLM for triage...');
  
  let responseText: string;
  
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
  
  if (llm.invokeWithUsage) {
    const response = await llm.invokeWithUsage(messages);
    responseText = response.content;
    
    if (response.usage) {
      accumulateTokenUsage(state as any, response.usage, { taskLevel: true, jobLevel: true });
      upsertPhaseTokenUsage(state as any, 'triage', response.usage);
      if (state.deps?.kanbanUpdate?.updateTokenUsage && state.tokenUsage) {
        state.deps.kanbanUpdate.updateTokenUsage(state.tokenUsage);
      }
    }
  } else {
    responseText = await llm.invoke(messages);
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Step 3.5: Log triage prompt/response for debugging
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  logTriagePromptAndResponse({
    featurePath,
    currentAgent,
    jobId: state._httpJobId || 'unknown',
    systemPromptLength: systemPrompt.length,
    userPromptLength: userPrompt.length,
    responseText,
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Step 4: Parse Response
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let triageResult = parseTriageResponse(responseText, currentJob, currentAgent, workspaceState);
  
  if (!triageResult) {
    console.error('❌ [Triage] Failed to parse LLM response:');
    console.error('   Response (first 500 chars):', responseText.substring(0, 500));
    throw new Error('Failed to parse triage response from LLM. Expected <triage> block not found.');
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Step 4.5: Programmatic guard — redirect prerequisite check
  // Redirect is only valid when the target job's input materials exist.
  // Directive is excluded (always present when user types anything).
  // Applies to ALL redirects (inbound and outbound).
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (triageResult.workStatus === 'redirect'
      && triageResult.suggestedJob) {
    const targetJob = triageResult.suggestedJob;

    if (!hasTargetJobPrerequisites(targetJob, workspaceState)) {
      console.log(`🛡️ [Triage] Guard: ${currentJob}→${targetJob} redirect blocked — no target job prerequisites in workspace`);
      triageResult.workStatus = 'proceed';
      triageResult.suggestedJob = undefined;
      triageResult.suggestedAgent = undefined;
      triageResult.needsChoice = undefined;
      triageResult.choiceOptions = undefined;
      triageResult.redirectReason = undefined;
      triageResult.displayMessage = undefined;

      const guardMessages: Record<string, string> = {
        code: '코드 작업을 시작하려면 디자인 문서가 필요합니다. 먼저 디자인 작업을 진행해주세요.',
        plan: 'PRD가 워크스페이스에 없습니다. PRD를 먼저 작성해주세요.',
      };
      triageResult._guardMessage = guardMessages[targetJob]
        || `${targetJob} 작업에 필요한 입력 자료가 워크스페이스에 없습니다.`;
    }
  }

  logTriageResult(triageResult);
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Step 5: Handle Ask Intent with Agentic Ask System
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (triageResult.intent === 'ask' && triageResult.inScope) {
    // Synthesize ask intent and create RAC
    const askIntent = synthesizeAskIntent(triageResult.askSubType);
    const askReport: DetectionReport = {
      detectedMode: 'explain',
      detectedModeReasoning: 'ask intent from triage',
      sourceJob: 'code',
    };
    const askRAC = resolveFromInfer(askReport, state.actionMetadata, undefined, undefined, askIntent);
    console.log(`📋 [Triage] Ask RAC created: intent=${askRAC.intent}, askSubType=${triageResult.askSubType || 'general'}`);

    // Run Agentic Ask Graph (explores Ant source code to answer)
    const askResult = await runAskGraph({
      question: userInput,
      language,
      workspaceState: {
        ...workspaceState,
        featurePath: state.context?.featurePath,
      },
      currentJob,
      currentAgent,
      deps: { llm },
      _httpJobId: state._httpJobId,
      resolvedAction: askRAC,
    });

    if (askResult.tokenUsage) {
      accumulateTokenUsage(state as any, askResult.tokenUsage, { taskLevel: true, jobLevel: true });
      upsertPhaseTokenUsage(state as any, 'triage', askResult.tokenUsage);
      if (state.deps?.kanbanUpdate?.updateTokenUsage && state.tokenUsage) {
        state.deps.kanbanUpdate.updateTokenUsage(state.tokenUsage);
      }
    }
    
    triageResult = {
      ...triageResult,
      askResponse: askResult.response,
      displayMessage: askResult.response,
    };
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Step 5.5: Send guard message if redirect was blocked by prerequisite check
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (triageResult._guardMessage) {
    try {
      console.log('📤 [Triage] Sending guard message to Chat UI...');
      const chatAPI = new ChatAPIClient();
      await chatAPI.startMessage();
      await chatAPI.sendLLMEvent({ type: 'text', text: triageResult._guardMessage });
      await chatAPI.finalizeMessage();
      console.log('✅ [Triage] Guard message sent');
    } catch (chatError) {
      console.error('❌ [Triage] Failed to send guard message:', chatError);
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Step 6: Send Response to Chat UI (for non-proceed, non-ask cases)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const shouldSendToChat = 
    (triageResult.intent === 'ask' && !triageResult.inScope) ||
    triageResult.workStatus === 'redirect' ||
    triageResult.workStatus === 'blocked';
  
  if (shouldSendToChat && triageResult.displayMessage) {
    try {
      console.log('📤 [Triage] Sending response to Chat UI...');
      const chatAPI = new ChatAPIClient();
      
      console.log('📤 [Triage] Starting message...');
      await chatAPI.startMessage();
      
      if (triageResult.needsChoice && triageResult.choiceOptions) {
        // Send triage_choice message with choice options
        console.log('📤 [Triage] Sending triage choice...');
        await chatAPI.sendTriageChoice(
          triageResult.displayMessage,
          state._httpJobId || 'unknown',
          triageResult.choiceOptions,
          triageResult,  // ✅ Pass full triageResult for pending choice registration
          userInput  // ✅ Pass original directive for redirect
        );
      } else {
        // Send simple text message (not streamed - these are short system messages)
        console.log('📤 [Triage] Sending text message...');
        await chatAPI.sendLLMEvent({ type: 'text', text: triageResult.displayMessage });
      }
      
      console.log('📤 [Triage] Finalizing message...');
      await chatAPI.finalizeMessage();
      console.log('✅ [Triage] Response sent to Chat UI');
    } catch (chatError) {
      console.error('❌ [Triage] Failed to send response to Chat UI:', chatError);
      // Don't re-throw - triage can still succeed without chat notification
    }
  }
  
  // ✅ Clear estimating activity when triage won't proceed to generate
  // (ask, redirect, blocked all route to __end__ — no tasks will be created)
  const willTerminate = 
    triageResult.intent === 'ask' ||
    triageResult.workStatus === 'redirect' ||
    triageResult.workStatus === 'blocked';
  
  if (willTerminate && state.deps?.kanbanUpdate?.clearEstimatingActivity) {
    state.deps.kanbanUpdate.clearEstimatingActivity();
  }
  
  // ✅ Record phase timing
  const _phaseTimings = { ...(state._phaseTimings || {}), triage: Date.now() - phaseStart };
  
  // ✅ Workflow instrumentation: Exit node
  if (state.deps?.workflowUpdate && state._httpJobId) {
    state.deps.workflowUpdate.exitNode(state._httpJobId, 'triage', 0);
  }
  
  return {
    triageResult,
    workspaceState,
    tokenUsage: state.tokenUsage,
    _phaseTimings,
  } as unknown as Partial<T>;
}

export function buildTriagePrompt(params: {
  userInput: string;
  currentJob: string;
  currentAgent: string;
  workspaceState: WorkspaceState;
  jobCapabilities: string;
  existingTaskSummary?: string;
}): { system: string; user: string } {
  const { userInput, currentJob, currentAgent, workspaceState, jobCapabilities, existingTaskSummary } = params;
  
  const { base, rules } = loadTriageTemplates();
  
  // Render base template with variables (data for LLM to analyze)
  const user = base({
    currentAgent,
    currentJob,
    userInput,
    jobCapabilities,
    // Workspace state
    hasPrd: workspaceState.hasPrd,
    prdPath: workspaceState.prdPath || 'available',
    hasDirective: workspaceState.hasDirective,
    hasScreens: workspaceState.hasScreens,
    screenCount: workspaceState.screenCount || 0,
    hasComponents: workspaceState.hasComponents,
    componentCount: workspaceState.componentCount || 0,
    hasAssets: workspaceState.hasAssets,
    assetCount: workspaceState.assetCount || 0,
    hasFigmaConfig: workspaceState.hasFigmaConfig,
    hasUiDocs: workspaceState.hasUiDocs,
    hasSystemDesignDoc: workspaceState.hasSystemDesignDoc,
    hasSpecDocs: workspaceState.hasSpecDocs,
    specDocCount: workspaceState.specDocCount || 0,
    specDocNames: workspaceState.specDocNames?.join(', ') || '',
    hasCodebase: workspaceState.hasCodebase,
    indexedFileCount: workspaceState.indexedFileCount || 'unknown',
    hasDesignDoc: workspaceState.hasDesignDoc,
    // Existing task context (for continuation assessment)
    hasExistingTasks: !!existingTaskSummary,
    existingTaskSummary,
  });
  
  return { system: rules, user };
}

/**
 * Log triage result
 */
function logTriageResult(result: TriageResult): void {
  console.log('📊 Triage Result:');
  console.log(`   Intent: ${result.intent}`);
  
  if (result.intent === 'ask') {
    console.log(`   In-scope: ${result.inScope}`);
  } else {
    console.log(`   Work Status: ${result.workStatus}`);
    if (result.workStatus === 'redirect') {
      if (result.suggestedAgent) {
        console.log(`   Suggested Agent: ${result.suggestedAgent}`);
      }
      console.log(`   Suggested Job: ${result.suggestedJob}`);
    }
    if (result.workStatus === 'blocked') {
      console.log(`   Can Proceed: ${result.canProceed}`);
      if (result.missingPrerequisites) {
        console.log(`   Missing Required: ${result.missingPrerequisites.required.join(', ') || 'none'}`);
        console.log(`   Missing Recommended: ${result.missingPrerequisites.recommended.join(', ') || 'none'}`);
      }
    }
  }
  
  console.log(`   Display: ${result.displayMessage}`);
  console.log('');
}

/**
 * Router function for conditional edges
 */
export function routeAfterTriage<T extends TriageableState>(state: T): string {
  const result = state.triageResult;
  const isResume = state.isResume === true;
  const taskQueue = (state as any).taskQueue;
  const hasTaskQueue = taskQueue && !taskQueue.isEmpty();
  
  if (!result) {
    if (isResume && hasTaskQueue) {
      console.log('[TriageRouter] No triage result (resume with tasks) → revise');
      return 'revise';
    }
    console.log('[TriageRouter] No triage result, proceeding to detectEnvironment');
    return 'detectEnvironment';
  }
  
  if (result.intent === 'ask') {
    console.log('[TriageRouter] ask intent → __end__');
    return '__end__';
  }
  
  if (result.workStatus === 'proceed') {
    if (isResume && hasTaskQueue) {
      console.log('[TriageRouter] work:proceed (resume with tasks) → revise');
      return 'revise';
    }
    console.log('[TriageRouter] work:proceed → detectEnvironment');
    return 'detectEnvironment';
  }
  
  if (result.workStatus === 'redirect') {
    console.log('[TriageRouter] work:redirect → __end__ (await choice)');
    return '__end__';
  }
  
  if (result.workStatus === 'blocked') {
    if (result.canProceed && result.needsChoice) {
      console.log('[TriageRouter] work:blocked (canProceed) → __end__ (await choice)');
      return '__end__';
    }
    console.log('[TriageRouter] work:blocked (cannot proceed) → __end__');
    return '__end__';
  }
  
  if (isResume && hasTaskQueue) {
    console.log('[TriageRouter] default (resume with tasks) → revise');
    return 'revise';
  }
  console.log('[TriageRouter] default → detectEnvironment');
  return 'detectEnvironment';
}

/**
 * Log triage prompt structure and LLM raw response to debug file.
 * Appends a triage section to the existing prompt log file.
 */
function logTriagePromptAndResponse(params: {
  featurePath: string;
  currentAgent: string;
  jobId: string;
  systemPromptLength: number;
  userPromptLength: number;
  responseText: string;
}): void {
  const { featurePath, currentAgent, jobId, systemPromptLength, userPromptLength, responseText } = params;
  if (!featurePath) return;
  
  const agent = currentAgent === 'planner' ? 'planner' : 'architect';
  const logDir = getSessionDebugDir(featurePath, agent, 'prompts');
  const logFile = path.join(logDir, `prompt-${jobId}.md`);
  
  const tokenEst = Math.ceil((systemPromptLength + userPromptLength) / 3.5);
  const content = `## Node: triage

- **Timestamp**: ${new Date().toISOString()}
- **System Prompt**: \`triage/rules.md\` (${systemPromptLength.toLocaleString()} chars)
- **User Prompt**: \`triage/base.md\` rendered (${userPromptLength.toLocaleString()} chars)
- **Total**: ${(systemPromptLength + userPromptLength).toLocaleString()} chars (~${tokenEst.toLocaleString()} tokens)

### LLM Raw Response

\`\`\`
${responseText}
\`\`\`

---

`;

  try {
    fs.mkdirSync(logDir, { recursive: true });
    
    if (fs.existsSync(logFile)) {
      const existing = fs.readFileSync(logFile, 'utf-8');
      fs.writeFileSync(logFile, content + existing);
    } else {
      const header = `# Prompt Log: Triage\n\n- **Job ID**: ${jobId}\n- **Created**: ${new Date().toISOString()}\n\n---\n\n`;
      fs.writeFileSync(logFile, header + content);
    }
    console.log(`📋 [TriageLogger] Logged triage prompt/response for ${jobId}`);
  } catch (error) {
    console.error('❌ [TriageLogger] Failed to write log:', error);
  }
}

// Re-export
export * from './types.js';
export { AgentRegistry } from './AgentRegistry.js';
export { analyzeWorkspace, formatWorkspaceState } from './workspaceAnalyzer.js';
export { parseTriageResponse } from './parser.js';
