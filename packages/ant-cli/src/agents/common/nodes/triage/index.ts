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
import * as path from 'path';
import Handlebars from 'handlebars';
import { TriageableState, TriageResult, WorkspaceState } from './types.js';
import { analyzeWorkspace, formatWorkspaceState } from './workspaceAnalyzer.js';
import { parseTriageResponse } from './parser.js';
import { AgentRegistry } from './AgentRegistry.js';
import { accumulateTokenUsage } from '../../graph/llmHelpers.js';
import { runAskGraph } from '../../../architect/graph/ask/runner.js';
import { ChatAPIClient } from '../../../../core/adapters/ChatAPIClient.js';
import { WorkspacePathResolver } from '../../../../infrastructure/workspace/WorkspaceResolver.js';
import { getEstimatingLabel } from '../../graph/timing/estimatingLabels.js';

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
  if ((state as any).deps?.kanbanUpdate?.setEstimatingActivity) {
    const locale = (state as any)._uiLocale || 'en';
    (state as any).deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('triage', locale), 'triage');
  }
  
  // ✅ Skip triage if explicitly requested
  if (state.skipTriage) {
    console.log('⏭️  Triage skipped (skipTriage=true)\n');
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
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'triage', 0);
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
  
  // DEBUG: Check what values we have
  console.log('🔍 [DEBUG] State values for triage:');
  console.log(`   state.overrideDirective: "${state.overrideDirective?.substring(0, 50) || '(empty)'}..."`);
  console.log(`   state.directive: "${state.directive?.substring(0, 50) || '(empty)'}..."`);
  console.log(`   state.currentJob: "${state.currentJob || '(not set)'}"`);
  console.log(`   state.jobType: "${(state as any).jobType || '(not set)'}"`);
  
  const userInput = state.overrideDirective || state.directive || '';
  const currentJob = state.currentJob || (state as any).jobType || 'unknown';
  const currentAgent = state.currentAgent || 'architect';
  
  // Detect language from user input (for LLM to respond in same language)
  const language = AgentRegistry.detectLanguage(userInput);
  console.log(`🌐 Detected language: ${language}`);
  
  // Get job capabilities from YAML data
  const jobCapabilities = AgentRegistry.generatePromptContext();
  
  const prompt = buildTriagePrompt({
    userInput,
    currentJob,
    currentAgent,
    workspaceState,
    jobCapabilities,
  });
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Step 3: Call LLM
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('🤖 Calling LLM for triage...');
  console.log('📝 [DEBUG] Triage prompt (first 2000 chars):');
  console.log(prompt.substring(0, 2000));
  console.log('...\n');
  
  let responseText: string;
  
  if (llm.invokeWithUsage) {
    const response = await llm.invokeWithUsage([
      { role: 'user', content: prompt }
    ]);
    responseText = response.content;
    
    if (response.usage) {
      accumulateTokenUsage(state as any, response.usage, { taskLevel: true, jobLevel: true });
      // ✅ Push live token update to Kanban UI during estimating phase
      if ((state as any).deps?.kanbanUpdate?.updateTokenUsage && (state as any).tokenUsage) {
        (state as any).deps.kanbanUpdate.updateTokenUsage((state as any).tokenUsage);
      }
    }
  } else {
    responseText = await llm.invoke([
      { role: 'user', content: prompt }
    ]);
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Step 4: Parse Response
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('📝 [DEBUG] LLM response:');
  console.log(responseText);
  console.log('');
  
  let triageResult = parseTriageResponse(responseText, currentJob, currentAgent);
  
  if (!triageResult) {
    console.error('❌ [Triage] Failed to parse LLM response:');
    console.error('   Response (first 500 chars):', responseText.substring(0, 500));
    throw new Error('Failed to parse triage response from LLM. Expected <triage> block not found.');
  }
  
  logTriageResult(triageResult);
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Step 5: Handle Ask Intent with Agentic Ask System
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (triageResult.intent === 'ask' && triageResult.inScope) {
    // Run Agentic Ask Graph (explores Ant source code to answer)
    const askResult = await runAskGraph({
      question: userInput,
      language,
      workspaceState: {
        ...workspaceState,
        featurePath: state.context?.featurePath,  // ✅ Pass featurePath for debug logging
      },
      currentJob,
      currentAgent,
      deps: { llm },
      _httpJobId: state._httpJobId,
    });
    
    triageResult = {
      ...triageResult,
      askResponse: askResult.response,
      displayMessage: askResult.response,
    };
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
  
  if (willTerminate && (state as any).deps?.kanbanUpdate?.clearEstimatingActivity) {
    (state as any).deps.kanbanUpdate.clearEstimatingActivity();
  }
  
  // ✅ Record phase timing
  const _phaseTimings = { ...((state as any)._phaseTimings || {}), triage: Date.now() - phaseStart };
  
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

/**
 * Build triage prompt with job capabilities
 * Uses template files from core/prompt/templates/triage/
 */
/**
 * Generate agent capabilities context for triage prompt.
 * Describes each agent's scope so the LLM can detect agent mismatch.
 */
function generateAgentCapabilities(currentAgent: string): string {
  const agents: Record<string, { name: string; scope: string[] }> = {
    architect: {
      name: 'architect',
      scope: [
        'UI design specification (ui-tokens, ui-assets, ui-spec)',
        'System architecture and API design',
        'Source code implementation (any language/framework)',
        'Codebase analysis and indexing',
      ],
    },
    planner: {
      name: 'planner',
      scope: [
        'PRD (Product Requirements Document) creation',
        'PRD refinement and improvement',
        'Product requirement definition and scoping',
      ],
    },
  };
  
  const lines: string[] = [];
  lines.push(`Current agent: **${currentAgent}**\n`);
  
  for (const [id, agent] of Object.entries(agents)) {
    const isCurrent = id === currentAgent;
    lines.push(`### ${agent.name}${isCurrent ? ' (current)' : ''}`);
    lines.push(`Scope: ${agent.scope.join(', ')}`);
    lines.push('');
  }
  
  return lines.join('\n');
}

export function buildTriagePrompt(params: {
  userInput: string;
  currentJob: string;
  currentAgent: string;
  workspaceState: WorkspaceState;
  jobCapabilities: string;
}): string {
  const { userInput, currentJob, currentAgent, workspaceState, jobCapabilities } = params;
  
  const { base, rules } = loadTriageTemplates();
  
  // Generate agent capabilities for cross-agent detection
  const agentCapabilities = generateAgentCapabilities(currentAgent);
  
  // Render base template with variables
  const basePrompt = base({
    currentAgent,
    currentJob,
    userInput,
    jobCapabilities,
    agentCapabilities,
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
    hasUiDocs: workspaceState.hasUiDocs,
    hasSystemDesignDoc: workspaceState.hasSystemDesignDoc,
    hasCodebase: workspaceState.hasCodebase,
    indexedFileCount: workspaceState.indexedFileCount || 'unknown',
    hasDesignDoc: workspaceState.hasDesignDoc,
  });
  
  // Combine base + rules
  return `${basePrompt}\n\n---\n\n${rules}`;
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
  
  if (!result) {
    console.log('[TriageRouter] No triage result, proceeding to detectEnvironment');
    return 'detectEnvironment';
  }
  
  if (result.intent === 'ask') {
    console.log('[TriageRouter] ask intent → __end__');
    return '__end__';
  }
  
  if (result.workStatus === 'proceed') {
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
  
  console.log('[TriageRouter] default → detectEnvironment');
  return 'detectEnvironment';
}

// Re-export
export * from './types.js';
export { AgentRegistry } from './AgentRegistry.js';
export { analyzeWorkspace, formatWorkspaceState } from './workspaceAnalyzer.js';
export { parseTriageResponse } from './parser.js';
