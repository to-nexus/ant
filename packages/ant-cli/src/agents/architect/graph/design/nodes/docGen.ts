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
 * ✅ NEW: UI Design 모드 지원 (designWorkType === 'ui-design')
 *     - 멀티모달 이미지 분석 (레퍼런스 스크린샷)
 *     - tokens.md, ui-assets.md, ui-spec.md 생성
 */

import { DesignGraphState } from '../state';
import { getChatAPIClient } from '../../../../../core/adapters/ChatAPIClient';
import { StreamOrchestrator } from '../../../../../core/streaming/StreamOrchestrator';
import { XMLStreamParser } from '../../../../../core/streaming/parsers/XMLStreamParser';
import { CommonRenderStrategy } from '../../../../../core/streaming/strategies/CommonRenderStrategy';
import { TokenBudgetManager } from '../../../../../core/utils/tokenBudget';
import { HistoryManager } from '../../../../../core/utils/historyManager';
import { CacheableContent } from '../../../../../core/ports/llm';
import { getToolsByNames, TOOL_SETS } from '../../../tools/definitions';

export async function docGen(
  state: DesignGraphState
): Promise<Partial<DesignGraphState>> {
  console.log('\n📝 [DocGen] Starting document generation...\n');
  
  const llmClient = state.deps?.llm;
  const gitPort = state.deps?.git;
  if (!llmClient || !gitPort) {
    throw new Error('LLM client or GitPort not available');
  }
  
  // ✅ Build messages based on work type
  const isUiDesign = state.designWorkType === 'ui-design';
  const messages = isUiDesign 
    ? await buildUiDesignMessages(state)
    : await buildMessages(state);
  
  // ✅ Tool activation: Select appropriate tool set based on work type
  const tools = isUiDesign
    ? getToolsByNames(TOOL_SETS.uiDesign)
    : getToolsByNames(TOOL_SETS.design);
  
  console.log(`📝 [DocGen] ${isUiDesign ? 'UI Design' : 'System Design'} mode - ${tools.length} tools available`);
  
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
    state.context.userLanguage,  // ✅ Pass user language for localized messages
    state.deps?.git,  // ✅ Pass gitPort for immediate file writes
    state.deps?.fileSystem,  // ✅ Pass fileSystem for file operations
    true,  // ✅ writeImmediately: true (design job now writes files immediately like code job)
    'design',  // ✅ jobType: 'design' (for LAST_SECTION metadata handling)
    state.context.featurePath  // ✅ Feature path for absolute path resolution
  );
  
  // ✅ Design job: Check actual disk files, not state.files (which accumulates across tasks)
  // state.files tracks files generated in THIS job session, but existingFiles should reflect disk reality
  // - UI Design: inputs/sources/ (tokens.md, ui-assets.md, ui-spec.md)
  // - System Design: outputs/design/ (system-design.md, etc.)
  const existingFiles = new Set<string>();
  if (state.deps?.fileSystem && state.context.featurePath) {
    const path = await import('path');
    
    // Determine target directory based on work type
    const targetDir = isUiDesign ? 'inputs/sources' : 'outputs/design';
    const designDirAbs = path.join(state.context.featurePath, targetDir);
    
    // ✅ Convert to workspace-relative path for fileSystem port
    const workspaceRoot = state.deps.fileSystem.getWorkspaceRoot?.() || '';
    const designDirRel = workspaceRoot
      ? path.relative(workspaceRoot, designDirAbs)
      : designDirAbs.replace(/^\//, '');
    
    try {
      // Check if directory exists using workspace-relative path
      const dirExists = await state.deps.fileSystem.fileExists(designDirRel);
      if (dirExists) {
        // Read directory contents using workspace-relative path
        const entries = await state.deps.fileSystem.readDirectory(designDirRel);
        
        // Add all .md files to existingFiles (relative to feature path)
        for (const entry of entries) {
          if (!entry.isDirectory && entry.name.endsWith('.md')) {
            const relativePath = `${targetDir}/${entry.name}`;
            existingFiles.add(relativePath);
          }
        }
        
        console.log(`📋 [DocGen] Existing files on disk: ${existingFiles.size > 0 ? Array.from(existingFiles).join(', ') : 'none'}`);
      } else {
        console.log(`📋 [DocGen] ${targetDir} directory does not exist yet (first task)`);
      }
    } catch (error) {
      console.warn(`⚠️  [DocGen] Failed to scan ${targetDir} directory:`, error);
      // Continue with empty existingFiles set
    }
  }
  
  const orchestrator = new StreamOrchestrator({
    parser,
    renderStrategy,
    existingFiles,
  });
  
  // ✅ 6. Collect LLM output
  let thinking = '';
  let textResponse = '';
  let capturedUsage: any = undefined;
  
  // ✅ Calculate maxTokens based on task line budget
  let maxTokens = 16000;
  
  if (state.currentTask?.description) {
    const lineMatch = state.currentTask.description.match(/MAX (\d+) lines/i);
    if (lineMatch) {
      const maxLines = parseInt(lineMatch[1]);
      // Estimate: ~12 tokens per line (average for Markdown with formatting)
      // Add 3000 tokens buffer for XML tags, metadata, and thinking
      const estimatedTokens = maxLines * 12 + 3000;
      
      // ✅ Smart minimum based on complexity
      const minTokens = maxLines <= 150 ? 16000 : 20000;
      maxTokens = Math.max(minTokens, estimatedTokens);
      
      console.log(`📏 [DocGen] Task line budget: ${maxLines} lines → maxTokens: ${maxTokens} (min: ${minTokens})`);
    }
  }
  
  // ✅ Track tool calls for routing decision
  let pendingToolCalls: Array<{ id: string; name: string; args: any }> = [];
  
  // ✅ Check if this is a continuation after tool calling (Code job pattern)
  const isAfterToolCall = state.conversationHistory && state.conversationHistory.length > 0;
  
  try {
    // ✅ Stream with XML parsing + tool calling support
    // ✅ CRITICAL: Disable thinking after tool calls (Anthropic API requirement)
    // When thinking is enabled, assistant messages must start with thinking block.
    // After tool calls, the history contains tool_use without thinking, causing errors.
    for await (const event of llmClient.stream(messages, {
      tools: tools.length > 0 ? tools : undefined,  // ✅ Tool calling for UI Design
      maxTokens,  // ✅ Dynamic based on line budget (minimum 16000 to support thinking)
      enableThinking: !isAfterToolCall,  // ✅ Disable after tool calls (Code job pattern)
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
      
      // ✅ Tool Use - capture for routing
      // NOTE: Anthropic LLM client yields { type: 'tool_use', toolUse: { id, name, input } }
      if (event.type === 'tool_use') {
        const toolEvent = event as { 
          type: 'tool_use'; 
          toolUse: { id: string; name: string; input: Record<string, any> };
        };
        if (toolEvent.toolUse) {
          pendingToolCalls.push({
            id: toolEvent.toolUse.id,
            name: toolEvent.toolUse.name,
            args: toolEvent.toolUse.input,
          });
          console.log(`🔧 [DocGen] Tool call detected: ${toolEvent.toolUse.name}`);
        } else {
          console.warn(`⚠️  [DocGen] tool_use event missing toolUse property:`, JSON.stringify(event));
        }
      }
      
      if (event.type === 'done') {
        // ✅ Extract token usage
        const { extractTokenUsageFromStreamEvent } = await import('../../common/llmHelpers');
        capturedUsage = extractTokenUsageFromStreamEvent(event);
        
        await chatAPI.sendLLMEvent(event);
      }
    }
    
    // ✅ Finalize orchestrator (flush buffer and save files)
    const hasToolCalls = pendingToolCalls.length > 0;
    await orchestrator.finalize(hasToolCalls);  // Don't flush if tool calls pending
    
    // ✅ Get generated files from registry (in-memory tracking)
    const registry = orchestrator.getRegistry();
    const files = registry.getAllFiles();
    
    console.log(`\n✅ [DocGen] XML streaming complete (${files.length} files generated, ${pendingToolCalls.length} tool calls pending)`);
    
    // ✅ Build conversation history for resume
    // CRITICAL: Must preserve messages for proper resume after interruption
    let conversationHistory: Array<{ role: 'user' | 'assistant'; content: string | any[] }>;
    
    if (state.conversationHistory && state.conversationHistory.length > 0) {
      // ✅ Tool loop: Extend existing history
      conversationHistory = [...state.conversationHistory];
    } else {
      // ✅ Fresh start: Build from messages
      conversationHistory = [];
      for (const msg of messages) {
        conversationHistory.push({
          role: msg.role,
          content: msg.content
        });
      }
    }
    
    // ✅ Add assistant's response (text only, NOT tool calls)
    // CRITICAL: Follow Code job pattern - tool_use is added by tool.ts, not here!
    // If we add tool_use here, tool.ts must provide ALL matching tool_results.
    // Instead, only add text response here; tool.ts handles tool_use + tool_result pair.
    if (!hasToolCalls) {
      // Regular text response (no tool calls)
      conversationHistory.push({
        role: 'assistant',
        content: textResponse
      });
    }
    // NOTE: When hasToolCalls=true, don't add to history here.
    // tool.ts will add the complete tool_use + tool_result sequence.
    
    console.log(`📝 [DocGen] Conversation history updated (${conversationHistory.length} messages)`);
    
    // ✅ Accumulate token usage to state
    if (capturedUsage) {
      const { accumulateTokenUsage } = await import('../../common/llmHelpers');
      accumulateTokenUsage(state as any, capturedUsage, { taskLevel: true, jobLevel: true });
      
      console.log(`   Tokens: ${capturedUsage.totalTokens} total (${capturedUsage.inputTokens} in, ${capturedUsage.outputTokens} out)`);
      if (capturedUsage.cacheReadTokens) {
        console.log(`   Cache read: ${capturedUsage.cacheReadTokens} tokens`);
      }
      if (capturedUsage.cacheCreationTokens) {
        console.log(`   Cache creation: ${capturedUsage.cacheCreationTokens} tokens`);
      }
    }
    
    return {
      files,
      conversationHistory,
      // ✅ NEW: Return tool calls for routing decision
      llmResponse: hasToolCalls ? {
        toolCalls: pendingToolCalls,
        textResponse,
        done: false,  // Not done yet - tool execution pending
      } : {
        textResponse,
        done: true,  // Completed
      },
    };
  } catch (error) {
    console.error('❌ [DocGen] Error during reasoning:', error);
    throw error;
  }
}

/**
 * Build messages for LLM using PromptEngine with Prompt Caching
 * 
 * ✅ NEW: UI Docs mode support
 * - designWorkType === 'ui-design': Uses multimodal messages with reference images
 * - Generates tokens.md, ui-assets.md, ui-spec.md
 */
async function buildMessages(state: DesignGraphState): Promise<Array<{
  role: 'user' | 'assistant';
  content: CacheableContent[];
}>> {
  const messages: Array<{ role: 'user' | 'assistant'; content: CacheableContent[] }> = [];
  
  // NOTE: UI Design mode is handled separately in docGen() entry point
  // This function handles system-design messages only
  
  // ✅ Use PromptEngine for system prompt (if no conversation history)
  if (!state.conversationHistory || state.conversationHistory.length === 0) {
    console.log(`📄 [DocGen] Building fresh prompt (no conversation history)`);
    const promptEngine = state.deps?.promptEngine;
    
    if (!promptEngine) {
      throw new Error('[DocGen] PromptEngine is required but not available in state.deps');
    }
    
    if (!state.currentTask) {
      throw new Error('[DocGen] currentTask is required but not available in state');
    }
    // ✅ Load existing design document's last section number
    let lastSectionNumber = 0;
    
    const targetFile = state.currentTask.targetFile || 'system-design.md';
    console.log(`📄 [DocGen] Target file: ${targetFile}`);
    
    try {
      // ✅ FIX: Convert absolute path to workspace-relative path for FileSystemPort
      // FileSystemPort expects relative paths - absolute paths cause path resolution issues
      const pathModule = await import('path');
      let designDocPath = `${state.context.featurePath}/outputs/design/${targetFile}`;
      
      if (state.deps?.fileSystem) {
        const workspaceRoot = state.deps.fileSystem.getWorkspaceRoot?.();
        if (workspaceRoot && pathModule.isAbsolute(designDocPath)) {
          designDocPath = pathModule.relative(workspaceRoot, designDocPath);
        }
        
        const fileExists = await state.deps.fileSystem.fileExists(designDocPath);
        if (fileExists) {
          const fullContent = await state.deps.fileSystem.readFile(designDocPath) || '';
          if (fullContent) {
            const lastLine = fullContent.trim().split('\n').pop() || '';
            const metadataMatch = lastLine.match(/<!-- LAST_SECTION: (\d+) -->/);
            
            if (metadataMatch) {
              lastSectionNumber = parseInt(metadataMatch[1]);
              console.log(`📄 [DocGen] Found last section: ${lastSectionNumber} (from metadata)`);
            } else {
              const sectionMatches = fullContent.match(/^## (\d+)\./gm);
              if (sectionMatches) {
                const numbers = sectionMatches.map((m: string) => parseInt(m.match(/\d+/)?.[0] || '0'));
                lastSectionNumber = Math.max(...numbers);
                console.log(`📄 [DocGen] Found last section: ${lastSectionNumber} (from scanning)`);
              }
            }
          }
        } else {
          console.log(`📄 [DocGen] ${targetFile} does not exist yet (first task)`);
        }
      }
    } catch (error) {
      console.error(`[DocGen] Error reading design document:`, error);
    }
    
    // ✅ CRITICAL: Load api-contract.md if generating fe/be-system-design
    let apiContractContent: string | undefined;
    const isImplementationDesign = targetFile === 'fe-system-design.md' || targetFile === 'be-system-design.md';
    
    if (isImplementationDesign) {
      try {
        const featurePath = state.context.featurePath;
        if (featurePath) {
          const path = await import('path');
          const apiContractPath = path.join(featurePath, 'outputs/design/api-contract.md');
          const fs = await import('fs/promises');
          try {
            apiContractContent = await fs.readFile(apiContractPath, 'utf-8');
            console.log(`📋 [DocGen] Loaded api-contract.md from disk (${apiContractContent.length} chars)`);
          } catch {
            console.log(`ℹ️  [DocGen] No api-contract.md found (may not be needed)`);
          }
        }
      } catch (error) {
        console.warn(`⚠️  [DocGen] Failed to load api-contract.md:`, error);
      }
    }
    
    const promptResult = await promptEngine.buildExecutePrompt(
      'design',
      state.context,
      {
        directive: state.directive || state.spec,
        designDoc: apiContractContent,
        lastSectionNumber,
        previousDesign: state.design,
        prdSpec: state.prd,
        currentCode: state.code,
        designDomain: state.designDomain,
        currentTask: {
          name: state.currentTask.name,
          type: state.currentTask.type,
          priority: state.currentTask.priority,
          description: state.currentTask.description,
          ...(state.currentTask.targetFile && { targetFile: state.currentTask.targetFile }),
        },
      },
      undefined,
      undefined
    );
    
    // ✅ Extract composed sections for granular caching
    const composed = promptResult.composed;
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Block 1: System Prompt + Rules (CACHED - static)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const systemPromptParts = [
      composed.system,
      composed.profiles,
      composed.rules,
      composed.examples
    ].filter(Boolean);
    
    const systemPromptBlock: CacheableContent = {
      type: 'text',
      text: systemPromptParts.join('\n\n'),
      cache_control: { type: 'ephemeral' }
    };
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Block 2: Context (CACHED - changes per task)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const contextParts = [
      composed.injections,
      state.prd ? `# Requirements\n\n${state.prd}` : null,
      apiContractContent ? `# API Contract\n\n${apiContractContent}` : null,
    ].filter(Boolean);
    
    const contextBlock: CacheableContent = {
      type: 'text',
      text: contextParts.join('\n\n'),
      cache_control: { type: 'ephemeral' }
    };
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Block 3: Runtime Context (NOT CACHED - changes frequently)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const runtimeContext = buildRuntimeContext(state);
    
    const runtimeBlock: CacheableContent = {
      type: 'text',
      text: runtimeContext
      // No cache_control - changes every turn
    };
    
    // ✅ Validate: Ensure XML output format instructions are present
    const allContent = [systemPromptParts.join(''), contextParts.join(''), runtimeContext].join('');
    const hasMarkdownFormat = allContent.includes('<file path=') || allContent.includes('Markdown File Output Format');
    
    if (!hasMarkdownFormat) {
      console.warn(`⚠️  WARNING: Markdown output format NOT found in prompt! (length: ${allContent.length} chars)`);
    }
    
    messages.push({
      role: 'user',
      content: [systemPromptBlock, contextBlock, runtimeBlock]
    });
  }
  
  // ✅ Add conversation history (if exists)
  if (state.conversationHistory && state.conversationHistory.length > 0) {
    console.log(`📄 [DocGen] Using existing conversation history (${state.conversationHistory.length} messages)`);
    
    const tokenManager = new TokenBudgetManager();
    const historyManager = new HistoryManager(tokenManager);
    
    const { prunedHistory } = historyManager.pruneHistory(state.conversationHistory);
    
    // Convert history to CacheableContent format
    for (const msg of prunedHistory) {
      if (typeof msg.content === 'string') {
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: [{
            type: 'text',
            text: msg.content
          }]
        });
      } else {
        // Already in array format (tool results)
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content
        });
      }
    }
    
    const estimation = tokenManager.checkBudget(messages as any);
    
    if (estimation.isOverBudget) {
      throw new Error(
        `[DocGen] Token budget exceeded after pruning! ` +
        `${estimation.totalTokens.toLocaleString()} tokens > ` +
        `${tokenManager['config'].maxTokens.toLocaleString()} limit.`
      );
    }
  } else {
    const tokenManager = new TokenBudgetManager();
    tokenManager.checkBudget(messages as any);
  }
  
  return messages;
}

/**
 * Build runtime context (task, directive, existing design)
 * 
 * This supplements PromptEngine's base prompt with execution-specific context:
 * - Current task and directive
 * - Existing design (for continuation)
 * 
 * Note: Output format instructions are in PromptEngine templates
 */
function buildRuntimeContext(state: DesignGraphState): string {
  const task = state.currentTask;
  const lines: string[] = [];
  
  // ✅ 1. Target File (CRITICAL for CONTRACT-FIRST design)
  if (task?.targetFile) {
    lines.push(`# Target Document`);
    lines.push(`Write to: \`outputs/design/${task.targetFile}\``);
    lines.push('');
    lines.push(`⚠️ CRITICAL: You MUST write to this file in your XML output!`);
    lines.push(`Use: <file path="outputs/design/${task.targetFile}">...</file>`);
    lines.push('');
  }
  
  // ✅ 2. Current Task
  if (task) {
    lines.push(`# Current Task`);
    lines.push(`**${task.name}**`);
    lines.push(task.description);
    lines.push('');
  }
  
  // ✅ 3. Directive (user requirements)
  if (state.directive || state.spec) {
    lines.push(`# Directive`);
    lines.push(state.directive || state.spec);
    lines.push('');
  }
  
  // ✅ 4. Existing Design Document (ONLY for evolution/refactor modes)
  // - greenfield: NO document needed (lastSectionNumber is sufficient for sequential chapter generation)
  // - evolution/refactor: FULL document needed (LLM must understand structure to modify specific sections)
  if (state.designMode === 'evolution' || state.designMode === 'refactor') {
    if (state.design) {
      lines.push(`# Existing Design Document`);
      lines.push(state.design);
      lines.push('');
    }
  }
  // ❌ For greenfield mode: DO NOT include state.design
  // Reason: Including old document content causes LLM confusion with outdated metadata
  // The lastSectionNumber in the base prompt is sufficient for sequential chapter numbering
  
  return lines.join('\n');
}

/**
 * Build multimodal messages for UI Design generation
 * 
 * TOOLING-BASED APPROACH:
 * - Images are NOT preloaded (avoids token explosion)
 * - LLM uses tools to selectively load images when needed:
 *   - list_reference_images: Discover available screenshots
 *   - read_reference_image: Load specific image for analysis
 *   - list_assets: List asset files for mapping
 * 
 * This approach:
 * - Saves tokens (only loads needed images)
 * - Allows LLM to analyze images one at a time
 * - Scales to any number of reference images
 */
async function buildUiDesignMessages(state: DesignGraphState): Promise<Array<{
  role: 'user' | 'assistant';
  content: CacheableContent[];
}>> {
  const task = state.currentTask;
  
  // ✅ CRITICAL: If conversation history exists, build fresh prompt + append history
  // This prevents infinite loops by preserving tool call/result context
  // ✅ Check if this is a continuation after tool calling
  const conversationHistory = state.conversationHistory || [];
  const isAfterToolCall = conversationHistory.length > 0;
  
  if (isAfterToolCall) {
    console.log(`🎨 [DocGen] UI Design continuing with existing conversation (${conversationHistory.length} messages)`);
    
    // ✅ Code job pattern: Build fresh prompt + append history (skip initial user messages)
    // This ensures proper message structure for Anthropic API
    const messages: Array<{ role: 'user' | 'assistant'; content: CacheableContent[] }> = [];
    
    // 1. Build fresh user prompt (always needed as first message)
    const freshPrompt = await buildUiDesignFreshPrompt(state);
    messages.push({
      role: 'user',
      content: freshPrompt
    });
    
    // 2. Append history (skip initial user messages - replaced by fresh prompt)
    let skipInitialUserMessages = true;
    for (const msg of conversationHistory) {
      if (msg.role === 'assistant') {
        skipInitialUserMessages = false;
      }
      
      if (skipInitialUserMessages && msg.role === 'user') {
        continue;
      }
      
      // ✅ Convert to CacheableContent format
      if (typeof msg.content === 'string') {
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: [{ type: 'text', text: msg.content }]
        });
      } else {
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content as CacheableContent[]
        });
      }
    }
    
    return messages;
  }
  
  console.log(`🎨 [DocGen] Building UI Design prompt for task: ${task?.id} (tool-based multimodal)`);
  
  const content: CacheableContent[] = [];
  
  // ✅ 1. System Prompt - UI Design Generation Instructions
  const systemPrompt = await buildUiDesignSystemPrompt(state);
  content.push({
    type: 'text',
    text: systemPrompt,
    cache_control: { type: 'ephemeral' }
  });
  
  // ✅ 2. Available Resources Summary (text only - no images preloaded)
  let resourcesSummary = '\n\n# Available Resources\n\n';
  resourcesSummary += '## Reference Screenshots\n';
  resourcesSummary += 'Use `list_reference_images` tool to discover available screenshots, then use `read_reference_image` to load and analyze specific images.\n\n';
  
  if (state.uiReferences?.screens?.length) {
    resourcesSummary += `- **Screens**: ${state.uiReferences.screens.length} screenshots available\n`;
    resourcesSummary += `  (Examples: ${state.uiReferences.screens.slice(0, 3).join(', ')}${state.uiReferences.screens.length > 3 ? '...' : ''})\n`;
  }
  if (state.uiReferences?.components?.length) {
    resourcesSummary += `- **Components**: ${state.uiReferences.components.length} component snapshots available\n`;
    resourcesSummary += `  (Examples: ${state.uiReferences.components.slice(0, 3).join(', ')}${state.uiReferences.components.length > 3 ? '...' : ''})\n`;
  }
  
  resourcesSummary += '\n## Asset Files\n';
  resourcesSummary += 'Use `list_assets` tool to discover available asset files for mapping.\n\n';
  
  if (state.uiAssetsList) {
    const assetCounts = [
      state.uiAssetsList.logos?.length ? `logos: ${state.uiAssetsList.logos.length}` : null,
      state.uiAssetsList.icons?.length ? `icons: ${state.uiAssetsList.icons.length}` : null,
      state.uiAssetsList.backgrounds?.length ? `backgrounds: ${state.uiAssetsList.backgrounds.length}` : null,
      state.uiAssetsList.other?.length ? `other: ${state.uiAssetsList.other.length}` : null,
    ].filter(Boolean);
    
    if (assetCounts.length > 0) {
      resourcesSummary += `Available: ${assetCounts.join(', ')}\n`;
    }
  }
  
  content.push({
    type: 'text',
    text: resourcesSummary
  });
  
  // ✅ 3. PRD Context (if available)
  if (state.prd) {
    content.push({
      type: 'text',
      text: `\n\n# PRD (Requirements)\n\n${state.prd}`
    });
  }
  
  // ✅ 4. Task Instructions with Tool Usage Guide
  const taskInstruction = buildUiDesignTaskInstruction(state);
  content.push({
    type: 'text',
    text: taskInstruction
  });
  
  // ✅ 5. Tool Usage Guide
  const toolGuide = buildUiDesignToolGuide(task?.id || 'ui-tokens');
  content.push({
    type: 'text',
    text: toolGuide
  });
  
  return [{
    role: 'user',
    content
  }];
}

/**
 * Build fresh user prompt for tool loop continuation
 * This is needed when continuing after tool calls to maintain proper message structure
 */
async function buildUiDesignFreshPrompt(state: DesignGraphState): Promise<CacheableContent[]> {
  const content: CacheableContent[] = [];
  
  // ✅ 1. System Prompt - UI Design Generation Instructions
  const systemPrompt = await buildUiDesignSystemPrompt(state);
  content.push({
    type: 'text',
    text: systemPrompt,
    cache_control: { type: 'ephemeral' }
  });
  
  // ✅ 2. Available Resources Summary (text only - no images preloaded)
  let resourcesSummary = '\n\n# Available Resources\n\n';
  resourcesSummary += '## Reference Screenshots\n';
  resourcesSummary += 'Use `list_reference_images` tool to discover available screenshots, then use `read_reference_image` to load and analyze specific images.\n\n';
  
  if (state.uiReferences?.screens?.length) {
    resourcesSummary += `- **Screens**: ${state.uiReferences.screens.length} screenshots available\n`;
    resourcesSummary += `  (Examples: ${state.uiReferences.screens.slice(0, 3).join(', ')}${state.uiReferences.screens.length > 3 ? '...' : ''})\n`;
  }
  if (state.uiReferences?.components?.length) {
    resourcesSummary += `- **Components**: ${state.uiReferences.components.length} component snapshots available\n`;
    resourcesSummary += `  (Examples: ${state.uiReferences.components.slice(0, 3).join(', ')}${state.uiReferences.components.length > 3 ? '...' : ''})\n`;
  }
  
  resourcesSummary += '\n## Asset Files\n';
  resourcesSummary += 'Use `list_assets` tool to discover available asset files for mapping.\n\n';
  
  if (state.uiAssetsList) {
    const assetCounts = [
      state.uiAssetsList.logos?.length ? `logos: ${state.uiAssetsList.logos.length}` : null,
      state.uiAssetsList.icons?.length ? `icons: ${state.uiAssetsList.icons.length}` : null,
      state.uiAssetsList.backgrounds?.length ? `backgrounds: ${state.uiAssetsList.backgrounds.length}` : null,
      state.uiAssetsList.other?.length ? `other: ${state.uiAssetsList.other.length}` : null,
    ].filter(Boolean);
    
    if (assetCounts.length > 0) {
      resourcesSummary += `Available: ${assetCounts.join(', ')}\n`;
    }
  }
  
  content.push({
    type: 'text',
    text: resourcesSummary
  });
  
  // ✅ 3. PRD Context (if available)
  if (state.prd) {
    content.push({
      type: 'text',
      text: `\n\n# PRD (Requirements)\n\n${state.prd}`
    });
  }
  
  // ✅ 4. Task Instructions with Tool Usage Guide
  const taskInstruction = buildUiDesignTaskInstruction(state);
  content.push({
    type: 'text',
    text: taskInstruction
  });
  
  // ✅ 5. Tool Usage Guide
  const task = state.currentTask;
  const toolGuide = buildUiDesignToolGuide(task?.id || 'ui-tokens');
  content.push({
    type: 'text',
    text: toolGuide
  });
  
  return content;
}

/**
 * Build tool usage guide specific to each UI design task
 */
function buildUiDesignToolGuide(taskId: string): string {
  let guide = '\n\n# Tool Usage Guide\n\n';
  
  switch (taskId) {
    case 'ui-tokens':
      guide += `## For tokens.md generation:
1. First, use \`list_reference_images\` to see all available screenshots
2. Load 2-3 key screens using \`read_reference_image\` (e.g., desktop main, mobile main)
3. Analyze each image for:
   - Color palette (extract hex values)
   - Typography (font families, sizes, weights)
   - Spacing patterns (padding, margins)
   - Border radius, shadows
4. Create consolidated tokens.md with extracted values

**Strategy**: Load screens with most UI variety first (usually desktop landing page).
`;
      break;
      
    case 'ui-assets':
      guide += `## For ui-assets.md generation:
1. Use \`list_assets\` to get complete asset inventory
2. Optionally load screenshots with \`read_reference_image\` to understand asset context
3. Document each asset with:
   - Source path (inputs/assets/...)
   - Target path in codebase
   - Usage context

**Note**: This task focuses on file mapping, not visual analysis. Image loading is optional.
`;
      break;
      
    case 'ui-spec':
      guide += `## For ui-spec.md generation:
1. Use \`list_reference_images\` to identify all screens
2. Load screens systematically with \`read_reference_image\`:
   - Start with main pages (desktop)
   - Then responsive variants (tablet, mobile)
   - Then component states
3. For each screen, document:
   - Layout structure
   - Component breakdown
   - Interactions and states
   - Responsive behavior

**Strategy**: Process one screen at a time, completing its documentation before moving to the next.
`;
      break;
      
    default:
      guide += `Use available tools to explore reference images and assets as needed for your task.`;
  }
  
  guide += `

## Available Tools

| Tool | Purpose |
|------|---------|
| \`list_reference_images\` | Discover available screenshots and components |
| \`read_reference_image\` | Load a specific image for visual analysis |
| \`list_assets\` | List asset files (logos, icons, etc.) |
| \`read_file\` | Read existing documents or PRD |

## ⚠️ IMPORTANT: If No Images Are Available

If \`list_reference_images\` returns empty results or no reference images are found:

1. **DO NOT keep calling the same tool repeatedly** - this wastes tokens and creates infinite loops
2. **Generate the document based on PRD/directive only**:
   - Use placeholder descriptions where visual analysis would be needed
   - Mark sections with \`[PLACEHOLDER: Requires visual reference]\` where specific values cannot be determined
   - Focus on structural documentation that can be inferred from requirements
3. **Inform the user** that reference screenshots are needed for complete documentation

Example for tokens.md without images:
\`\`\`markdown
## Colors
| Token | Value | Usage |
|-------|-------|-------|
| color.primary | [PLACEHOLDER] | Primary brand color - requires Figma reference |
| color.bg.base | [PLACEHOLDER] | Background color - requires Figma reference |
\`\`\`
`;
  
  return guide;
}

/**
 * Build system prompt for UI Design generation
 * 
 * Uses: design/phases/execute/base-ui-design.md (workType-specific base prompt)
 */
async function buildUiDesignSystemPrompt(state: DesignGraphState): Promise<string> {
  const promptPort = state.deps?.promptEngine;
  
  // Try to load from template (same execute phase, but ui-design variant)
  if (promptPort) {
    try {
      const template = await (promptPort as any).deps?.promptPort?.render('design/phases/execute/base-ui-design', {
        taskId: state.currentTask?.id,
        taskName: state.currentTask?.name,
      });
      if (template) return template;
    } catch {
      // Template not found, use fallback
    }
  }
  
  // Fallback: Inline system prompt
  return `# UI Document Generation System

You are a UI documentation specialist that analyzes Figma design screenshots and generates structured documentation for frontend developers.

## Your Role
- Extract design tokens (colors, typography, spacing) from screenshots
- Map asset files to their usage contexts
- Document component specifications and interactions
- Create comprehensive UI specifications

## Output Format
All documents must be written using XML file tags:

\`\`\`xml
<file path="inputs/sources/[filename].md">
[Markdown content]
</file>
\`\`\`

## Document Types

### tokens.md (Task: ui-tokens)
Extract from screenshots:
- Colors (with hex values and usage context)
- Typography (font families, sizes, weights)
- Spacing (margin/padding values)
- Border radius, shadows, etc.

Format as tables for easy CSS variable creation.

### ui-assets.md (Task: ui-assets)
Document each asset file:
- File path (from inputs/assets/)
- Copy destination (to public/)
- Usage context and component associations

### ui-spec.md (Task: ui-spec)
Document each screen/component:
- Layout structure (CSS Grid/Flexbox recommendations)
- Component hierarchy
- Interactive states (hover, active, disabled)
- Responsive breakpoints

## Guidelines
1. Be specific with values (don't use "light blue", use "#E3F2FD")
2. Reference actual asset filenames
3. Use consistent naming conventions
4. Include implementation hints for developers
`;
}

/**
 * Build task-specific instruction for UI Design
 */
function buildUiDesignTaskInstruction(state: DesignGraphState): string {
  const task = state.currentTask;
  if (!task) return '';
  
  let targetFile = 'ui-spec.md';
  let instruction = '';
  
  switch (task.id) {
    case 'ui-tokens':
      targetFile = 'tokens.md';
      instruction = `
# Current Task: Generate Design Tokens

Analyze the reference screenshots and extract ALL design tokens:

1. **Colors** - Every color used, with hex values and semantic names
2. **Typography** - Font families, sizes, weights, line heights
3. **Spacing** - Common margin/padding values
4. **Shadows** - Box shadows and text shadows
5. **Borders** - Border widths, radius values

Format output as Markdown tables for easy reference.
Output file: inputs/sources/tokens.md
`;
      break;
      
    case 'ui-assets':
      targetFile = 'ui-assets.md';
      instruction = `
# Current Task: Generate Asset Mapping

Create a comprehensive asset mapping document:

1. **Asset Inventory** - List all files in inputs/assets/
2. **Copy Instructions** - Map source → destination paths
3. **Usage Context** - Which component/screen uses each asset
4. **Implementation Notes** - Any special handling needed

Output file: inputs/sources/ui-assets.md
`;
      break;
      
    case 'ui-spec':
      targetFile = 'ui-spec.md';
      instruction = `
# Current Task: Generate UI Specification

Create detailed UI specifications from the screenshots:

1. **Screen Layouts** - Overall page structure
2. **Component Specs** - Props, variants, states for each component
3. **Interactions** - Hover, click, focus states
4. **Responsive Behavior** - Breakpoints and layout changes
5. **Animation/Transitions** - Any motion design specs

Output file: inputs/sources/ui-spec.md
`;
      break;
  }
  
  return `${instruction}

⚠️ CRITICAL: Write to file using XML tag:
\`\`\`xml
<file path="inputs/sources/${targetFile}">
[Your markdown content here]
</file>
\`\`\`
`;
}

