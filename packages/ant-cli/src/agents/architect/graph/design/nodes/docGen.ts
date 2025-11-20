/**
 * DocGen Node - 문서 생성 추론 (Design Job용 LLM)
 * 
 * 책임:
 * - LLM 호출 및 스트리밍
 * - XML 파싱 (<file> 태그로 Markdown 실시간 렌더링)
 * - Thinking/Text 수집
 * - Tool Call 감지 (실행은 하지 않음!)
 * 
 * 하지 않는 것:
 * - Tool 실행
 * - 파일 쓰기 (tool 노드가 담당)
 * - 루프 (LangGraph가 관리)
 * 
 * ✅ NEW: XML 파서 통합 for Markdown 실시간 렌더링
 */

import { DesignGraphState } from '../state';
import { getChatAPIClient } from '../../../../../core/adapters/ChatAPIClient';
import { StreamOrchestrator } from '../../../../../core/streaming/StreamOrchestrator';
import { XMLStreamParser } from '../../../../../core/streaming/parsers/XMLStreamParser';
import { CommonRenderStrategy } from '../../../../../core/streaming/strategies/CommonRenderStrategy';
import { StreamBufferManager } from '../../../../../core/streaming/buffer/StreamBufferManager';

export async function docGen(
  state: DesignGraphState
): Promise<Partial<DesignGraphState>> {
  console.log('\n📝 [DocGen] Starting document generation...\n');
  
  const llmClient = state.deps?.llm;
  const gitPort = state.deps?.git;
  if (!llmClient || !gitPort) {
    throw new Error('LLM client or GitPort not available');
  }
  
  // ✅ 1. Initialize BufferManager (if not exists)
  if (!state._bufferManager) {
    // ✅ CRITICAL: Use featurePath to get projectPath (not codebase!)
    // featurePath: /workspaces/{org}/{user}/{project}/features/{feature}
    // projectPath: /workspaces/{org}/{user}/{project}
    const featurePath = state.context.featurePath;
    if (!featurePath) {
      throw new Error('featurePath not available in context. Ensure resolve node has run.');
    }
    
    const path = await import('path');
    const featureName = state.context.featureFolder || state.context.feature?.name || 'default';
    const projectPath = featurePath.replace(`/features/${featureName}`, '');
    const jobId = state._httpJobId || 'unknown';
    
    state._bufferManager = new StreamBufferManager(projectPath, featureName, 'design', jobId);
    console.log(`📦 [DocGen] BufferManager initialized: ${projectPath}/features/${featureName}/.buffers/design`);
  }
  
  // ✅ 2. Build messages from conversation history + current task
  const messages = await buildMessages(state);
  
  // ✅ 3. Design job uses PURE XML streaming - no tool calling!
  // All file operations are done via <file>, <append>, <edit> tags
  const tools = undefined;
  
  console.log(`📝 [DocGen] Pure XML streaming mode (no tool calling)`);
  
  // ✅ 4. Workflow update
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority
    } : undefined;
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'docGen', taskInfo);
  }
  
  // ✅ 5. Setup XML Parser + StreamOrchestrator
  const chatAPI = getChatAPIClient();
  await chatAPI.showChatStatus('placeholder');
  
  const parser = new XMLStreamParser();
  const renderStrategy = new CommonRenderStrategy(
    chatAPI,
    state._bufferManager  // ✅ Pass buffer manager (2 params only)
  );
  
  const existingFiles = new Set(state.files?.map(f => f.path) || []);
  const orchestrator = new StreamOrchestrator({
    parser,
    renderStrategy,
    existingFiles,
  });
  
  // ✅ 6. Collect LLM output
  let thinking = '';
  let textResponse = '';
  
  try {
    // ✅ Stream with XML parsing only (no tool calling)
    for await (const event of llmClient.stream(messages, {
      tools: undefined,  // ✅ No tool calling for design job
      maxTokens: 16000,
      enableThinking: true,  // ✅ Always enable thinking for design job
    })) {
      // ✅ Pass to orchestrator for XML parsing (<file>, <append>, <edit>)
      await orchestrator.processEvent(event);
      
      // Thinking
      if (event.type === 'thinking') {
        thinking += event.thinking || '';
      }
      
      // Text
      if (event.type === 'text') {
        textResponse += event.text || '';
      }
      
      // Done
      if (event.type === 'done') {
        await chatAPI.sendLLMEvent(event);
      }
    }
    
    // ✅ Finalize orchestrator (flush buffer and save files)
    await orchestrator.finalize(false);  // No tool calls in XML streaming
    
    // ✅ Get generated files from buffer
    const buffers = state._bufferManager?.getAllBuffers() || new Map();
    const files = Array.from(buffers.values()).map(buffer => ({
      path: buffer.filePath,
      content: buffer.content
    }));
    
    console.log(`\n✅ [DocGen] XML streaming complete`);
    console.log(`   Thinking: ${thinking.length} chars`);
    console.log(`   Text: ${textResponse.length} chars`);
    console.log(`   Files generated: ${files.length}`);
    files.forEach(f => console.log(`      📄 ${f.path}: ${f.content.length} chars`));
    
    // ✅ Return generated files
    return {
      files,  // ✅ Files from XML streaming
      _bufferManager: state._bufferManager,
    };
  } catch (error) {
    console.error('❌ [DocGen] Error during reasoning:', error);
    throw error;
  }
}

/**
 * Build messages for LLM using PromptEngine
 */
async function buildMessages(state: DesignGraphState): Promise<Array<{
  role: 'user' | 'assistant';
  content: string | any[];
}>> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string | any[] }> = [];
  
  // ✅ Use PromptEngine for system prompt (if no conversation history)
  if (!state.conversationHistory || state.conversationHistory.length === 0) {
    const promptEngine = state.deps?.promptEngine;
    
    if (!promptEngine) {
      throw new Error('[DocGen] PromptEngine is required but not available in state.deps');
    }
    
    if (!state.currentTask) {
      throw new Error('[DocGen] currentTask is required but not available in state');
    }
    // ✅ Build prompt using PromptEngine
    const promptResult = await promptEngine.buildExecutePrompt(
      'design',  // ✅ AgentTask type (not the task object!)
      state.context,
      {
        directive: state.directive || state.spec,
        designDoc: undefined,  // Design job doesn't use designDoc in execute
        previousDesign: state.design,  // Use previousDesign for design job
        prdSpec: state.prd,
        currentCode: state.code,
        currentTask: {
          name: state.currentTask.name,
          type: state.currentTask.type,
          description: state.currentTask.description,
        },
      },
      undefined,
      undefined
    );
    
    // ✅ Extract base prompt from PromptEngine (templates, rules, profiles)
    const systemMessage = promptResult.formatted.messages.find(m => m.role === 'system' || m.role === 'user');
    
    // ✅ CRITICAL: content can be string OR array (Anthropic format)
    let basePrompt = '';
    if (systemMessage) {
      if (typeof systemMessage.content === 'string') {
        basePrompt = systemMessage.content;
      } else if (Array.isArray(systemMessage.content)) {
        // Anthropic format: [{ type: 'text', text: '...' }]
        const contentArray = systemMessage.content as any[];
        basePrompt = contentArray
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('\n');
      }
    }
    
    // ✅ CRITICAL: Add runtime context (task, plan, existing design, file format)
    // PromptEngine provides templates, buildRuntimeContext adds execution context
    const runtimeContext = buildRuntimeContext(state);
    
    // ✅ DEBUG: Type check before merge
    console.log(`\n🔍 [DocGen] Before merge:`);
    console.log(`   basePrompt type: ${typeof basePrompt}, length: ${basePrompt.length}`);
    console.log(`   runtimeContext type: ${typeof runtimeContext}, length: ${runtimeContext.length}`);
    
    // ✅ Merge: PromptEngine base + runtime context
    const mergedContent = `${basePrompt}\n\n${runtimeContext}`;
    console.log(`   mergedContent type: ${typeof mergedContent}, length: ${mergedContent.length}`);
    
    messages.push({
      role: 'user',
      content: mergedContent,
    });
  }
  
  // ✅ Add conversation history (if exists)
  // CRITICAL: Conversation history from LLM may have content as arrays (tool_use, tool_result)
  // We need to pass them as-is for proper context continuation
  if (state.conversationHistory && state.conversationHistory.length > 0) {
    messages.push(...state.conversationHistory);
  }
  
  return messages;
}

/**
 * Build runtime context (task, plan, existing design, file format, instructions)
 * 
 * This supplements PromptEngine's base prompt with execution-specific context:
 * - Current task and directive
 * - Execution plan (from plan node)
 * - Existing design (for continuation)
 * - File output format (Markdown streaming)
 * - Tool instructions
 */
function buildRuntimeContext(state: DesignGraphState): string {
  const task = state.currentTask;
  const lines: string[] = [];
  
  // ✅ 1. Current Task
  if (task) {
    lines.push(`# Current Task`);
    lines.push(`**${task.name}**`);
    lines.push(task.description);
    lines.push('');
  }
  
  // ✅ 2. Directive (user requirements)
  if (state.directive || state.spec) {
    lines.push(`# Directive`);
    lines.push(state.directive || state.spec);
    lines.push('');
  }
  
  // ✅ 3. Existing Design (for continuation/evolution)
  if (state.design) {
    lines.push(`# Existing Design Document`);
    lines.push(state.design);
    lines.push('');
  }
  
  // ✅ 4. Execution Plan (from plan node)
  if (state.planText) {
    lines.push(`# Execution Plan`);
    lines.push(state.planText);
    lines.push('');
  }
  
  // ✅ Note: Output format instructions are in PromptEngine templates
  // (design/phases/execute/rules.md)
  // Design job uses pure XML streaming - no tool calling needed!
  
  return lines.join('\n');
}

