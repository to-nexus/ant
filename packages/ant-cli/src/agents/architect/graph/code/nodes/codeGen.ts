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
import { TokenBudgetManager } from '../../../../../core/utils/tokenBudget';
import { HistoryManager } from '../../../../../core/utils/historyManager';
import { ReferenceContext } from '../../../../../core/codebase/types';

/**
 * Filter reference contexts for current task
 * Only include references that are relevant to this specific task
 */
function filterReferencesForTask(
  allReferences: ReferenceContext[] | undefined,
  refsByTask: Map<string, Array<{project: string; branch?: string}>> | undefined,
  taskId: string
): ReferenceContext[] | undefined {
  if (!allReferences || !refsByTask) {
    return allReferences;  // No filtering needed
  }
  
  const taskRefs = refsByTask.get(taskId);
  if (!taskRefs || taskRefs.length === 0) {
    return undefined;  // This task doesn't need any references
  }
  
  // Filter references to only include those needed by this task
  const filtered = allReferences.filter(ref => {
    return taskRefs.some(taskRef => 
      taskRef.project === ref.project && 
      (!taskRef.branch || taskRef.branch === ref.branch)
    );
  });
  
  if (filtered.length > 0) {
    console.log(`   📚 Filtered ${filtered.length}/${allReferences.length} reference(s) for task ${taskId}`);
  }
  
  return filtered.length > 0 ? filtered : undefined;
}

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
  
  // ✅ Tool activation control
  // - Explain mode: NO tools (just explanation)
  // - Design job: NO tools (XML streaming)
  // - Code job (generate/refactor): YES tools
  const isExplainMode = state.codeMode === 'explain';
  const enableTools = state.codeMode !== undefined && !isExplainMode;
  const tools = enableTools ? getAvailableTools(state) : undefined;
  
  if (isExplainMode) {
    console.log(`💡 [CodeGen] Explain mode - tools disabled (explanation only)`);
  } else if (enableTools) {
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
    // ✅ Code job: Working dir = codebase, Buffer dir = features/{feature}/.buffers
    const featurePath = state.context?.featurePath;
    if (!featurePath || typeof featurePath !== 'string') {
      console.error('[CodeGen] featurePath not available or not a string:', featurePath);
      throw new Error('[CodeGen] featurePath is required for buffer initialization');
    }
    
    // Extract project root from featurePath
    // Example: workspaces/to.nexus/probe/ant-landing/features/skeleton
    // Project root: workspaces/to.nexus/probe/ant-landing
    const projectPath = featurePath.replace(/\/features\/[^/]+$/, '');
    
    // ✅ Validate projectPath
    if (!projectPath || projectPath === featurePath) {
      console.error('[CodeGen] Failed to extract project root from featurePath:', featurePath);
      throw new Error('[CodeGen] Invalid featurePath format');
    }
    
    const featureName = state.context.featureFolder || 'default';
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
    state._bufferManager,
    state.context.userLanguage  // ✅ Pass user language for localized messages
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
        
        // 🎯 CRITICAL: Only send FIRST tool call to UI (Standard Tool Calling pattern)
        // Other tool calls are collected but not shown to user (they'll be dropped by tool node)
        if (toolCalls.length === 0) {
          await chatAPI.sendLLMEvent(event);
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
    
    // ✅ Explain mode validation
    if (isExplainMode && toolCalls.length > 0) {
      console.error('⚠️  [CodeGen] Explain mode should NOT use tools!');
      console.error('   Tool calls detected:', toolCalls.map(t => t.name).join(', '));
      throw new Error('[CodeGen] Explain mode should not generate tool calls. Response must be pure text explanation.');
    }
    
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
    console.error('[ERROR] ❌ [CodeGen] Error during reasoning:');
    console.error('[ERROR] Error type:', error instanceof Error ? error.constructor.name : typeof error);
    console.error('[ERROR] Error message:', error instanceof Error ? error.message : String(error));
    console.error('[ERROR] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    if (error && typeof error === 'object') {
      console.error('[ERROR] Error details:', JSON.stringify(error, null, 2));
    }
    
    // ✅ Workflow instrumentation: Exit node (error path)
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'codeGen');  // ✅ FIX: Must match graph.addNode() name!
    }
    
    throw error;
  }
}

/**
 * Build messages for LLM using PromptEngine
 * 
 * ✅ NEW: Integrated token budget management and history pruning
 */
async function buildMessages(state: ArchitectGraphState): Promise<Array<{
  role: 'user' | 'assistant';
  content: string | any[];
}>> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string | any[] }> = [];
  
  // ✅ ALWAYS build fresh prompt with PromptEngine
  // This ensures task constraints are present in EVERY turn, not just the first
  const promptEngine = state.deps?.promptEngine;
  
  if (!promptEngine) {
    throw new Error('[CodeGen] PromptEngine is required but not available in state.deps');
  }
  
  if (!state.currentTask) {
    throw new Error('[CodeGen] currentTask is required but not available in state');
  }
  
  const promptResult = await promptEngine.buildExecutePrompt(
    'code',
    state.context,
    {
      directive: state.directive,
      designDoc: state.design,
      projectCodeContext: state.projectCodeContext,
      referenceCodeContexts: state.referenceCodeContexts,
      lessons: Array.isArray(state.lessons) ? state.lessons : undefined,
      sessionContext: state.sessionContext,
      referenceRequests: state.referenceRequests,
      currentTask: {
        name: state.currentTask.name,
        type: state.currentTask.type,
        priority: state.currentTask.priority,
        description: state.currentTask.description,
      },
    } as any,
    state.codeMode,
    state.currentTask.type
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
  
  // ✅ CRITICAL: Inject execution plan and enforcement feedback
  // These need to be HIGH PRIORITY, so we inject them strategically
  
  let finalPrompt = basePrompt;
  
  // Strategy 1: If we have execution plan, inject it RIGHT AFTER task description
  // This ensures LLM sees the plan immediately after reading the task
  if (state.planText && state.currentTask) {
    const taskMarker = `**Description**: ${state.currentTask.description}`;
    const taskMarkerIndex = finalPrompt.indexOf(taskMarker);
    
    if (taskMarkerIndex !== -1) {
      const injectionPoint = taskMarkerIndex + taskMarker.length;
      const planSection = `\n\n────────────────────────────────────────────────────────────────────────────────\n` +
        `# 📋 EXECUTION PLAN FOR THIS TASK\n` +
        `────────────────────────────────────────────────────────────────────────────────\n\n` +
        `${state.planText}\n`;
      
      finalPrompt = finalPrompt.slice(0, injectionPoint) + planSection + finalPrompt.slice(injectionPoint);
    }
  }
  
  // Strategy 2: If retry, inject enforcement feedback at the VERY TOP (highest priority)
  if (state.enforcementReason) {
    const enforcementHeader = `════════════════════════════════════════════════════════════════════════════════\n` +
      `⚠️  CRITICAL: PREVIOUS ATTEMPT FAILED - READ THIS FIRST!\n` +
      `════════════════════════════════════════════════════════════════════════════════\n\n` +
      `${state.enforcementReason}\n\n` +
      `YOU MUST FIX THE ABOVE ISSUE BEFORE PROCEEDING!\n` +
      `════════════════════════════════════════════════════════════════════════════════\n\n`;
    
    finalPrompt = enforcementHeader + finalPrompt;
  }
  
  // Strategy 3: Append file tree and other runtime context at the end
  const runtimeContext = buildRuntimeContext(state);
  
  const fullContent = `${finalPrompt}${runtimeContext ? '\n\n' + runtimeContext : ''}`;
  
  // ✅ First message: Always the full prompt
  messages.push({
    role: 'user',
    content: fullContent,
  });
  
  // ✅ Add conversation history (if exists)
  // CRITICAL: We need to handle Anthropic's tool calling format correctly
  // - Assistant messages contain tool_use blocks
  // - Following user messages contain tool_result blocks
  // - They must be paired correctly!
  if (state.conversationHistory && state.conversationHistory.length > 0) {
    // ✅ NEW: Prune history to prevent token overflow
    const tokenManager = new TokenBudgetManager();
    const historyManager = new HistoryManager(tokenManager);
    
    // Filter out initial user prompts (replaced by fresh prompt)
    let skipInitialUserMessages = true;
    const filteredHistory: typeof state.conversationHistory = [];
    
    for (const msg of state.conversationHistory) {
      // Once we see an assistant message, start including everything
      if (msg.role === 'assistant') {
        skipInitialUserMessages = false;
      }
      
      // Skip initial user prompts (they're replaced by our fresh prompt)
      // But keep user messages that follow assistant messages (tool results)
      if (skipInitialUserMessages && msg.role === 'user') {
        continue;
      }
      
      filteredHistory.push(msg);
    }
    
    // ✅ Prune filtered history to fit token budget
    const { prunedHistory } = historyManager.pruneHistory(filteredHistory);
    
    // Add pruned history to messages
    messages.push(...prunedHistory);
    
    // ✅ Check final token budget
    const estimation = tokenManager.checkBudget(messages);
    
    // 🚨 If still over budget, throw error (should not happen with proper pruning)
    if (estimation.isOverBudget) {
      throw new Error(
        `[CodeGen] Token budget exceeded after pruning! ` +
        `${estimation.totalTokens.toLocaleString()} tokens > ` +
        `${tokenManager['config'].maxTokens.toLocaleString()} limit. ` +
        `This should not happen - please report this bug.`
      );
    }
  } else {
    // No history - just check base prompt tokens
    const tokenManager = new TokenBudgetManager();
    tokenManager.checkBudget(messages);
  }
  
  return messages;
}

/**
 * Build runtime context (task, plan, enforcement, file tree)
 * 
 * CRITICAL: This is appended to EVERY user message, even during tool call loops!
 * This ensures task constraints (especially setup task restrictions) are always visible.
 */
function buildRuntimeContext(state: ArchitectGraphState): string {
  const lines: string[] = [];
  
  if (state.currentTask) {
    lines.push(`# Current Task`);
    lines.push(`**${state.currentTask.name}**`);
    lines.push(``);
    lines.push(state.currentTask.description);
    lines.push(``);
  }
  
  if (state.enforcementReason) {
    lines.push(`# Previous Attempt Failed`);
    lines.push(state.enforcementReason);
    lines.push(``);
  }
  
  const fileTree = generateFileTree(state);
  if (fileTree) {
    lines.push(fileTree);
    lines.push(``);
  }
  
  return lines.join('\n');
}


/**
 * Generate file tree for context
 * 
 * CRITICAL: This shows files that EXIST in the codebase.
 * LLM must check this before creating new files!
 */
function generateFileTree(state: ArchitectGraphState): string | null {
  const files = state.projectCodeContext?.filePaths || [];
  
  if (files.length === 0) {
    return null;
  }
  
  const lines = [
    '════════════════════════════════════════════════════════════════════════════════',
    '⚠️  EXISTING FILES IN CODEBASE (from RAG search)',
    '════════════════════════════════════════════════════════════════════════════════',
    '',
    `🚨 These ${files.length} files ALREADY EXIST. Do NOT recreate them!`,
    '',
    '**Existing File Structure:**',
    '',
  ];
  
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
      lines.push(`   ✅ ${filename} ← EXISTS`);
    }
    lines.push('');
  }
  
  lines.push('────────────────────────────────────────────────────────────────────────────────');
  lines.push('📌 BEFORE creating a file, check if it\'s listed above!');
  lines.push('   - If YES → use apply_patch or read_file + write_file to MODIFY');
  lines.push('   - If NO → you may create it with write_file');
  lines.push('────────────────────────────────────────────────────────────────────────────────');
  
  return lines.join('\n');
}

/**
 * Get available tools (filtered by state)
 */
function getAvailableTools(state: ArchitectGraphState): import('../../../../../core/ports/llm').ToolDefinition[] {
  const hasReferences = state.referenceRequests && state.referenceRequests.length > 0;
  
  // ✅ Return properly typed tool definitions
  const baseTools: import('../../../../../core/ports/llm').ToolDefinition[] = [
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
      description: `Execute a shell command for build/test/install. 
⚠️ FORBIDDEN commands (will fail): npm start, npm run dev, npm run serve, node server.js, nodemon - these are long-running servers.
✅ ALLOWED: npm install, npm run build, npm test, npx tsc --noEmit, npm run lint`,
      input_schema: {
        type: 'object' as const,
        properties: {
          command: {
            type: 'string',
            description: 'Shell command (ONLY: npm install, npm run build, npm test, npx tsc). NEVER use: npm start, npm run dev, node server.js',
          },
          working_directory: {
            type: 'string',
            description: 'Working directory (optional, defaults to project root)',
          },
        },
        required: ['command'],
      },
    }
  ];
  
  // ✅ Add search_reference_code tool ONLY if references are available
  if (hasReferences) {
    baseTools.push({
      name: 'search_reference_code',
      description: 'Search reference project using semantic search (vector DB). This is the ONLY way to access reference project code since you don\'t know the file paths. Describe what you need and relevant files will be returned with their content.',
      input_schema: {
        type: 'object' as const,
        properties: {
          project: {
            type: 'string',
            description: 'Reference project name (e.g., "ant-pong-be")',
          },
          query: {
            type: 'string',
            description: 'Detailed description of what code you need. Examples: "WebSocket gateway implementation and message handlers", "room management API endpoints and DTOs", "game state types and interfaces"',
          },
          maxFiles: {
            type: 'number',
            description: 'Maximum number of files to return (default: 5, max: 10)',
          },
        },
        required: ['project', 'query'],
      },
    });
  }
  
  return baseTools;
}

