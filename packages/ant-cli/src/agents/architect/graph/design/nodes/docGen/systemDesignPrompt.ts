/**
 * System Design Prompt Builder
 * 
 * Handles message building for system-design work type:
 * - buildMessages: Main message builder with PromptEngine
 * - buildRuntimeContext: Task and directive context
 */

import { DesignGraphState } from '../../state';
import { CacheableContent } from '../../../../../../core/ports/llm';
import { TokenBudgetManager } from '../../../../../../core/utils/tokenBudget';
import { HistoryManager } from '../../../../../../core/utils/historyManager';
import { logPrompt } from '../../../../../../core/utils/promptLogger';

/**
 * Build messages for LLM using PromptEngine with Prompt Caching
 * 
 * Handles system-design work type (fe-system-design, be-system-design, api-contract, etc.)
 */
export async function buildMessages(state: DesignGraphState): Promise<Array<{
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
    // ✅ Load existing design document's last section number and pattern
    let lastSectionNumber = 0;
    let sectionPattern = '';  // 'top-level' or 'nested'
    
    const targetFile = state.currentTask.targetFile || 'system-design.md';
    console.log(`📄 [DocGen] Target file: ${targetFile}`);
    
    // ✅ Check if this is the last task for this document
    // CRITICAL: Exclude current task from the count (it may still be in queue)
    const currentTaskId = state.currentTask?.id;
    const allQueuedTasks = state.taskQueue?.getAll?.() || [];
    const remainingTasksForFile = allQueuedTasks.filter(
      (task: any) => {
        // Exclude current task from remaining count
        if (task.id === currentTaskId) return false;
        return (task.targetFile || 'system-design.md') === targetFile;
      }
    );
    const isLastTaskForDocument = remainingTasksForFile.length === 0;
    if (isLastTaskForDocument) {
      console.log(`📄 [DocGen] This is the LAST task for ${targetFile} - will NOT output metadata`);
    }
    
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
            // Parse all metadata from file
            const metadataLines = fullContent.trim().split('\n').slice(-5); // Check last 5 lines
            
            for (const line of metadataLines) {
              // Parse LAST_SECTION
              const lastSectionMatch = line.match(/<!-- LAST_SECTION: (\d+) -->/);
              if (lastSectionMatch) {
                lastSectionNumber = parseInt(lastSectionMatch[1]);
                console.log(`📄 [DocGen] Found last section: ${lastSectionNumber} (from metadata)`);
              }
              
              // Parse SECTION_PATTERN
              const patternMatch = line.match(/<!-- SECTION_PATTERN: (\w+) -->/);
              if (patternMatch) {
                sectionPattern = patternMatch[1];
                console.log(`📄 [DocGen] Found section pattern: ${sectionPattern}`);
              }
            }
            
            // Fallback for LAST_SECTION: scan for section headers
            if (!lastSectionNumber) {
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
        sectionPattern,  // ✅ NEW: 'top-level' or 'nested' structure pattern
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
        } as any,
        isLastTaskForDocument,  // ✅ If true, don't output metadata (passed separately)
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
    
    // ✅ Log prompt structure (not content)
    const jobId = state.jobId || state._httpJobId || 'unknown';
    if (state.context.featurePath) {
      try {
        await logPrompt(
          state.context.featurePath,
          jobId,
          'design',
          'docGen-systemDesign',
          allContent.length,
          {
            taskId: state.currentTask?.id,
            taskName: state.currentTask?.name,
            templatePath: 'design/phases/execute/base-system-design',
            usedTemplates: [
              'design/phases/execute/rules-system-design',
              'design/phases/execute/injections/game-domain-guide',
              'design/phases/execute/injections/service-domain-guide',
            ],
            injectedVariables: {
              directive: state.directive ? `[${state.directive.length} chars]` : undefined,
              designDoc: apiContractContent ? `[${apiContractContent.length} chars]` : undefined,
              lastSectionNumber,
              sectionPattern,
              prdSpec: state.prd ? `[${state.prd.length} chars]` : undefined,
              currentCode: state.code ? `[${state.code.length} chars]` : undefined,
              designDomain: state.designDomain,
              currentTask: state.currentTask?.id,
              isLastTaskForDocument,
            },
          }
        );
      } catch (logError) {
        console.warn(`⚠️  [DocGen] Failed to log prompt:`, logError);
      }
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
  
  // ✅ Log prompt structure (not content) - full message
  const jobIdFinal = state.jobId || state._httpJobId || 'unknown';
  if (state.context.featurePath) {
    try {
      // Calculate total text length from all messages
      const totalLength = messages.reduce((sum, m) => {
        if (Array.isArray(m.content)) {
          return sum + m.content.reduce((s, c: any) => s + (c.type === 'text' ? c.text.length : 0), 0);
        }
        return sum + (typeof m.content === 'string' ? m.content.length : 0);
      }, 0);
      
      await logPrompt(
        state.context.featurePath,
        jobIdFinal,
        'design',
        'docGen-systemDesign-fullMessage',
        totalLength,
        {
          taskId: state.currentTask?.id,
          taskName: state.currentTask?.name,
          templatePath: 'design/phases/execute/base-system-design',
          usedTemplates: [
            'design/phases/execute/rules-system-design',
            'design/phases/execute/injections/game-domain-guide',
            'design/phases/execute/injections/service-domain-guide',
          ],
          injectedVariables: {
            messageCount: messages.length,
            hasConversationHistory: !!(state.conversationHistory?.length),
            conversationHistoryLength: state.conversationHistory?.length || 0,
            prd: state.prd ? `[${state.prd.length} chars]` : undefined,
            design: state.design ? `[${state.design.length} chars]` : undefined,
            directive: state.directive ? `[${state.directive.length} chars]` : undefined,
            designMode: state.designMode,
            designDomain: state.designDomain,
          },
        }
      );
    } catch (logError) {
      console.warn(`⚠️  [DocGen] Failed to log full message:`, logError);
    }
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
export function buildRuntimeContext(state: DesignGraphState): string {
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

