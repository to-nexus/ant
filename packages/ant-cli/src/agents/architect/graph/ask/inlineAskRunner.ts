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

import { analyzeWorkspace, AgentRegistry, parseTriageResponse, buildTriagePrompt } from '../../../common/nodes/triage/index.js';
import { WorkspaceState } from '../../../common/nodes/triage/types.js';
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
}

export interface InlineAskResult {
  intent: 'ask' | 'work';
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

  // ✅ Work intent: Return immediately, let frontend trigger continueJob
  console.log('🔧 [InlineAsk] Work intent detected. Frontend should trigger continueJob.');
  return {
    intent: 'work',
    status: 'completed',
  };
}
