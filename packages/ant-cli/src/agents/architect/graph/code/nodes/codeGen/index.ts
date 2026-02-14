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
 * 
 * ✅ MODULAR ARCHITECTURE:
 * - promptBuilder.ts: Message & context building
 * - toolDefinitions.ts: Available tools
 * - referenceFilter.ts: Reference context filtering
 */

import { ArchitectGraphState } from '../../state';
import { getChatAPIClient } from '../../../../../../core/adapters/ChatAPIClient';
import { StreamOrchestrator } from '../../../../../../core/streaming/StreamOrchestrator';
import { XMLStreamParser } from '../../../../../../core/streaming/parsers/XMLStreamParser';
import { CommonRenderStrategy } from '../../../../../../core/streaming/strategies/CommonRenderStrategy';

// Import submodules
import { buildMessages } from './promptBuilder';
import { getAvailableTools } from './toolDefinitions';
import { ArtifactService } from '../../../../../../infrastructure/workspace/ArtifactService';

export async function codeGen(
  state: ArchitectGraphState
): Promise<Partial<ArchitectGraphState>> {
  console.log('\n💭 [CodeGen] Starting reasoning...\n');
  
  // ✅ Increment recursion count (track every node execution)
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  const llmClient = state.deps?.llm;
  if (!llmClient) {
    throw new Error('LLM client not available');
  }
  
  // ✅ NEW: Use codeGen-specific model if configured
  let llmToUse = llmClient;
  if (state.workspaceConfig) {
    const { createLLMClient } = await import('../../../../../../periphery/adapters/llm/LLMClientFactory');
    
    llmToUse = createLLMClient(
      'architect',
      undefined,
      { jobType: 'code', nodeType: 'codeGen' },
      state.workspaceConfig
    );
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Guardrail: UI task requires UI-doc injection contract
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Principle:
  // - If the task is explicitly marked UI (from decompose), then the UI docs must be available for injection.
  // - If UI docs EXIST in inputs/sources but are missing/unloaded, we must FAIL FAST to avoid silent drift.
  // - If UI docs truly do NOT exist for this feature, do NOT fail: proceed with defaults derived from PRD/design.
  // - Use the existing self-healing path: fileErrors → checkTaskStatus → enforce → plan.
  if (state.currentTask?.ui === true) {
    const path = await import('path');

    const fileSystemRoot = (state.deps?.fileSystem as any)?.getWorkspaceRoot?.();
    const featurePathAbs = state.context.featurePath;
    const featurePathRel = (() => {
      if (!featurePathAbs) return undefined;
      if (fileSystemRoot && typeof fileSystemRoot === 'string') {
        return path.relative(fileSystemRoot, featurePathAbs);
      }
      // Worst-case: assume FileSystemPort root already equals featurePathAbs parent (cloud project root)
      return featurePathAbs.startsWith('/') ? featurePathAbs.slice(1) : featurePathAbs;
    })();

    // Detect whether UI docs exist (canonical only: inputs/sources/*).
    // This distinguishes:
    // - "Docs truly absent" (allowed)
    // - "Docs present but not injected/loaded" (bug; fail fast)
    const uiDocsExist = await (async () => {
      const fsPort = state.deps?.fileSystem as any;
      if (!fsPort || !featurePathRel) return false;
      const candidates = [
        'ui-spec.json',
        'ui-assets.json',
        'ui-tokens.json',
      ].map(name => path.join(featurePathRel, 'inputs', 'sources', name));
      for (const p of candidates) {
        try {
          if (await fsPort.fileExists(p)) return true;
        } catch {
          // ignore
        }
      }
      return false;
    })();

    // Best-effort: (re)load parsedUiDocs once, in case state was restored without it or inputs changed.
    // NOTE: This mutates state directly, which is an anti-pattern in LangGraph, but necessary here
    // because promptBuilder needs access to parsedUiDocs immediately. The proper fix would be
    // to pass parsedUiDocs as a separate parameter to buildMessages.
    if (!state.parsedUiDocs && state.deps?.git && state.deps?.fileSystem) {
      try {
        const parsed = await ArtifactService.loadParsedUiContext(state.context, state.deps.git, state.deps.fileSystem);
        if (parsed) {
          // Channel is now defined in graph.ts, so direct assignment is type-safe
          state.parsedUiDocs = parsed;
        }
      } catch {
        // ignore (we'll fail below if still missing)
      }
    }

    if (uiDocsExist && !state.parsedUiDocs) {
      const msg =
        `UI task requires UI specification docs to be loaded and injected, but none were available.\n` +
        `Docs appear to exist under inputs/sources, but UI-doc injection did not occur.\n` +
        `This would cause implementation drift (e.g., placeholders instead of mapped assets).\n` +
        `Fix: ensure inputs/sources documents are user-filled (not templates/comments-only) and that featurePath/workspace resolution is correct, then retry.`;
      return {
        ...state,
        fileErrors: [msg],
        llmResponse: { done: false, textResponse: '', thinking: '', toolCalls: [] }
      };
    }
  }

  // ✅ Build messages from conversation history + current task
  const messages = await buildMessages(state);
  
  // ✅ Tool activation control
  // - Explain mode: NO tools (just explanation)
  // - All other modes in code graph: YES tools (generate/refactor/unknown)
  // 
  // ⚠️ DEFENSIVE: Default to tools ENABLED in code graph.
  // Previously, tools were disabled when detectionReport.jobMode was undefined,
  // causing LLM to output <function_calls><invoke> XML as text instead of
  // using structured tool_use blocks. This happened when detectionReport was
  // not properly restored on resume.
  const isExplainMode = state.detectionReport?.jobMode === 'explain';
  const enableTools = !isExplainMode;
  const tools = enableTools ? await getAvailableTools(state) : undefined;
  
  if (!state.detectionReport?.jobMode) {
    console.warn(`⚠️ [CodeGen] detectionReport.jobMode is missing — defaulting to tools enabled`);
  }
  
  if (isExplainMode) {
    console.log(`💡 [CodeGen] Explain mode - tools disabled (explanation only)`);
  } else {
    console.log(`🔧 [CodeGen] Tool calling enabled (code job, mode=${state.detectionReport?.jobMode || 'unknown'})`);
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
      (state as any).workerId ?? 0,
      taskInfo, 
      undefined, // llmInfo
      state.recursionCount,
      state.recursionLimit
    );
  }
  
  // ✅ UI streaming
  const chatAPI = getChatAPIClient();
  await chatAPI.showChatStatus('placeholder');
  
  // ✅ Code jobs must write into repoRoot (codebase directory)
  const repoRootForWrites = state.deps?.git ? await state.deps.git.getRepoRoot() : undefined;

  // ✅ Setup XML Parser + StreamOrchestrator for MD file streaming
  const parser = new XMLStreamParser();
  const renderStrategy = new CommonRenderStrategy(
    chatAPI,
    state.context.userLanguage,  // ✅ Pass user language for localized messages
    state.deps?.git,  // ✅ Pass gitPort for actual file editing
    state.deps?.fileSystem,  // ✅ Pass fileSystem for file operations
    true,  // ✅ writeImmediately: true for code job (no separate writeFiles node)
    'code',  // ✅ jobType: 'code' (no LAST_SECTION handling needed)
    undefined,  // ✅ Code job: no featurePath
    repoRootForWrites,  // ✅ Code job: write files under repoRoot (codebase)
    state.deps?.fileTreeUpdate  // ✅ For real-time file tree updates via Redis Pub/Sub
  );
  
  // ✅ Code job: Build existingFiles from projectCodeContext + referenceCodeContexts
  // These contain the actual codebase files loaded by the plan node
  // This prevents LLM from accidentally using <file> on existing files
  const existingFiles = new Set<string>();
  
  // ✅ CRITICAL: Use filePaths instead of files array
  // - files array may be empty (content not saved to session for memory optimization)
  // - filePaths array always contains the list of known files
  if (state.projectCodeContext?.filePaths) {
    for (const filePath of state.projectCodeContext.filePaths) {
      if (filePath) {
        existingFiles.add(filePath);
      }
    }
  }
  
  // ✅ FALLBACK: Also add files from files array if available
  if (state.projectCodeContext?.files) {
    for (const file of state.projectCodeContext.files) {
      if (file.path) {
        existingFiles.add(file.path);
      }
    }
  }
  
  // Add files from referenceCodeContexts
  if (state.referenceCodeContexts) {
    for (const refContext of state.referenceCodeContexts) {
      if (refContext?.files) {
        for (const file of refContext.files) {
          if (file.path) {
            existingFiles.add(file.path);
          }
        }
      }
    }
  }
  
  // existingFiles Set initialized (prevents duplicate file creation)
  
  const orchestrator = new StreamOrchestrator({
    parser,
    renderStrategy,
    existingFiles
  });
  
  // Collect LLM output
  let thinking = '';
  let textResponse = '';
  let isDone = false;  // ✅ Track done event (don't propagate immediately)
  const toolCalls: Array<{
    id: string;
    name: string;
    args: Record<string, any>;
  }> = [];
  
  // ✅ Check if this is a continuation after tool calling
  const isAfterToolCall = state.conversationHistory && state.conversationHistory.length > 0;
  
  // ✅ Track token usage for this LLM call
  let capturedUsage: any = undefined;
  
  try {
    // ✅ Single stream (no loop!)
    for await (const event of llmToUse.stream(messages, {
      tools,
      maxTokens: 16000,
      enableThinking: !isAfterToolCall,
    })) {
      await orchestrator.processEvent(event);
      
      if (event.type === 'thinking') {
        thinking += event.thinking || '';
      }
      
      if (event.type === 'text') {
        textResponse += event.text || '';
      }
      
      if (event.type === 'tool_use' && event.toolUse) {
        const { id, name, input } = event.toolUse;
        
        if (toolCalls.length === 0) {
          await chatAPI.sendLLMEvent(event);
        }
        
        toolCalls.push({ id, name, args: input });
      }
      
      if (event.type === 'done') {
        isDone = true;
        
        // ✅ Extract token usage and accumulate to task-level
        const { extractTokenUsageFromStreamEvent, accumulateTokenUsage } = await import('../../../../../common/graph/llmHelpers');
        capturedUsage = extractTokenUsageFromStreamEvent(event);
        if (capturedUsage) {
          accumulateTokenUsage(state as any, capturedUsage, { taskLevel: true, jobLevel: true });
        }
      }
    }
    
    // Wait for all file operations to complete BEFORE finalizing
    try {
      await orchestrator.waitForAllFileOperations();
    } catch (fileError) {
      // Do NOT throw! Let validation handle it
      const errorMsg = fileError instanceof Error ? fileError.message : String(fileError);
      console.error(`⚠️ [CodeGen] File operation failed: ${errorMsg}`);
    }
    
    // Propagate done event (files are guaranteed to be saved OR errors recorded)
    if (isDone) {
      await chatAPI.sendLLMEvent({ type: 'done' });
    }
    
    // ✅ Finalize orchestrator (flush buffer)
    // Pass hasToolCalls flag to prevent premature message finalization
    const hasToolCalls = toolCalls.length > 0;
    const finalizeResult = await orchestrator.finalize(hasToolCalls);
    
    // ✅ CRITICAL: Extract file errors from finalize result for self-healing
    const fileErrors = finalizeResult.fileErrors || [];
    if (fileErrors.length > 0) {
      console.error(`⚠️  [CodeGen] ${fileErrors.length} file error(s) detected for self-healing`);
      for (const error of fileErrors) {
        console.error(`   - ${error}`);
      }
    }
    
    // ✅ CRITICAL: Extract files from FileRegistry for state.files
    const files: Array<{ path: string; content: string; actionType: 'create' | 'edit' | 'append' | 'delete' }> = [];
    if (finalizeResult?.streamedFiles) {
      for (const filePath of finalizeResult.streamedFiles) {
        // Try to get file info from registry (has actionType)
        const fileInfo = (orchestrator as any).registry?.getFileInfo?.(filePath);
        if (fileInfo) {
          files.push({
            path: filePath,
            content: fileInfo.contentBuffer || '',
            actionType: fileInfo.actionType as any
          });
        }
      }
    }
    // Finalize chat message if no tool calls (task/reasoning complete)
    if (toolCalls.length === 0) {
      const chatAPI = getChatAPIClient();
      await chatAPI.finalizeMessage();
    }
    
    console.log(`✅ [CodeGen] Complete: ${toolCalls.length} tools, ${files.length} files${capturedUsage ? `, ${capturedUsage.totalTokens} tokens` : ''}`);

    
    // ✅ Explain mode validation
    if (isExplainMode && toolCalls.length > 0) {
      console.error('⚠️  [CodeGen] Explain mode should NOT use tools!');
      console.error('   Tool calls detected:', toolCalls.map(t => t.name).join(', '));
      throw new Error('[CodeGen] Explain mode should not generate tool calls. Response must be pure text explanation.');
    }
    
    // ✅ Workflow instrumentation: Exit node (success path)
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'codeGen', (state as any).workerId ?? 0);
    }
    
    // ✅ Return LLM response (state에 저장)
    
    // ✅ CRITICAL: Accumulate created/modified files to projectCodeContext
    // This ensures subsequent codeGen turns know about files created in this session
    // Without this, existingFiles Set is empty on each turn, causing:
    // - Duplicate file creation (Hero.tsx AND HeroSection.tsx for same component)
    // - LLM not recognizing files it created in previous turns
    const newFilePaths = files
      .filter(f => f.actionType === 'create' || f.actionType === 'edit')
      .map(f => f.path);
    
    let updatedProjectCodeContext = state.projectCodeContext;
    
    if (newFilePaths.length > 0) {
      const existingPaths = state.projectCodeContext?.filePaths || [];
      const combinedPaths = Array.from(new Set([...existingPaths, ...newFilePaths]));
      
      updatedProjectCodeContext = state.projectCodeContext ? {
        ...state.projectCodeContext,
        filePaths: combinedPaths
      } : {
        source: 'codeGen' as const,
        filePaths: combinedPaths,
        files: [],
        stats: { filesLoaded: combinedPaths.length, estimatedTokens: 0 }
      };
      
    }
    
    // ✅ CRITICAL: Only mark done if LLM explicitly output <done>true</done>
    // Use explicitDone from streaming pipeline (detected by SpecialTagTransformer)
    // Previously: done = toolCalls.length === 0 (caused premature completion on truncated responses)
    const explicitDone = finalizeResult.explicitDone || false;
    
    if (toolCalls.length === 0 && !explicitDone) {
      console.warn(`⚠️  [CodeGen] No tool calls and no <done>true</done> tag - LLM response may be incomplete`);
    }
    
    return {
      llmResponse: {
        thinking,
        textResponse,
        toolCalls,
        done: explicitDone,  // ✅ Only done when LLM explicitly says so
        tokenUsage: capturedUsage,
      },
      fileErrors: fileErrors.length > 0 ? fileErrors : undefined,
      projectCodeContext: updatedProjectCodeContext,  // ✅ Propagate to next codeGen turn
      recursionCount: state.recursionCount,   // ✅ FIX: Propagate to LangGraph channel (Partial return requires explicit inclusion)
      recursionLimit: state.recursionLimit,   // ✅ FIX: Propagate to LangGraph channel
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
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'codeGen', (state as any).workerId ?? 0);
    }
    
    throw error;
  }
}

