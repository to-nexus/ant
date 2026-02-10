/**
 * Agent Node
 * 
 * LLM decision node that analyzes the question and decides:
 * 1. Call a tool to gather more information
 * 2. Generate final response (enough information)
 * 
 * Uses Anthropic native format (same as Code Job) for reliable tool calling.
 */

import * as fs from 'fs';
import * as path from 'path';
import Handlebars from 'handlebars';
import { AskGraphState, ConversationMessage, ContentBlock } from '../state.js';
import { ASK_TOOLS, WORKSPACE_TOOLS } from '../tools.js';
import { accumulateTokenUsage } from '../../common/llmHelpers.js';
import { WorkspacePathResolver } from '../../../../../infrastructure/workspace/WorkspaceResolver.js';
import { formatWorkspaceState } from '../../../../common/nodes/triage/workspaceAnalyzer.js';
import { getChatAPIClient } from '../../../../../core/adapters/ChatAPIClient.js';
import { v4 as uuidv4 } from 'uuid';

const DEBUG = process.env.ASK_DEBUG === 'true';

// Template cache
let askBaseTemplate: Handlebars.TemplateDelegate | null = null;
let askRulesContent: string | null = null;

/**
 * Load ask templates from files
 * Uses WHAT/HOW separation: base.md (WHAT) + rules.md (HOW)
 */
function loadAskTemplates(): { base: Handlebars.TemplateDelegate; rules: string } {
  if (askBaseTemplate && askRulesContent) {
    return { base: askBaseTemplate, rules: askRulesContent };
  }
  
  const templateDir = path.join(WorkspacePathResolver.getPromptTemplatesPath(), 'ask');
  
  const basePath = path.join(templateDir, 'base.md');
  const rulesPath = path.join(templateDir, 'rules.md');
  
  const baseContent = fs.readFileSync(basePath, 'utf-8');
  askRulesContent = fs.readFileSync(rulesPath, 'utf-8');
  askBaseTemplate = Handlebars.compile(baseContent);
  
  return { base: askBaseTemplate, rules: askRulesContent };
}

/**
 * Build system prompt for Ask agent
 */
function buildSystemPrompt(state: AskGraphState): string {
  const { base, rules } = loadAskTemplates();
  
  const hasWorkspace = !!state.workspaceState?.featurePath;
  
  const basePrompt = base({
    isKorean: state.language === 'ko',
    currentJob: state.currentJob || 'Not selected',
    currentAgent: state.currentAgent || 'architect',
    question: state.question,
    // Workspace context
    hasWorkspace,
    workspaceState: hasWorkspace ? formatWorkspaceState(state.workspaceState) : '',
    featurePath: state.workspaceState?.featurePath || '',
  });
  
  return `${basePrompt}\n\n---\n\n${rules}`;
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
  
  // Build system prompt
  const systemPrompt = buildSystemPrompt(state);
  
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
  
  // Setup streaming to chat UI (use singleton to maintain message state across tool calls)
  const chatAPI = getChatAPIClient();
  
  // ✅ Track if message already started (from previous agent calls in same ask session)
  let streamingStarted = state.chatMessageStarted || false;
  let responseText = '';
  let thinkingText = '';
  let toolCall: { id: string; name: string; args: Record<string, any> } | undefined;
  
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
      system: systemPrompt,  // Pass system separately
      tools: toolDefinitions,
      enableThinking: isFirstCall,
    })) {
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
        toolCall = { 
          id: id || uuidv4(),  // Use provided ID or generate one
          name, 
          args: input 
        };
        
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
        const tc = response.toolCalls[0];
        toolCall = { 
          id: tc.id || uuidv4(), 
          name: tc.name, 
          args: tc.args 
        };
      }
      
      if (response.usage) {
        accumulateTokenUsage(state as any, response.usage, { taskLevel: true, jobLevel: true });
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
  
  // Add assistant response
  if (toolCall) {
    // When making a tool call, add tool_use content block (Anthropic native format)
    newHistory.push({
      role: 'assistant',
      content: [{
        type: 'tool_use',
        id: toolCall.id,
        name: toolCall.name,
        input: toolCall.args,
      }],
    });
  } else if (responseText) {
    // Final text response
    newHistory.push({
      role: 'assistant',
      content: responseText,
    });
  }
  
  return {
    conversationHistory: newHistory,
    pendingToolCall: toolCall,
    response: toolCall ? undefined : responseText,
    streamingCompleted,
    chatMessageStarted: streamingStarted,  // ✅ Persist across tool calls
    tokenUsage: state.tokenUsage,
  };
}

/**
 * Router: decide next node based on agent output
 */
export function routeAfterAgent(state: AskGraphState): 'tool' | 'respond' {
  if (state.pendingToolCall) {
    return 'tool';
  }
  return 'respond';
}
