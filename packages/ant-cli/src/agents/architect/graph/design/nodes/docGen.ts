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
  
  // ✅ Calculate maxTokens based on task line budget
  let maxTokens = 16000;  // Default
  
  if (state.currentTask?.description) {
    const lineMatch = state.currentTask.description.match(/MAX (\d+) lines/i);
    if (lineMatch) {
      const maxLines = parseInt(lineMatch[1]);
      // Estimate: ~15 tokens per line (conservative for Markdown with formatting)
      // Add 2000 tokens buffer for XML tags, metadata, and thinking
      const estimatedTokens = maxLines * 15 + 2000;
      
      maxTokens = Math.max(16000, estimatedTokens);  // Ensure sufficient tokens for thinking
      console.log(`📏 [DocGen] Task line budget: ${maxLines} lines → maxTokens: ${maxTokens}`);
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
      
      console.log(`\n📄 [DocGen] ━━━ Reading file for lastSectionNumber calculation ━━━`);
      console.log(`   Path: ${designDocPath}`);
      console.log(`   Current task: ${state.currentTask?.name}`);
      
      // ✅ ALWAYS read from disk file (source of truth for completed tasks)
      // DO NOT read buffer (may contain incomplete/interrupted work)
      if (state.deps?.git) {
        const fileExists = await state.deps.git.fileExists(designDocPath);
        if (fileExists) {
          const fullContent = await state.deps.git.readFile(designDocPath) || '';
          if (fullContent) {
            console.log(`   File size: ${fullContent.length} chars, ${fullContent.split('\n').length} lines`);
            console.log(`   Last 150 chars of file:\n${fullContent.slice(-150)}`);
            
            // ✅ Strategy 1: Check last line for metadata comment
            const lastLine = fullContent.trim().split('\n').pop() || '';
            const metadataMatch = lastLine.match(/<!-- LAST_SECTION: (\d+) -->/);
            
            if (metadataMatch) {
              lastSectionNumber = parseInt(metadataMatch[1]);
              console.log(`   ✅ Found metadata in last line: "${lastLine}"`);
              console.log(`   ✅ Extracted lastSectionNumber = ${lastSectionNumber}`);
            } else {
              // ✅ Fallback: Scan full document for section numbers
              const sectionMatches = fullContent.match(/^## (\d+)\./gm);
              if (sectionMatches) {
                const numbers = sectionMatches.map(m => parseInt(m.match(/\d+/)?.[0] || '0'));
                lastSectionNumber = Math.max(...numbers);
                console.log(`   ⚠️  No metadata found in last line: "${lastLine}"`);
                console.log(`   📊 Scanned sections: ${sectionMatches.join(', ')}`);
                console.log(`   📊 Max section number = ${lastSectionNumber}`);
              }
            }
            
            console.log(`   📄 RESULT: lastSectionNumber = ${lastSectionNumber}, next should be ${lastSectionNumber + 1}`);
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
          }
        } else {
          console.log(`   ℹ️  No file exists (first task)`);
        }
      }
    } catch (error) {
      console.log(`   ❌ Error reading file:`, error);
    }
    
    const promptResult = await promptEngine.buildExecutePrompt(
      'design',  // ✅ AgentTask type (not the task object!)
      state.context,
      {
        directive: state.directive || state.spec,
        designDoc: undefined,  // ✅ Don't pass full document - not needed
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
    
    console.log(`📄 [DocGen] Passed to promptEngine: lastSectionNumber=${lastSectionNumber}`);
    
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
    
    // 🔍 Debug: Check if "Chapter Count" rule is in prompt
    const hasChapterCountRule = basePrompt.includes('Chapter Count') || basePrompt.includes('ONE task = ONE chapter');
    console.log(`📄 [DocGen] Prompt includes "Chapter Count" rule: ${hasChapterCountRule}`);
    
    // 🔍 Debug: Check if lastSectionNumber is correctly passed to prompt
    if (lastSectionNumber > 0) {
      const hasLastSection = basePrompt.includes(`CONTINUE SECTION NUMBERING FROM ${lastSectionNumber}`);
      const hasNextSection = basePrompt.includes(`Your first section MUST be: ## ${lastSectionNumber + 1}`);
      console.log(`📄 [DocGen] Prompt includes lastSectionNumber: ${hasLastSection}, next section: ${hasNextSection}`);
      
      // 🔍 Extract the actual instruction section to verify rendering
      const instructionMatch = basePrompt.match(/CONTINUE SECTION NUMBERING FROM (\d+)[\s\S]{0,500}/);
      if (instructionMatch) {
        console.log(`📄 [DocGen] ✅ Found instruction block:\n${instructionMatch[0].substring(0, 300)}...`);
      } else {
        console.log(`📄 [DocGen] ⚠️  Instruction block NOT FOUND in prompt! Searching for any section number...`);
        const anyLastSection = basePrompt.match(/Last section in document: ## (\d+)/);
        const anyNextSection = basePrompt.match(/Your first section MUST be: ## (\d+)/);
        console.log(`📄 [DocGen] Found "Last section": ${anyLastSection?.[1] || 'NOT FOUND'}`);
        console.log(`📄 [DocGen] Found "First section": ${anyNextSection?.[1] || 'NOT FOUND'}`);
        console.log(`📄 [DocGen] Expected last: ${lastSectionNumber}, Expected first: ${lastSectionNumber + 1}`);
      }
      
      if (!hasLastSection || !hasNextSection) {
        console.error(`❌ [DocGen] lastSectionNumber (${lastSectionNumber}) NOT properly rendered in prompt!`);
        console.error(`   Searching for: "CONTINUE SECTION NUMBERING FROM ${lastSectionNumber}"`);
        console.error(`   Prompt preview (first 2000 chars):\n${basePrompt.substring(0, 2000)}`);
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
    messages.push(...state.conversationHistory);
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

