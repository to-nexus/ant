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
  
  // ✅ Build messages from conversation history + current task
  const messages = await buildMessages(state);
  
  // ✅ Tool activation: Design job now supports tools for file editing
  const tools = getToolsByNames(TOOL_SETS.design);
  
  console.log(`📝 [DocGen] Tool calling enabled (${tools.length} tools available)`);
  
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
  const existingFiles = new Set<string>();
  if (state.deps?.fileSystem && state.context.featurePath) {
    const path = await import('path');
    const fs = await import('fs/promises');
    
    // Scan entire outputs/design directory for any .md files
    const designDirPath = path.join(state.context.featurePath, 'outputs/design');
    
    try {
      // Check if directory exists
      const dirExists = await state.deps.fileSystem.fileExists(designDirPath);
      if (dirExists) {
        // Read all files in directory
        const files = await fs.readdir(designDirPath);
        
        // Add all .md files to existingFiles (relative to feature path)
        for (const file of files) {
          if (file.endsWith('.md')) {
            const relativePath = `outputs/design/${file}`;
            existingFiles.add(relativePath);
          }
        }
        
        console.log(`📋 [DocGen] Existing files on disk: ${existingFiles.size > 0 ? Array.from(existingFiles).join(', ') : 'none'}`);
      } else {
        console.log(`📋 [DocGen] outputs/design directory does not exist yet (first task)`);
      }
    } catch (error) {
      console.warn(`⚠️  [DocGen] Failed to scan outputs/design directory:`, error);
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
  
  try {
    // ✅ Stream with XML parsing only (no tool calling)
    // ✅ Thinking is ALWAYS enabled for design jobs
    for await (const event of llmClient.stream(messages, {
      tools: undefined,  // ✅ No tool calling for design job
      maxTokens,  // ✅ Dynamic based on line budget (minimum 16000 to support thinking)
      enableThinking: true,  // ✅ ALWAYS enabled for design jobs
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
      
      if (event.type === 'done') {
        // ✅ Extract token usage
        const { extractTokenUsageFromStreamEvent } = await import('../../common/llmHelpers');
        capturedUsage = extractTokenUsageFromStreamEvent(event);
        
        await chatAPI.sendLLMEvent(event);
      }
    }
    
    // ✅ Finalize orchestrator (flush buffer and save files)
    await orchestrator.finalize(false);  // No tool calls in XML streaming
    
    // ✅ Get generated files from registry (in-memory tracking)
    const registry = orchestrator.getRegistry();
    const files = registry.getAllFiles();
    
    console.log(`\n✅ [DocGen] XML streaming complete (${files.length} files generated)`);
    
    // ✅ Build conversation history for resume
    // CRITICAL: Must preserve messages for proper resume after interruption
    const conversationHistory: Array<{ role: 'user' | 'assistant'; content: string | any[] }> = [];
    
    // Add all messages used for this generation
    for (const msg of messages) {
      conversationHistory.push({
        role: msg.role,
        content: msg.content
      });
    }
    
    // Add assistant's response
    conversationHistory.push({
      role: 'assistant',
      content: textResponse  // XML response content
    });
    
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
    };
  } catch (error) {
    console.error('❌ [DocGen] Error during reasoning:', error);
    throw error;
  }
}

/**
 * Build messages for LLM using PromptEngine with Prompt Caching
 */
async function buildMessages(state: DesignGraphState): Promise<Array<{
  role: 'user' | 'assistant';
  content: CacheableContent[];
}>> {
  const messages: Array<{ role: 'user' | 'assistant'; content: CacheableContent[] }> = [];
  
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
      const designDocPath = `${state.context.featurePath}/outputs/design/${targetFile}`;
      
      if (state.deps?.fileSystem) {
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

