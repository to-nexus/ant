/**
 * CodeGen Node - 코드 생성 추론 (순수 LLM 추론)
 * 
 * 책임:
 * - LLM 호출 및 스트리밍
 * - Thinking/Text 수집
 * - Tool Call 감지 (실행은 하지 않음!)
 * 
 * 하지 않는 것:
 * - Tool 실행
 * - 파일 쓰기
 * - 루프 (LangGraph가 관리)
 */

import { ArchitectGraphState } from '../state';
import { getChatAPIClient } from '../../../../../core/adapters/ChatAPIClient';
import { StreamOrchestrator } from '../../../../../core/streaming/StreamOrchestrator';
import { XMLStreamParser } from '../../../../../core/streaming/parsers/XMLStreamParser';
import { CommonRenderStrategy } from '../../../../../core/streaming/strategies/CommonRenderStrategy';
import { StreamBufferManager } from '../../../../../core/streaming/buffer/StreamBufferManager';

export async function codeGen(
  state: ArchitectGraphState
): Promise<Partial<ArchitectGraphState>> {
  console.log('\n💭 [CodeGen] Starting reasoning...\n');
  
  const llmClient = state.deps?.llm;
  if (!llmClient) {
    throw new Error('LLM client not available');
  }
  
  // ✅ Build messages from conversation history + current task
  const messages = await buildMessages(state);
  
  // ✅ Tool activation control: Only enable for code job
  // Design job uses XML streaming (not tool calling)
  const enableTools = state.codeMode !== undefined;  // code job has codeMode
  const tools = enableTools ? getAvailableTools() : undefined;
  
  if (enableTools) {
    console.log(`🔧 [CodeGen] Tool calling enabled (code job)`);
  } else {
    console.log(`📝 [CodeGen] Tool calling disabled (design job or other)`);
  }
  
  // ✅ Workflow update
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority
    } : undefined;
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId, 
      'codeGen',  // ✅ FIX: Must match graph.addNode() name!
      taskInfo, 
      undefined, // llmInfo
      state.recursionCount,
      state.recursionLimit
    );
  }
  
  // ✅ UI streaming
  const chatAPI = getChatAPIClient();
  await chatAPI.showChatStatus('placeholder');
  
  // ✅ Initialize BufferManager for MD file streaming (if not exists)
  if (!state._bufferManager) {
    // ✅ Code job works in CODEBASE directory (not features/)
    // Get codebase path from context
    const gitPort = state.deps?.git;
    if (!gitPort) {
      throw new Error('[CodeGen] GitPort is required but not available');
    }
    
    const projectPath = await gitPort.getRepoRoot();
    
    // ✅ Validate projectPath is string
    if (typeof projectPath !== 'string') {
      console.error('[CodeGen] getRepoRoot returned non-string:', projectPath);
      throw new Error('[CodeGen] GitPort.getRepoRoot() must return a string path');
    }
    
    const featureName = state.featureName || 'unknown';
    const jobId = state._httpJobId || 'unknown';
    
    console.log(`📦 [CodeGen] Initializing BufferManager:`, {
      projectPath,
      featureName,
      jobId,
    });
    
    state._bufferManager = new StreamBufferManager(projectPath, featureName, 'code', jobId);
    console.log(`📦 [CodeGen] BufferManager initialized`);
  }
  
  // ✅ Setup XML Parser + StreamOrchestrator for MD file streaming
  const parser = new XMLStreamParser();
  const renderStrategy = new CommonRenderStrategy(
    chatAPI,
    state._bufferManager
  );
  
  const existingFiles = new Set(state.files?.map(f => f.path) || []);
  const orchestrator = new StreamOrchestrator({
    parser,
    renderStrategy,
    existingFiles,
  });
  
  // Collect LLM output
  let thinking = '';
  let textResponse = '';
  const toolCalls: Array<{
    id: string;
    name: string;
    args: Record<string, any>;
  }> = [];
  
  // ✅ Check if this is a continuation after tool calling
  const isAfterToolCall = state.conversationHistory && state.conversationHistory.length > 0;
  console.log(`[CodeGen] isAfterToolCall: ${isAfterToolCall}, enableThinking: ${!isAfterToolCall}`);
  
  try {
    // ✅ Single stream (no loop!)
    for await (const event of llmClient.stream(messages, {
      tools,
      maxTokens: 16000,
      enableThinking: !isAfterToolCall,  // ✅ Disable thinking after tool call
    })) {
      // ✅ Pass to orchestrator for XML parsing (MD file streaming)
      await orchestrator.processEvent(event);
      
      // Thinking (UI only - NOT included in conversation history!)
      if (event.type === 'thinking') {
        thinking += event.thinking || '';  // ✅ For UI display only
        // Don't send directly - orchestrator handles it
      }
      
      // Text
      if (event.type === 'text') {
        textResponse += event.text || '';  // ✅ NEW: text 필드 사용
        // Don't send directly - orchestrator handles it
      }
      
      // Tool call (감지만, 실행 안함!)
      if (event.type === 'tool_use' && event.toolUse) {
        const { id, name, input } = event.toolUse;
        
        console.log(`🔧 [CodeGen] Tool call detected: ${name}`);
        console.log(`   Args:`, JSON.stringify(input, null, 2));
        
        // 🎯 CRITICAL: Only send FIRST tool call to UI (Standard Tool Calling pattern)
        // Other tool calls are collected but not shown to user (they'll be dropped by tool node)
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
      
      // Done
      if (event.type === 'done') {
        await chatAPI.sendLLMEvent(event);
      }
    }
    
    // ✅ Finalize orchestrator (flush buffer)
    // Pass hasToolCalls flag to prevent premature message finalization
    const hasToolCalls = toolCalls.length > 0;
    await orchestrator.finalize(hasToolCalls);
    
    console.log(`\n✅ [CodeGen] Reasoning complete`);
    console.log(`   Thinking: ${thinking.length} chars`);
    console.log(`   Text: ${textResponse.length} chars`);
    console.log(`   Tool calls: ${toolCalls.length}`);
    
    // ✅ Workflow instrumentation: Exit node (success path)
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'codeGen');  // ✅ FIX: Must match graph.addNode() name!
    }
    
    // ✅ Return LLM response (state에 저장)
    // 🔴 FIX: done should be false if there are tool calls (LLM is NOT done yet!)
    return {
      llmResponse: {
        thinking,         // ✅ For UI display only (not in conversation history)
        textResponse,     // ✅ For conversation history (if no tool calls)
        toolCalls,        // ✅ For tool execution
        done: toolCalls.length === 0,  // ✅ Tool calls 없을 때만 done = true
      },
      _bufferManager: state._bufferManager,  // ✅ Preserve buffer manager
    };
  } catch (error) {
    console.error('❌ [CodeGen] Error during reasoning:', error);
    
    // ✅ Workflow instrumentation: Exit node (error path)
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'codeGen');  // ✅ FIX: Must match graph.addNode() name!
    }
    
    throw error;
  }
}

/**
 * Build messages for LLM using PromptEngine
 */
async function buildMessages(state: ArchitectGraphState): Promise<Array<{
  role: 'user' | 'assistant';
  content: string | any[];
}>> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string | any[] }> = [];
  
  // ✅ Use PromptEngine for system prompt (if no conversation history)
  if (!state.conversationHistory || state.conversationHistory.length === 0) {
    const promptEngine = state.deps?.promptEngine;
    
    if (!promptEngine) {
      throw new Error('[CodeGen] PromptEngine is required but not available in state.deps');
    }
    
    if (!state.currentTask) {
      throw new Error('[CodeGen] currentTask is required but not available in state');
    }
    
    // ✅ Build prompt using PromptEngine
    const promptResult = await promptEngine.buildExecutePrompt(
      'code',  // ✅ AgentTask type (not the task object!)
      state.context,
      {
        directive: state.directive,
        designDoc: state.design,  // Code job uses designDoc
        prdSpec: state.prd,
        originalFiles: state.codeHead,  // Git HEAD version
        currentCode: state.code,  // Working tree code
        currentTask: {
          name: state.currentTask.name,
          type: state.currentTask.type,
          description: state.currentTask.description,
        },
      },
      state.codeMode,
      state.currentTask.type  // taskType for language-specific constraints
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
    
    // ✅ CRITICAL: Add runtime context (plan, enforcement, file tree)
    // PromptEngine provides templates, buildRuntimeContext adds execution context
    const runtimeContext = buildRuntimeContext(state);
    
    // ✅ Merge: PromptEngine base + runtime context
    messages.push({
      role: 'user',
      content: `${basePrompt}\n\n${runtimeContext}`,
    });
  }
  
  // ✅ Add conversation history (if exists)
  if (state.conversationHistory && state.conversationHistory.length > 0) {
    messages.push(...state.conversationHistory);
  }
  
  return messages;
}

/**
 * Build runtime context (plan, enforcement, file tree, instructions)
 * 
 * This supplements PromptEngine's base prompt with execution-specific context:
 * - Current task and plan (from plan node)
 * - Enforcement feedback (from validation failures)
 * - File tree (current codebase state)
 * - Tool instructions
 */
function buildRuntimeContext(state: ArchitectGraphState): string {
  const lines: string[] = [];
  
  // ✅ 1. Current Task
  if (state.currentTask) {
    lines.push(`# Current Task`);
    lines.push(`**${state.currentTask.name}**`);
    lines.push(``);
    lines.push(state.currentTask.description);
    lines.push(``);
  }
  
  // ✅ 2. Execution Plan (from plan node)
  if (state.planText) {
    lines.push(`# Execution Plan`);
    lines.push(state.planText);
    lines.push(``);
  }
  
  // ✅ 3. Enforcement Feedback (retry context)
  if (state.enforcementReason) {
    lines.push(`# Previous Attempt Failed`);
    lines.push(state.enforcementReason);
    lines.push(``);
  }
  
  // ✅ 4. Codebase File Tree
  const fileTree = generateFileTree(state);
  if (fileTree) {
    lines.push(fileTree);
    lines.push(``);
  }
  
  // ✅ 5. Tool Usage Instructions
  lines.push(`# Available Tools`);
  lines.push(``);
  lines.push(`You have access to the following tools:`);
  lines.push(`- **write_file(path, content)**: Create or overwrite a file`);
  lines.push(`- **read_file(path)**: Read a file's contents`);
  lines.push(`- **list_files(directory?, pattern?)**: List files in a directory`);
  lines.push(`- **search_code(pattern, file_pattern?)**: Search codebase for patterns`);
  lines.push(`- **delete_file(path)**: Delete a file`);
  lines.push(`- **mkdir(path)**: Create a directory`);
  lines.push(`- **apply_patch(path, patch)**: Apply unified diff patch to a file`);
  lines.push(`- **run_command(command, working_directory?)**: Execute shell command`);
  lines.push(``);
  lines.push(`Use these tools to complete the task. When done, respond with "Task complete" without tool calls.`);
  lines.push(``);
  
  return lines.join('\n');
}


/**
 * Generate file tree for context
 */
function generateFileTree(state: ArchitectGraphState): string | null {
  const files = state.files?.map(f => f.path) || [];
  
  if (files.length === 0) {
    return null;
  }
  
  const lines = [
    '=== CODEBASE FILE TREE ===',
    '',
    `Total files: ${files.length}`,
    '',
    '**File Structure:**',
    '',
  ];
  
  // Group by directory
  const dirs: Record<string, string[]> = {};
  for (const file of files) {
    const parts = file.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
    const filename = parts[parts.length - 1];
    
    if (!dirs[dir]) {
      dirs[dir] = [];
    }
    dirs[dir].push(filename);
  }
  
  // Format tree
  for (const [dir, filenames] of Object.entries(dirs).sort()) {
    lines.push(`📁 ${dir}/`);
    for (const filename of filenames.sort()) {
      lines.push(`   📄 ${filename}`);
    }
    lines.push('');
  }
  
  lines.push('💡 **Tip:** Use `read_file(path)` to see file contents before modifying.');
  
  return lines.join('\n');
}

/**
 * Get available tools
 */
function getAvailableTools(): import('../../../../../core/ports/llm').ToolDefinition[] {
  // ✅ Return properly typed tool definitions
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
    {
      name: 'apply_patch',
      description: 'Apply a unified diff (patch) to a file. MORE EFFICIENT than write_file for modifying existing files',
      input_schema: {
        type: 'object' as const,
        properties: {
          path: {
            type: 'string',
            description: 'File path relative to project root',
          },
          patch: {
            type: 'string',
            description: 'Unified diff patch content (git diff format)',
          },
        },
        required: ['path', 'patch'],
      },
    },
    {
      name: 'run_command',
      description: 'Execute a shell command (npm install, build, test, etc.). CRITICAL for handling dependency errors',
      input_schema: {
        type: 'object' as const,
        properties: {
          command: {
            type: 'string',
            description: 'Shell command to execute (e.g., "npm install axios", "npm run build")',
          },
          working_directory: {
            type: 'string',
            description: 'Working directory (optional, defaults to project root)',
          },
        },
        required: ['command'],
      },
    },
  ];
}

