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
        const rootPath = state.deps.fileSystem.getRootPath?.();
        if (rootPath && pathModule.isAbsolute(designDocPath)) {
          designDocPath = pathModule.relative(rootPath, designDocPath);
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
    // Also handles MSA service-specific backend docs: be-system-design-{service}.md
    let apiContractContent: string | undefined;
    const isImplementationDesign = 
      targetFile === 'fe-system-design.md' || 
      targetFile === 'be-system-design.md' ||
      targetFile.startsWith('be-system-design-');  // ✅ MSA service-specific pattern
    
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
        directive: state.directive || '',
        designDoc: apiContractContent,
        lastSectionNumber,
        sectionPattern,
        prdSpec: state.prd,
        designDomain: state.detectionReport?.domain,
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
        // ✅ Determine actually used templates based on targetFile (mirrors ModeController logic)
        const usedTemplates: string[] = ['design/phases/execute/rules-system-design'];
        
        if (targetFile.includes('api-contract')) {
          usedTemplates.push('design/base/injections/api-contract-guide');
        } else if (targetFile.includes('be-system-design')) {
          usedTemplates.push('design/base/injections/backend-guide');
        } else if (targetFile.includes('fe-system-design')) {
          usedTemplates.push('design/base/injections/frontend-guide');
        }
        
        // Domain-specific guides
        if (state.detectionReport?.domain === 'game') {
          usedTemplates.push('design/phases/execute/injections/game-domain-guide');
        } else if (state.detectionReport?.domain === 'service') {
          usedTemplates.push('design/phases/execute/injections/service-domain-guide');
        }
        
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
            usedTemplates,
            injectedVariables: {
              targetFile,  // ✅ NEW: Critical for MSA debugging
              directive: state.directive ? `[${state.directive.length} chars]` : undefined,
              designDoc: apiContractContent ? `[${apiContractContent.length} chars]` : undefined,
              apiContractLoaded: !!apiContractContent,  // ✅ NEW: Quick check if contract was loaded
              lastSectionNumber,
              sectionPattern,
              prdSpec: state.prd ? `[${state.prd.length} chars]` : undefined,
              planText: state.planText ? `[${state.planText.length} chars]` : undefined,
              designDomain: state.detectionReport?.domain,
              currentTask: state.currentTask?.id,
              isLastTaskForDocument,
              isMSAServiceDoc: targetFile.startsWith('be-system-design-'),  // ✅ NEW: MSA indicator
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
        const content = m.content as CacheableContent[];
        return sum + content.reduce((s: number, c) => {
          if (c.type === 'text' && typeof c.text === 'string') {
            return s + c.text.length;
          }
          return s;
        }, 0);
      }, 0);
      
      // ✅ Determine actually used templates based on targetFile
      const targetFileForLog = state.currentTask?.targetFile || 'system-design.md';
      const usedTemplatesForLog: string[] = ['design/phases/execute/rules-system-design'];
      
      if (targetFileForLog.includes('api-contract')) {
        usedTemplatesForLog.push('design/base/injections/api-contract-guide');
      } else if (targetFileForLog.includes('be-system-design')) {
        usedTemplatesForLog.push('design/base/injections/backend-guide');
      } else if (targetFileForLog.includes('fe-system-design')) {
        usedTemplatesForLog.push('design/base/injections/frontend-guide');
      }
      
      if (state.detectionReport?.domain === 'game') {
        usedTemplatesForLog.push('design/phases/execute/injections/game-domain-guide');
      } else if (state.detectionReport?.domain === 'service') {
        usedTemplatesForLog.push('design/phases/execute/injections/service-domain-guide');
      }
      
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
          usedTemplates: usedTemplatesForLog,
          injectedVariables: {
            targetFile: targetFileForLog,  // ✅ NEW: Critical for MSA debugging
            messageCount: messages.length,
            hasConversationHistory: !!(state.conversationHistory?.length),
            conversationHistoryLength: state.conversationHistory?.length || 0,
            prd: state.prd ? `[${state.prd.length} chars]` : undefined,
            design: state.design ? `[${state.design.length} chars]` : undefined,
            directive: state.directive ? `[${state.directive.length} chars]` : undefined,
            jobMode: state.detectionReport?.jobMode,
            designDomain: state.detectionReport?.domain,
            isMSAServiceDoc: targetFileForLog.startsWith('be-system-design-'),  // ✅ NEW
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
  if (state.directive) {
    lines.push(`# Directive`);
    lines.push(state.directive || '');
    lines.push('');
  }
  
  // ✅ 4. Existing Design Document (ONLY for refactor mode)
  // - generate: NO document needed (lastSectionNumber is sufficient for sequential chapter generation)
  // - refactor: FULL document needed (LLM must understand structure to modify specific sections)
  //   Use content matching targetFile from existingDesignDocs (not state.design which may be a different file)
  if (state.detectionReport?.jobMode === 'refactor') {
    const targetFileName = task?.targetFile || 'system-design.md';
    const existingContent = state.existingDesignDocs?.[targetFileName] || state.design;
    if (existingContent) {
      lines.push(`# Existing Design Document`);
      lines.push(existingContent);
      lines.push('');
    }
  }
  // ❌ For generate mode: DO NOT include state.design
  // Reason: Including old document content causes LLM confusion with outdated metadata
  // The lastSectionNumber in the base prompt is sufficient for sequential chapter numbering
  
  return lines.join('\n');
}

