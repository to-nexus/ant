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
import { TokenBudgetManager } from '../../../../../core/utils/tokenBudget';
import { HistoryManager } from '../../../../../core/utils/historyManager';

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
    state._bufferManager,  // ✅ Pass buffer manager
    state.context.userLanguage,  // ✅ Pass user language for localized messages
    state.deps?.git  // ✅ Pass gitPort (design job doesn't use edit, but keep consistent)
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
  
  // ✅ Calculate maxTokens based on task line budget
  let maxTokens = 16000;  // Default for small tasks
  
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
      content: buffer.content,
      actionType: buffer.actionType  // ✅ CRITICAL: Preserve actionType for writeFiles node
    }));
    
    console.log(`\n✅ [DocGen] XML streaming complete (${files.length} files generated)`);
    
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
    console.log(`📄 [DocGen] Building fresh prompt (no conversation history)`);
    const promptEngine = state.deps?.promptEngine;
    
    if (!promptEngine) {
      throw new Error('[DocGen] PromptEngine is required but not available in state.deps');
    }
    
    if (!state.currentTask) {
      throw new Error('[DocGen] currentTask is required but not available in state');
    }
    // ✅ Load existing design document's last section number
    // CRITICAL: ONLY read from disk file (completed tasks), NOT buffer (in-progress/interrupted tasks)
    let lastSectionNumber = 0;
    
    try {
      const designDocPath = `${state.context.featurePath}/outputs/design/system-design.md`;
      
      // ✅ ALWAYS read from disk file (source of truth for completed tasks)
      // DO NOT read buffer (may contain incomplete/interrupted work)
      if (state.deps?.git) {
        const fileExists = await state.deps.git.fileExists(designDocPath);
        if (fileExists) {
          const fullContent = await state.deps.git.readFile(designDocPath) || '';
          if (fullContent) {
            // ✅ Strategy 1: Check last line for metadata comment
            const lastLine = fullContent.trim().split('\n').pop() || '';
            const metadataMatch = lastLine.match(/<!-- LAST_SECTION: (\d+) -->/);
            
            if (metadataMatch) {
              lastSectionNumber = parseInt(metadataMatch[1]);
            } else {
              // ✅ Fallback: Scan full document for section numbers
              const sectionMatches = fullContent.match(/^## (\d+)\./gm);
              if (sectionMatches) {
                const numbers = sectionMatches.map(m => parseInt(m.match(/\d+/)?.[0] || '0'));
                lastSectionNumber = Math.max(...numbers);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error(`[DocGen] Error reading design document:`, error);
    }
    
    // ✅ CRITICAL: Load api-contract.md if generating system-design
    // When generating fe/be-system-design.md, LLM MUST see api-contract.md to follow exact specs
    let apiContractContent: string | undefined;
    const isSystemDesignTask = 
      state.currentTask.description.includes('fe-system-design.md') ||
      state.currentTask.description.includes('be-system-design.md') ||
      state.currentTask.description.includes('system-design.md');
    
    if (isSystemDesignTask) {
      try {
        // Try buffer first (in case api-contract was generated in same job)
        const apiContractBufferContent = state._bufferManager?.getContent('outputs/design/api-contract.md');
        if (apiContractBufferContent) {
          apiContractContent = apiContractBufferContent;
          console.log(`📋 [DocGen] Loaded api-contract.md from buffer (${apiContractContent.length} chars)`);
        } else {
          // Try disk (if from previous job)
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
        }
      } catch (error) {
        console.warn(`⚠️  [DocGen] Failed to load api-contract.md:`, error);
      }
    }
    
    const promptResult = await promptEngine.buildExecutePrompt(
      'design',  // ✅ AgentTask type (not the task object!)
      state.context,
      {
        directive: state.directive || state.spec,
        designDoc: apiContractContent,  // ✅ Pass api-contract when generating system-design
        lastSectionNumber,  // ✅ Only pass the section number
        previousDesign: state.design,  // Use previousDesign for design job
        prdSpec: state.prd,
        currentCode: state.code,
        currentTask: {
          name: state.currentTask.name,
          type: state.currentTask.type,
          priority: state.currentTask.priority,
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
    
    // ✅ Merge: PromptEngine base + runtime context
    const mergedContent = `${basePrompt}\n\n${runtimeContext}`;
    
    // ✅ Validate: Ensure XML output format instructions are present
    const hasMarkdownFormat = mergedContent.includes('<file path=') || mergedContent.includes('Markdown File Output Format');
    
    if (!hasMarkdownFormat) {
      console.warn(`⚠️  WARNING: Markdown output format NOT found in prompt! (length: ${mergedContent.length} chars)`);
    }
    
    messages.push({
      role: 'user',
      content: mergedContent,
    });
  }
  
  // ✅ Add conversation history (if exists)
  // CRITICAL: Conversation history from LLM may have content as arrays (tool_use, tool_result)
  // We need to pass them as-is for proper context continuation
  if (state.conversationHistory && state.conversationHistory.length > 0) {
    console.log(`📄 [DocGen] Using existing conversation history (${state.conversationHistory.length} messages)`);
    
    // ✅ NEW: Prune history to prevent token overflow
    const tokenManager = new TokenBudgetManager();
    const historyManager = new HistoryManager(tokenManager);
    
    const { prunedHistory } = historyManager.pruneHistory(state.conversationHistory);
    messages.push(...prunedHistory);
    
    // ✅ Check final token budget
    const estimation = tokenManager.checkBudget(messages);
    
    // 🚨 If still over budget, throw error (should not happen with proper pruning)
    if (estimation.isOverBudget) {
      throw new Error(
        `[DocGen] Token budget exceeded after pruning! ` +
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
  
  // ✅ 3. Existing Design Document (ONLY for evolution/refactor modes)
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

