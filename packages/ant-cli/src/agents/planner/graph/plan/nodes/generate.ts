/**
 * Generate Node
 * 
 * ReAct agent that generates or refines the PRD.
 * Can use tools (workspace read, web search) to gather information.
 */

import * as path from 'path';
import * as fs from 'fs';
import Handlebars from 'handlebars';
import { PlanGraphState } from '../state';
import { accumulateTokenUsage } from '../../../../common/graph/llmHelpers';
import { WorkspacePathResolver } from '../../../../../infrastructure/workspace/WorkspaceResolver';
import { getChatAPIClient } from '../../../../../core/adapters/ChatAPIClient';
import { v4 as uuidv4 } from 'uuid';
import { PLANNER_TOOLS } from '../../tools';
import { getEstimatingLabel } from '../../../../common/graph/timing/estimatingLabels';

// Template cache
let planBaseTemplate: Handlebars.TemplateDelegate | null = null;
let planRulesContent: string | null = null;

function loadPlanTemplates(): { base: Handlebars.TemplateDelegate; rules: string } {
  if (planBaseTemplate && planRulesContent) {
    return { base: planBaseTemplate, rules: planRulesContent };
  }
  
  const templateDir = path.join(WorkspacePathResolver.getPromptTemplatesPath(), 'planner', 'plan');
  
  const basePath = path.join(templateDir, 'base.md');
  const rulesPath = path.join(templateDir, 'rules.md');
  
  const baseContent = fs.readFileSync(basePath, 'utf-8');
  planRulesContent = fs.readFileSync(rulesPath, 'utf-8');
  planBaseTemplate = Handlebars.compile(baseContent);
  
  return { base: planBaseTemplate, rules: planRulesContent };
}

function buildSystemPrompt(state: PlanGraphState): string {
  const { base, rules } = loadPlanTemplates();
  
  const basePrompt = base({
    isKorean: state.language === 'ko',
    directive: state.directive,
    mode: state.mode,
    existingDocument: state.existingDocument || '',
    hasExistingDocument: !!state.existingDocument,
    evalReport: state.evalReport || '',
    hasEvalReport: !!state.evalReport,
    rubricContent: state.rubricContent || '',
    hasRubric: !!state.rubricContent && !state.evalReport,
    recentTurnSummaries: state.recentTurnSummaries?.join('\n') || '',
    hasRecentTurns: (state.recentTurnSummaries?.length || 0) > 0,
  });
  
  return `${basePrompt}\n\n---\n\n${rules}`;
}

/**
 * Generate node - LLM generates/refines PRD with tool support
 */
export async function generateNode(state: PlanGraphState): Promise<Partial<PlanGraphState>> {
  console.log(`\n🤖 [Planner:Generate] ${state.mode === 'generate' ? 'Creating' : 'Refining'} PRD...`);
  
  // Kanban activity banner
  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('generate', state._uiLocale || 'en'), 'generate');
  }
  
  // Workflow instrumentation
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'generate', 0);
  }
  
  const llm = state.deps?.llm;
  if (!llm) {
    throw new Error('LLM is required for generate node');
  }
  
  const systemPrompt = buildSystemPrompt(state);
  
  // Build messages
  const messages: Array<{ role: string; content: any }> = [];
  
  if (state.conversationHistory.length === 0) {
    messages.push({ role: 'user', content: state.directive });
  } else {
    messages.push(...state.conversationHistory);
  }
  
  // Setup tools
  const toolDefinitions = PLANNER_TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
  
  // Setup streaming
  // NOTE: PRD text is NOT streamed as chat — it goes to the write node as a file card.
  // Only thinking events and tool-call reasoning are streamed to chat.
  const chatAPI = getChatAPIClient();
  let responseText = '';
  let toolCall: { id: string; name: string; args: Record<string, any> } | undefined;
  
  const isFirstCall = state.conversationHistory.length === 0;
  
  try {
    for await (const event of llm.stream(messages, {
      system: systemPrompt,
      tools: toolDefinitions,
      enableThinking: isFirstCall,
    })) {
      if (event.type === 'text' && event.text) {
        // Accumulate text — do NOT stream to chat yet (may be the final PRD)
        responseText += event.text;
      }
      
      if (event.type === 'thinking' && event.thinking) {
        await chatAPI.sendLLMEvent({ type: 'thinking', thinking: event.thinking });
      }
      
      if (event.type === 'tool_use' && event.toolUse) {
        const { id, name, input } = event.toolUse;
        toolCall = { id: id || uuidv4(), name, args: input };
      }
      
      if (event.type === 'done' && event.usage) {
        accumulateTokenUsage(state, event.usage, { taskLevel: false, jobLevel: true });
      }
    }
  } catch (error: any) {
    console.error(`❌ [Planner:Generate] LLM error: ${error.message}`);
    throw error;
  }
  
  // Update conversation history
  const updatedHistory = [...state.conversationHistory];
  
  if (state.conversationHistory.length === 0) {
    updatedHistory.push({ role: 'user', content: state.directive });
  }
  
  // Workflow instrumentation
  if (state.deps?.workflowUpdate && state._httpJobId) {
    state.deps.workflowUpdate.exitNode(state._httpJobId, 'generate', 0);
  }
  
  if (toolCall) {
    // Tool call path: text is reasoning, send to chat
    if (responseText) {
      await chatAPI.sendLLMEvent({ type: 'text', text: responseText });
    }
    
    updatedHistory.push({
      role: 'assistant',
      content: [
        ...(responseText ? [{ type: 'text', text: responseText }] : []),
        { type: 'tool_use', id: toolCall.id, name: toolCall.name, input: toolCall.args },
      ],
    });
    
    return {
      conversationHistory: updatedHistory,
      pendingToolCall: toolCall,
    };
  }
  
  // Final text = PRD document → pass to write node as file (NOT streamed to chat)
  updatedHistory.push({ role: 'assistant', content: responseText });
  
  return {
    conversationHistory: updatedHistory,
    generatedDocument: responseText,
    pendingToolCall: undefined,
  };
}

/**
 * Router: decide next node
 */
export function routeAfterGenerate(state: PlanGraphState): 'tool' | 'write' {
  if (state.pendingToolCall) {
    return 'tool';
  }
  return 'write';
}
