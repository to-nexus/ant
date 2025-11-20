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
    const projectPath = await gitPort.getRepoRoot();  // ✅ await 추가
    const featureName = state.context.feature?.name || 'default';
    const jobId = state._httpJobId || 'unknown';
    
    state._bufferManager = new StreamBufferManager(projectPath, featureName, 'design', jobId);
    console.log(`📦 [DocGen] BufferManager initialized`);
  }
  
  // ✅ 2. Build messages from conversation history + current task
  const messages = await buildMessages(state);
  
  // ✅ 3. Tool activation control: Design job도 tool calling 사용
  const tools = getAvailableTools();
  
  console.log(`🔧 [DocGen] Tool calling enabled (design job)`);
  
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
  const toolCalls: Array<{
    id: string;
    name: string;
    args: Record<string, any>;
  }> = [];
  
  try {
    // ✅ Single stream (no loop!)
    for await (const event of llmClient.stream(messages, {
      tools,
      maxTokens: 16000,
    })) {
      // ✅ Pass to orchestrator for XML parsing
      await orchestrator.processEvent(event);
      
      // Thinking
      if (event.type === 'thinking') {
        thinking += event.thinking || '';
      }
      
      // Text
      if (event.type === 'text') {
        textResponse += event.text || '';
      }
      
      // Tool call (감지만, 실행 안함!)
      if (event.type === 'tool_use' && event.toolUse) {
        const { id, name, input } = event.toolUse;
        
        console.log(`🔧 [DocGen] Tool call detected: ${name}`);
        console.log(`   Args:`, JSON.stringify(input, null, 2));
        
        // 🎯 CRITICAL: Only send FIRST tool call to UI (Standard Tool Calling pattern)
        if (toolCalls.length === 0) {
          await chatAPI.sendLLMEvent(event);
          console.log(`   ✅ Sent to UI (first tool call)`);
        } else {
          console.log(`   ⚠️  Skipped UI display (will be dropped by tool node)`);
        }
        
        toolCalls.push({
          id,
          name,
          args: input,
        });
      }
    }
    
    // ✅ Finalize orchestrator (flush buffer)
    // Pass hasToolCalls flag to prevent premature message finalization
    const hasToolCalls = toolCalls.length > 0;
    await orchestrator.finalize(hasToolCalls);
    
    console.log(`\n✅ [DocGen] Reasoning complete`);
    console.log(`   Thinking: ${thinking.length} chars`);
    console.log(`   Text: ${textResponse.length} chars`);
    console.log(`   Tool calls: ${toolCalls.length}`);
    console.log(`   Buffer stats:`, state._bufferManager?.getStats());
    
    // ✅ Return LLM response (state에 저장)
    return {
      llmResponse: {
        thinking,
        textResponse,
        toolCalls,
        done: toolCalls.length === 0,  // 도구 호출 없으면 완료
      },
      _bufferManager: state._bufferManager,  // ✅ Preserve buffer manager
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
    
    if (promptEngine && state.currentTask) {
      try {
        // ✅ Build prompt using PromptEngine
        const promptResult = await promptEngine.buildExecutePrompt(
          state.currentTask as any,  // Cast to AgentTask
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
        
        // ✅ Extract system prompt from formatted messages
        const systemMessage = promptResult.formatted.messages.find(m => m.role === 'system' || m.role === 'user');
        if (systemMessage) {
          messages.push({
            role: 'user',
            content: systemMessage.content,
          });
        }
      } catch (error) {
        console.warn('[DocGen] Failed to use PromptEngine, falling back:', error);
        messages.push({
          role: 'user',
          content: buildSystemPrompt(state),
        });
      }
    } else {
      // Fallback: When PromptEngine or currentTask unavailable
      messages.push({
        role: 'user',
        content: buildSystemPrompt(state),
      });
    }
  }
  
  // ✅ Add conversation history (if exists)
  if (state.conversationHistory && state.conversationHistory.length > 0) {
    messages.push(...state.conversationHistory);
  }
  
  return messages;
}

/**
 * Build system prompt for design job
 * 
 * NOTE: This uses a simplified prompt structure.
 * Full PromptEngine integration with design/phases/execute/base.md template
 * should be implemented in the future.
 */
function buildSystemPrompt(state: DesignGraphState): string {
  const task = state.currentTask;
  
  return `You are an expert technical writer and software architect.

Current task: ${task?.name || 'Generate design document'}
Description: ${task?.description || 'No description provided'}

Directive: ${state.directive || state.spec}

${state.design ? `\nExisting Design:\n${state.design}\n` : ''}

${state.planText ? `\nPlan:\n${state.planText}\n` : ''}

**IMPORTANT: Markdown File Output Format**

For Markdown (.md) files, follow this two-step process:

1. **Stream content with <file> tag** (for live preview):
\`\`\`xml
<file path="DESIGN.md">
# System Design
...
</file>
\`\`\`

2. **Call write_file() with empty content** (to save from buffer):
\`\`\`json
{
  "tool": "write_file",
  "arguments": {
    "path": "DESIGN.md",
    "content": ""
  }
}
\`\`\`

For other files (.ts, .tsx, .json, etc.), directly use write_file() tool.

**Available tools:**
- write_file(path, content): Save file (leave content empty for .md files already streamed)
- read_file(path): Read existing files
- list_files(directory, pattern): Browse project structure
- search_code(pattern): Search codebase
- delete_file(path): Remove outdated files
- mkdir(path): Create directories

When done, do NOT call any more tools.`;
}

/**
 * Get available tools
 */
function getAvailableTools(): import('../../../../../core/ports/llm').ToolDefinition[] {
  // ✅ Same tools as Code job (unified!)
  return [
    {
      name: 'write_file',
      description: 'Create or overwrite a file with the given content',
      input_schema: {
        type: 'object' as const,
        properties: {
          path: {
            type: 'string',
            description: 'File path relative to project root',
          },
          content: {
            type: 'string',
            description: 'File content',
          },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'read_file',
      description: 'Read the contents of a file',
      input_schema: {
        type: 'object' as const,
        properties: {
          path: {
            type: 'string',
            description: 'File path relative to project root',
          },
        },
        required: ['path'],
      },
    },
    {
      name: 'list_files',
      description: 'List files in a directory',
      input_schema: {
        type: 'object' as const,
        properties: {
          directory: {
            type: 'string',
            description: 'Directory path (optional, defaults to ".")',
          },
          pattern: {
            type: 'string',
            description: 'Filename pattern to filter (optional)',
          },
        },
        required: [],
      },
    },
    {
      name: 'search_code',
      description: 'Search for a pattern in the codebase',
      input_schema: {
        type: 'object' as const,
        properties: {
          pattern: {
            type: 'string',
            description: 'Search pattern',
          },
          file_pattern: {
            type: 'string',
            description: 'File pattern to filter (optional)',
          },
        },
        required: ['pattern'],
      },
    },
    {
      name: 'delete_file',
      description: 'Delete a file from the codebase',
      input_schema: {
        type: 'object' as const,
        properties: {
          path: {
            type: 'string',
            description: 'File path relative to project root',
          },
        },
        required: ['path'],
      },
    },
    {
      name: 'mkdir',
      description: 'Create a directory (and parent directories if needed)',
      input_schema: {
        type: 'object' as const,
        properties: {
          path: {
            type: 'string',
            description: 'Directory path relative to project root',
          },
        },
        required: ['path'],
      },
    },
  ];
}

