/**
 * Inline Ask Runner
 * 
 * Lightweight runner for handling ask queries during interrupted jobs.
 * 
 * Flow:
 * 1. Classify user intent via triage (ask vs work)
 * 2. If ask → run askGraph → stream response → return { intent: 'ask' }
 * 3. If work → return { intent: 'work' } immediately (no action taken)
 * 
 * KEY PRINCIPLE: This runner is stateless.
 * - Does NOT read/write session files
 * - Does NOT modify task queues
 * - Does NOT update kanban state
 * - Only streams chat responses via ChatAPIClient
 */

import { analyzeWorkspace, AgentRegistry, parseTriageResponse, buildTriagePrompt, hasTargetJobPrerequisites } from '../../../common/graph/nodes/triage/index.js';
import { WorkspaceState } from '../../../common/graph/nodes/triage/types.js';
import { runAskGraph } from './runner.js';
import { getChatAPIClient } from '../../../../core/adapters/ChatAPIClient.js';

export interface InlineAskParams {
  message: string;
  featurePath: string;
  currentJob: string;
  currentAgent: string;
  projectId?: string;
  deps: { llm: any; memory?: any };
  _httpJobId?: string;
  existingTaskSummary?: string;
}

export interface InlineAskResult {
  intent: 'ask' | 'work';
  action?: 'continue' | 'newJob' | 'redirect';
  suggestedJob?: string;
  suggestedAgent?: string;
  redirectReason?: string;
  response?: string;
  status: 'completed' | 'paused';
}

/**
 * Run inline ask: classify intent, handle ask if applicable.
 * 
 * Returns intent so the caller (orchestrator) can signal the frontend
 * whether to auto-continue the interrupted job or keep the choice card visible.
 */
export async function runInlineAsk(params: InlineAskParams): Promise<InlineAskResult> {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('💬 INLINE ASK (Interrupted Job Context)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log(`📝 Message: ${params.message.substring(0, 80)}${params.message.length > 80 ? '...' : ''}`);
  console.log(`🔧 Interrupted job: ${params.currentAgent}/${params.currentJob}`);

  const { message, featurePath, currentJob, currentAgent, deps } = params;
  const llm = deps.llm;

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Step 1: Analyze Workspace & Classify Intent
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('📋 [InlineAsk] Analyzing workspace...');

  await AgentRegistry.initialize();

  const workspaceState: WorkspaceState = await analyzeWorkspace(featurePath, {
    memory: deps.memory,
    projectId: params.projectId,
  });

  // Chat input always provides a directive
  workspaceState.hasDirective = true;

  const language = AgentRegistry.detectLanguage(message);
  console.log(`🌐 [InlineAsk] Detected language: ${language}`);

  const jobCapabilities = AgentRegistry.generatePromptContext();

  const { system: systemPrompt, user: userPrompt } = buildTriagePrompt({
    userInput: message,
    currentJob,
    currentAgent,
    workspaceState,
    jobCapabilities,
    existingTaskSummary: params.existingTaskSummary,
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Step 2: Call LLM for Triage Classification
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('🤖 [InlineAsk] Calling LLM for intent classification...');

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  let responseText: string;

  if (llm.invokeWithUsage) {
    const response = await llm.invokeWithUsage(messages);
    responseText = response.content;
  } else {
    responseText = await llm.invoke(messages);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Step 3: Parse Intent
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const triageResult = parseTriageResponse(responseText, currentJob, currentAgent);

  if (!triageResult) {
    console.error('❌ [InlineAsk] Failed to parse triage response, defaulting to work intent');
    return { intent: 'work', status: 'completed' };
  }

  console.log(`📊 [InlineAsk] Classified intent: ${triageResult.intent}`);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Step 4: Handle Based on Intent
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  if (triageResult.intent === 'ask') {
    if (triageResult.inScope) {
      // ✅ In-scope ask: Run full ask graph (streams response to chat)
      console.log('💬 [InlineAsk] Running ask graph for in-scope question...');

      const askResult = await runAskGraph({
        question: message,
        language,
        workspaceState: {
          ...workspaceState,
          featurePath,
        },
        currentJob,
        currentAgent,
        deps: { llm },
        _httpJobId: params._httpJobId,
      });

      console.log('✅ [InlineAsk] Ask completed. Interrupted job remains paused.');
      return {
        intent: 'ask',
        response: askResult.response,
        status: 'completed',
      };
    } else {
      // ✅ Out-of-scope ask: Send display message to chat
      console.log('💬 [InlineAsk] Out-of-scope ask, sending display message...');

      const displayMessage = triageResult.displayMessage || 'This question is outside the scope of Ant system.';

      const chatAPI = getChatAPIClient();
      await chatAPI.startMessage();
      await chatAPI.sendLLMEvent({ type: 'text', text: displayMessage });
      await chatAPI.finalizeMessage();

      return {
        intent: 'ask',
        response: displayMessage,
        status: 'completed',
      };
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Step 4.5: Prerequisite guard (mirroring main triage guard)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (triageResult.workStatus === 'redirect' && triageResult.suggestedJob) {
    if (!hasTargetJobPrerequisites(triageResult.suggestedJob, workspaceState)) {
      console.log(`🛡️ [InlineAsk] Guard: redirect to ${triageResult.suggestedJob} blocked — no prerequisites`);
      triageResult.workStatus = 'proceed';
      triageResult.suggestedJob = undefined;
      triageResult.suggestedAgent = undefined;
      triageResult.needsChoice = undefined;
      triageResult.choiceOptions = undefined;
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Step 5: Handle Work Intent — derive action + send choice card for redirect
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const workStatus = triageResult.workStatus;
  const continuationType = triageResult.continuationType;

  let action: InlineAskResult['action'] = 'continue';

  if (workStatus === 'redirect') {
    action = 'redirect';
  } else if (continuationType === 'newScope') {
    action = 'newJob';
  }

  console.log(`🔧 [InlineAsk] Work intent: action=${action}, workStatus=${workStatus}, continuationType=${continuationType || 'none'}`);

  if (action === 'redirect' && triageResult.needsChoice && triageResult.choiceOptions) {
    try {
      console.log('📤 [InlineAsk] Sending triage choice card for redirect...');
      const chatAPI = getChatAPIClient();
      await chatAPI.startMessage();
      await chatAPI.sendTriageChoice(
        triageResult.displayMessage || triageResult.redirectReason || 'A different job is more suitable.',
        params._httpJobId || 'unknown',
        triageResult.choiceOptions,
        triageResult,
        message
      );
      await chatAPI.finalizeMessage();
      console.log('✅ [InlineAsk] Triage choice card sent');
    } catch (chatError) {
      console.error('❌ [InlineAsk] Failed to send triage choice card:', chatError);
    }
  }

  return {
    intent: 'work',
    action,
    suggestedJob: triageResult.suggestedJob,
    suggestedAgent: triageResult.suggestedAgent,
    redirectReason: triageResult.redirectReason,
    status: 'completed',
  };
}
