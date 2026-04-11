/**
 * Keyword Generation for Plan Node
 * 
 * Generates task-specific keywords for:
 * - Error files (exact paths from build/operation errors)
 * - Semantic keywords (context for understanding)
 * - Reference project keywords
 */

import * as path from "path";
import * as fs from "fs/promises";
import { LLMClient } from "../../../../../../core/ports";
import { ArchitectGraphState } from "../../state";
import { CodeTask } from "../../../../types/task";
import { getChatAPIClient } from "../../../../../../core/adapters/ChatAPIClient";
import { logPrompt } from "../../../../../../core/utils/promptLogger";
import { LLM_TEMPERATURE, LLM_MAX_TOKENS } from "../../../../../common/graph/llmConfig";
import { TaskKeywords } from "./combineCodeContext";
import { KeywordDeduplicator } from "../../../../../../core/prompt/engine/InputSanitizer";

export type { TaskKeywords };

const keywordDedup = new KeywordDeduplicator();

/**
 * Reset the keyword deduplicator state.
 * MUST be called at the start of each job to prevent stale task IDs
 * from a previous job causing false "duplicate" detections on resume.
 */
export function resetKeywordDedup(): void {
  keywordDedup.reset();
}

/**
 * Generate task-specific keywords using LLM
 */
export async function generateTaskKeywords(
  llm: LLMClient,
  task: CodeTask,
  state: ArchitectGraphState,
  directoryTree?: string
): Promise<TaskKeywords> {
  if (keywordDedup.isDuplicate(task.id)) {
    console.warn(`⚠️  [Plan-Keyword] Duplicate call for task "${task.id}" (call #${keywordDedup.getCallCount(task.id)}), skipping keyword generation`);
    return {
      errorFiles: [],
      keywords: [],
      requiredFiles: [],
      references: new Map()
    };
  }

  const promptEngine = state.deps?.promptEngine;
  if (!promptEngine) {
    console.warn('[Plan] PromptEngine not available, skipping keyword generation');
    return {
      errorFiles: [],
      keywords: [],
      requiredFiles: [],
      references: new Map()
    };
  }

  const prompt = await promptEngine.buildTaskKeywordsPrompt(
    { name: task.name, description: task.description },
    state.directive || '',
    state.profile,
    state.detectionReport?.detectedMode || 'unknown',
    state.referenceRequests,
    directoryTree
  );

  // ✅ Log prompt structure (not content)
  const jobId = state._httpJobId || 'unknown';
  if (state.context.featurePath) {
    try {
      await logPrompt(
        state.context.featurePath,
        jobId,
        'code',
        'plan-keyword',
        prompt.length,
        {
          taskId: task.id,
          taskName: task.name,
          templatePath: 'code/phases/plan/base-keyword',
          usedTemplates: ['code/phases/plan/rules-keyword'],
          injectedVariables: {
            taskName: task.name,
            taskDescription: task.description ? `[${task.description.length} chars]` : undefined,
            directive: state.directive ? `[${state.directive.length} chars]` : undefined,
            detectedMode: state.detectionReport?.detectedMode,
            hasReferences: !!(state.referenceRequests?.length),
            hasDirectoryTree: !!directoryTree,
          },
        }
      );
    } catch (logError) {
      console.warn(`⚠️  [Plan-Keyword] Failed to log prompt:`, logError);
    }
  }

  try {
    // ✅ Use centralized LLM wrapper with automatic token tracking
    const { invokeWithTracking, logTokenUsageToFile, getTaskTokenUsage, updateKanbanTokenUsage } = await import('../../../../../common/graph/llmHelpers');
    const beforeUsage = getTaskTokenUsage(state);
    const response = await invokeWithTracking(
      llm,
      [{ role: 'user', content: prompt }],
      state,
      { temperature: LLM_TEMPERATURE.PLAN_KEYWORD, maxTokens: LLM_MAX_TOKENS.KEYWORD, enableThinking: false }
    );
    updateKanbanTokenUsage(state);

    // Log to debug/tokens/
    const afterUsage = getTaskTokenUsage(state);
    const kwCallUsage = {
      inputTokens: afterUsage.inputTokens - beforeUsage.inputTokens,
      outputTokens: afterUsage.outputTokens - beforeUsage.outputTokens,
      cacheReadTokens: (afterUsage.cacheReadTokens || 0) - (beforeUsage.cacheReadTokens || 0),
      cacheCreationTokens: (afterUsage.cacheCreationTokens || 0) - (beforeUsage.cacheCreationTokens || 0),
    };
    logTokenUsageToFile(
      state.context?.featurePath,
      state._httpJobId,
      kwCallUsage as any,
      {
        taskId: state.currentTask?.id || 'unknown',
        taskName: state.currentTask?.name || 'unknown',
        node: 'plan-keyword',
        callIndex: 0,
        conversationHistoryLength: 0,
        projectCodeContextFiles: 0,
        estimatedPromptChars: prompt.length,
        taskCumulativeInput: beforeUsage.inputTokens,
        taskCumulativeOutput: beforeUsage.outputTokens,
        recursionCount: state.recursionCount,
      }
    );

    const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) ||
                      response.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);

      const references = new Map<string, string[]>();
      if (parsed.references) {
        for (const [project, keywords] of Object.entries(parsed.references)) {
          if (Array.isArray(keywords)) {
            references.set(project, keywords);
          }
        }
      }

      const result: TaskKeywords = {
        // ✅ Backward-compatible: accept errorFiles OR legacy stackTrace
        errorFiles: Array.isArray(parsed.errorFiles) ? parsed.errorFiles
                  : Array.isArray(parsed.stackTrace) ? parsed.stackTrace
                  : [],
        // ✅ Backward-compatible: accept keywords OR legacy codebase
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords
                : Array.isArray(parsed.codebase) ? parsed.codebase
                : [],
        requiredFiles: Array.isArray(parsed.requiredFiles) ? parsed.requiredFiles : [],
        references
      };

      return result;
    }
  } catch (error) {
    console.warn(`⚠️  Keyword generation failed:`, error);
  }

  return {
    errorFiles: [],
    keywords: [],
    requiredFiles: [],
    references: new Map()
  };
}

/**
 * Display keywords in Chat UI
 */
export async function displayKeywords(taskKeywords: TaskKeywords): Promise<void> {
  console.log(`\n🔍 [displayKeywords] Starting Chat UI update...`);
  console.log(`   Error files: ${taskKeywords.errorFiles.length}`);
  console.log(`   Required files: ${taskKeywords.requiredFiles.length}`);
  console.log(`   Semantic keywords: ${taskKeywords.keywords.length}`);
  
  const chatAPI = getChatAPIClient();
  
  if (taskKeywords.errorFiles.length === 0 && taskKeywords.keywords.length === 0 && taskKeywords.requiredFiles.length === 0) {
    console.log(`   ⊖ No keywords to display, skipping Chat UI update`);
    return;
  }
  
  const errorFilesCount = taskKeywords.errorFiles.length;
  const requiredFilesCount = taskKeywords.requiredFiles.length;
  const semanticCount = taskKeywords.keywords.length;
  const totalCount = errorFilesCount + requiredFilesCount + semanticCount;
  
  // Build summary for main display
  const parts: string[] = [];
  if (errorFilesCount > 0) {
    parts.push(`${errorFilesCount} error files`);
  }
  if (requiredFilesCount > 0) {
    parts.push(`${requiredFilesCount} required files`);
  }
  if (semanticCount > 0) {
    parts.push(`${semanticCount} semantic keywords`);
  }
  const summary = parts.join(', ');
  
  // Build file list with type tags for expandable view
  const filesList: string[] = [];
  
  // Add error files with [error] tag
  taskKeywords.errorFiles.forEach(file => {
    filesList.push(`[error] ${file}`);
  });
  
  // Add required files with [required] tag
  taskKeywords.requiredFiles.forEach(file => {
    filesList.push(`[required] ${file}`);
  });
  
  // Add semantic keywords with [semantic] tag
  taskKeywords.keywords.forEach(keyword => {
    filesList.push(`[semantic] ${keyword}`);
  });
  
  console.log(`   📤 Sending 'analyzing' → 'analyzed' status to Chat UI...`);
  console.log(`      Summary: "${summary}"`);
  
  try {
    // ✅ Send analyzing first and get index
    const mergeIndex = await chatAPI.showChatStatus('analyzing', {
      keywordCount: 0,
      filesList: []
    });
    
    // Then send analyzed with _mergeIndex
    await chatAPI.showChatStatus('analyzed', {
      content: `Analyzed: ${summary}`,
      keywordCount: totalCount,
      errorFilesCount,
      semanticCount,
      filesList,  // ✅ Expandable list
      _mergeIndex: mergeIndex
    });
    console.log(`   ✅ Chat UI update successful (analyzing → analyzed)\n`);
  } catch (error: any) {
    console.error(`   ❌ Chat UI update FAILED:`, error.message);
    console.error(`      Stack:`, error.stack);
    throw error;
  }
}

/**
 * Log keywords to console
 */
export function logKeywords(taskKeywords: TaskKeywords): void {
  if (taskKeywords.errorFiles.length > 0) {
    console.log(`   📍 Error files: ${taskKeywords.errorFiles.join(', ')}`);
  }
  if (taskKeywords.requiredFiles.length > 0) {
    console.log(`   📄 Required files: ${taskKeywords.requiredFiles.join(', ')}`);
  }
  if (taskKeywords.keywords.length > 0) {
    console.log(`   🔍 Keywords: ${taskKeywords.keywords.join(', ')}`);
  }
  if (taskKeywords.references && taskKeywords.references.size > 0) {
    taskKeywords.references.forEach((kws, proj) => {
      console.log(`   ✅ Reference [${proj}]: ${kws.join(', ')}`);
    });
  }
}


