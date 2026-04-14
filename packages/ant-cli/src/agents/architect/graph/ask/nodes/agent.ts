/**
 * Agent Node
 * 
 * LLM decision node that analyzes the question and decides:
 * 1. Call a tool to gather more information
 * 2. Generate final response (enough information)
 * 
 * Uses Anthropic native format (same as Code Job) for reliable tool calling.
 */

import { AskGraphState, ConversationMessage } from '../state.js';
import { ASK_TOOLS, WORKSPACE_TOOLS } from '../tools.js';
import { LLM_MAX_TOKENS } from '../../../../common/graph/llmConfig';
import { buildAssistantMessage } from '../../../../common/tool/messageBuilder';
import { accumulateTokenUsage } from '../../../../common/graph/llmHelpers.js';
import { formatWorkspaceState } from '../../../../common/nodes/triage/workspaceAnalyzer.js';
import { AgentRegistry } from '../../../../common/nodes/triage/AgentRegistry.js';
import { getChatAPIClient } from '../../../../../core/adapters/ChatAPIClient.js';
import { v4 as uuidv4 } from 'uuid';

const DEBUG = process.env.ASK_DEBUG === 'true';

/**
 * Build system prompt for Ask agent via PromptBuilder.build()
 */
async function buildSystemPrompt(state: AskGraphState): Promise<string> {
  const promptBuilder = state.deps?.promptBuilder;
  if (!promptBuilder) throw new Error('[Ask:Agent] PromptBuilder not available');

  const hasWorkspace = !!state.workspaceState?.featurePath;

  const result = await promptBuilder.build({
    templates: { base: 'ask/base', rules: 'ask/rules' },
    intent: state.resolvedAction?.intent,
    vars: {
      isKorean: state.language === 'ko',
      currentJob: state.currentJob || 'Not selected',
      currentAgent: state.currentAgent || 'architect',
      question: state.question,
      jobKnowledge: AgentRegistry.generateAskKnowledge(),
      hasWorkspace,
      workspaceState: hasWorkspace ? formatWorkspaceState(state.workspaceState) : '',
      featurePath: state.workspaceState?.featurePath || '',
    },
  });

  return [result.user, result.system].filter(Boolean).join('\n\n---\n\n');
}

/**
 * Agent node - LLM decides next action with streaming support
 * Uses Anthropic native format (same as Code Job)
 */
export async function agentNode(state: AskGraphState): Promise<Partial<AskGraphState>> {
  if (DEBUG) {
    console.log('\n🤖 [Agent] Processing...');
    console.log(`   Question: ${state.question.substring(0, 50)}...`);
    console.log(`   Tool calls so far: ${state.toolCalls.length}`);
  }
  
  const llm = state.deps?.llm;
  if (!llm) {
    throw new Error('LLM is required for agent node');
  }
  
  let isEvaluation = state.isEvaluation;
  let evalType = state.evalType;
  
  // Pre-set evaluation mode from RAC intent (triage classified as ask-evaluate)
  if (!isEvaluation && state.resolvedAction?.intent === 'ask-evaluate') {
    isEvaluation = true;
    if (DEBUG) {
      console.log('   📋 Evaluation mode pre-set from RAC intent (ask-evaluate)');
    }
  }
  
  // Build system prompt
  const systemPrompt = await buildSystemPrompt(state);
  
  // Build messages for LLM (Anthropic native format)
  // System message is passed separately via options
  const messages: ConversationMessage[] = [];
  
  // Add question as first user message if no history
  if (state.conversationHistory.length === 0) {
    messages.push({
      role: 'user',
      content: state.question,
    });
  } else {
    // Use existing conversation history
    messages.push(...state.conversationHistory);
  }

  // Anthropic API requires conversation to end with a user message.
  // After resume from interrupt, history may end with assistant turn.
  if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
    console.warn(`⚠️ [Ask:Agent] Messages end with assistant role — appending user continuation`);
    messages.push({ role: 'user', content: 'Continue.' });
  }
  
  // Setup streaming to chat UI (use singleton to maintain message state across tool calls)
  const chatAPI = getChatAPIClient();
  
  // ✅ Track if message already started (from previous agent calls in same ask session)
  let streamingStarted = state.chatMessageStarted || false;
  let responseText = '';
  let thinkingText = '';
  let toolCall: { id: string; name: string; args: Record<string, any> } | undefined;
  const toolCalls: Array<{ id: string; name: string; args: Record<string, any> }> = [];
  
  // Convert tools to ToolDefinition format
  // Include workspace tools when workspace context is available
  const hasWorkspace = !!state.workspaceState?.featurePath;
  const allTools = hasWorkspace ? [...ASK_TOOLS, ...WORKSPACE_TOOLS] : ASK_TOOLS;
  const toolDefinitions = allTools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
  
  // Check if this is first call (enable thinking) or continuation (disable thinking)
  // After tool_use, thinking must be disabled (Anthropic API requirement)
  const isFirstCall = state.conversationHistory.length === 0;
  
  try {
    // Use streaming API
    for await (const event of llm.stream(messages, { 
      system: systemPrompt,
      tools: toolDefinitions,
      maxTokens: LLM_MAX_TOKENS.DEFAULT,
      enableThinking: isFirstCall,
    })) {
      if (event.type === 'retry') {
        responseText = '';
        thinkingText = '';
        toolCalls.length = 0;
        toolCall = undefined;
        continue;
      }
      // Handle thinking events - show thinking card in UI
      if (event.type === 'thinking' && event.thinking) {
        if (!streamingStarted) {
          await chatAPI.startMessage();
          streamingStarted = true;
        }
        
        await chatAPI.sendLLMEvent({ type: 'thinking', thinking: event.thinking });
        thinkingText += event.thinking;
      }
      
      // Handle text events - stream to chat UI
      if (event.type === 'text' && event.text) {
        if (!streamingStarted) {
          await chatAPI.startMessage();
          streamingStarted = true;
        }
        
        await chatAPI.sendLLMEvent({ type: 'text', text: event.text });
        responseText += event.text;
      }
      
      // Handle tool use events
      if (event.type === 'tool_use' && event.toolUse) {
        const { id, name, input } = event.toolUse;
        const tc = { 
          id: id || uuidv4(),
          name, 
          args: input 
        };
        toolCalls.push(tc);
        toolCall = tc;
        
        if (DEBUG) {
          console.log(`   → Tool call detected: ${name}`);
        }
      }
      
      // Handle done event for token tracking
      if (event.type === 'done' && event.usage) {
        accumulateTokenUsage(state as any, event.usage, { taskLevel: true, jobLevel: true });
      }
    }
    
    if (DEBUG && thinkingText) {
      console.log(`   💭 Thinking: ${thinkingText.substring(0, 100)}...`);
    }
  } catch (error) {
    // If streaming fails, fall back to invoke
    console.warn('[Agent] Streaming failed, falling back to invoke:', error);
    
    if (llm.invokeWithTools) {
      const response = await llm.invokeWithTools(messages, allTools, { system: systemPrompt });
      responseText = response.content || '';
      
      if (response.toolCalls && response.toolCalls.length > 0) {
        for (const rtc of response.toolCalls) {
          const tc = { 
            id: rtc.id || uuidv4(), 
            name: rtc.name, 
            args: rtc.args 
          };
          toolCalls.push(tc);
          toolCall = tc;
        }
      }
      
      if (response.usage) {
        accumulateTokenUsage(state as any, response.usage, { taskLevel: true, jobLevel: true });
      }
    } else if (llm.invokeWithUsage) {
      const result = await llm.invokeWithUsage(messages, { system: systemPrompt });
      responseText = result.content;
      if (result.usage) {
        accumulateTokenUsage(state as any, result.usage, { taskLevel: true, jobLevel: true });
      }
    } else {
      responseText = await llm.invoke(messages, { system: systemPrompt });
    }
  }
  
  // Finalize streaming if we started it and no tool call
  const streamingCompleted = streamingStarted && !toolCall;
  if (streamingCompleted) {
    await chatAPI.finalizeMessage();
    
    if (DEBUG) {
      console.log(`   ✅ Streaming completed (${responseText.length} chars)`);
    }
  }
  
  if (DEBUG) {
    if (toolCall) {
      console.log(`   → Tool call: ${toolCall.name}(${JSON.stringify(toolCall.args)})`);
    } else if (!streamingCompleted) {
      console.log(`   → Final response (${responseText.length} chars)`);
    }
  }
  
  // Update conversation history (Anthropic native format - same as Code Job)
  const newHistory: ConversationMessage[] = [...state.conversationHistory];
  
  // Add question as first user message if empty
  if (state.conversationHistory.length === 0) {
    newHistory.push({
      role: 'user',
      content: state.question,
    });
  }
  
  // Detect evaluation from LLM response before building history.
  // The LLM outputs <eval type="..."/> when it produces a rubric-based evaluation report.
  // Must strip the tag before pushing to conversationHistory to avoid
  // leaking it into subsequent LLM calls in multi-turn sessions.
  let cleanedResponseText = responseText;
  if (!isEvaluation && responseText) {
    const evalDetection = parseEvalTag(responseText);
    if (evalDetection) {
      isEvaluation = true;
      evalType = evalDetection.type;
      cleanedResponseText = responseText.replace(/<eval\s+type="[^"]*"\s*\/?>/gi, '').trimEnd();
      console.log(`📋 [Ask] Evaluation detected from LLM response: type=${evalDetection.type}`);
    }
  }

  if (toolCalls.length > 0) {
    newHistory.push(buildAssistantMessage({ toolCalls }));
  } else if (cleanedResponseText) {
    newHistory.push(buildAssistantMessage({ text: cleanedResponseText }));
  }

  return {
    conversationHistory: newHistory,
    pendingToolCalls: toolCalls.length > 0 ? toolCalls : [],
    response: toolCalls.length > 0 ? undefined : cleanedResponseText,
    streamingCompleted,
    chatMessageStarted: streamingStarted,
    isEvaluation,
    evalType,
    tokenUsage: state.tokenUsage,
  };
}

/**
 * Router: decide next node based on agent output
 */
export function routeAfterAgent(state: AskGraphState): 'tool' | 'respond' {
  if (state.pendingToolCalls && state.pendingToolCalls.length > 0) {
    return 'tool';
  }
  return 'respond';
}

/**
 * Parse <eval type="..."/> tag from LLM response text.
 * The LLM is instructed to output this tag when it produces
 * a rubric-based evaluation report (see ask/rules.md).
 */
export function parseEvalTag(text: string): { type: NonNullable<AskGraphState['evalType']> } | null {
  const match = text.match(/<eval\s+type="(prd|system-design|ui-design|code|all)"\s*\/?>/i);
  if (match) {
    return { type: match[1].toLowerCase() as NonNullable<AskGraphState['evalType']> };
  }
  return null;
}
