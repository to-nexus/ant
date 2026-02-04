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
import { accumulateTokenUsage } from '../../../architect/graph/common/llmHelpers.js';
import { askResponseGenerator } from '../../../../core/ask/AskResponseGenerator.js';
import { ChatAPIClient } from '../../../../core/adapters/ChatAPIClient.js';
import { WorkspacePathResolver } from '../../../../infrastructure/workspace/WorkspaceResolver.js';

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
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🏥 TRIAGE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
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
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'triage');
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Step 1: Analyze Workspace State
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('📋 Analyzing workspace state...');
  
  const workspaceState = await analyzeWorkspace(state.context, state.deps as any);
  
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
  console.log(`   state.spec: "${state.spec?.substring(0, 50) || '(empty)'}..."`);
  console.log(`   state.currentJob: "${state.currentJob || '(not set)'}"`);
  console.log(`   state.jobType: "${(state as any).jobType || '(not set)'}"`);
  
  const userInput = state.overrideDirective || state.spec || '';
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
  
  // ✅ Create shared ChatAPIClient for entire triage flow
  // Show placeholder before LLM call for loading indication
  const chatAPI = new ChatAPIClient();
  await chatAPI.startMessage();
  await chatAPI.showChatStatus('analyzing', { node: 'triage' });
  
  let responseText: string;
  
  if (llm.invokeWithUsage) {
    const response = await llm.invokeWithUsage([
      { role: 'user', content: prompt }
    ]);
    responseText = response.content;
    
    if (response.usage) {
      accumulateTokenUsage(state as any, response.usage, { taskLevel: true, jobLevel: true });
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
  
  let triageResult = parseTriageResponse(responseText, currentJob);
  
  if (!triageResult) {
    console.error('❌ [Triage] Failed to parse LLM response:');
    console.error('   Response (first 500 chars):', responseText.substring(0, 500));
    throw new Error('Failed to parse triage response from LLM. Expected <triage> block not found.');
  }
  
  logTriageResult(triageResult);
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Step 5: Handle Ask Intent with Ask System (Streaming)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (triageResult.intent === 'ask' && triageResult.inScope) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('💬 ASK SYSTEM');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    console.log(`📝 Question: ${userInput.substring(0, 50)}${userInput.length > 50 ? '...' : ''}`);
    console.log(`🌐 Language: ${language}\n`);
    
    // ✅ Reuse chatAPI from Step 3 (already has active message with placeholder)
    // Generate response with streaming
    const askContext = {
      userQuestion: userInput,
      workspaceState,
      currentJob,
      currentAgent,
      language,
    };
    
    let fullResponse = '';
    const generator = askResponseGenerator.generateStreaming(askContext, { llm });
    
    // Stream response to chat UI (will replace placeholder)
    for await (const event of generator) {
      if (event.type === 'text' && event.text) {
        await chatAPI.sendLLMEvent({ type: 'text', text: event.text });
        fullResponse += event.text;
      }
    }
    
    await chatAPI.finalizeMessage();
    
    triageResult = {
      ...triageResult,
      askResponse: fullResponse,
      displayMessage: fullResponse,
    };
    
    console.log('✅ Ask System response streamed to Chat UI');
  }
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Step 6: Send Response to Chat UI (for non-proceed, non-ask cases)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  else {
    const shouldSendToChat = 
      (triageResult.intent === 'ask' && !triageResult.inScope) ||
      triageResult.workStatus === 'redirect' ||
      triageResult.workStatus === 'blocked';
    
    if (shouldSendToChat && triageResult.displayMessage) {
      // ✅ Reuse chatAPI from Step 3 (already has active message with placeholder)
      if (triageResult.needsChoice && triageResult.choiceOptions) {
        // Send triage_choice message with choice options (will replace placeholder)
        await chatAPI.sendTriageChoice(
          triageResult.displayMessage,
          state._httpJobId || 'unknown',
          triageResult.choiceOptions,
          triageResult,  // ✅ Pass full triageResult for pending choice registration
          userInput  // ✅ Pass original directive for redirect
        );
      } else {
        // Send simple text message (not streamed - these are short system messages)
        await chatAPI.sendLLMEvent({ type: 'text', text: triageResult.displayMessage });
      }
      
      await chatAPI.finalizeMessage();
      console.log('📤 Response sent to Chat UI');
    } else if (triageResult.workStatus === 'proceed') {
      // ✅ work:proceed - Cancel the placeholder message (next node will start its own)
      // Don't leave an empty message with just placeholder
      await chatAPI.finalizeMessage(true);  // cancelled=true removes placeholder
      console.log('⏭️  Proceeding to next step (placeholder removed)');
    } else {
      // Other cases (shouldn't happen, but finalize to be safe)
      await chatAPI.finalizeMessage();
    }
  }
  
  // ✅ Workflow instrumentation: Exit node
  if (state.deps?.workflowUpdate && state._httpJobId) {
    state.deps.workflowUpdate.exitNode(state._httpJobId, 'triage');
  }
  
  return {
    triageResult,
    workspaceState,
    tokenUsage: state.tokenUsage
  } as Partial<T>;
}

/**
 * Build triage prompt with job capabilities
 * Uses template files from core/prompt/templates/triage/
 */
function buildTriagePrompt(params: {
  userInput: string;
  currentJob: string;
  currentAgent: string;
  workspaceState: WorkspaceState;
  jobCapabilities: string;
}): string {
  const { userInput, currentJob, currentAgent, workspaceState, jobCapabilities } = params;
  
  const { base, rules } = loadTriageTemplates();
  
  // Render base template with variables
  const basePrompt = base({
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
