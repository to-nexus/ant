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
import { getSessionDebugDir } from "../../../../../../core/utils/sessionPaths";
import { LLM_TEMPERATURE, LLM_MAX_TOKENS } from "../../../../../common/graph/llmConfig";
import { TaskKeywords } from "./combineCodeContext";

export type { TaskKeywords };

/**
 * Generate task-specific keywords using LLM
 */
export async function generateTaskKeywords(
  llm: LLMClient,
  task: CodeTask,
  state: ArchitectGraphState,
  directoryTree?: string
): Promise<TaskKeywords> {
  const promptEngine = state.deps?.promptEngine;
  if (!promptEngine) {
    console.warn('[Plan] PromptEngine not available, using fallback keywords');
    return {
      errorFiles: [],
      keywords: task.name.toLowerCase().split(' ').filter(w => w.length > 3),
      requiredFiles: [],
      references: new Map()
    };
  }

  const prompt = await promptEngine.buildTaskKeywordsPrompt(
    { name: task.name, description: task.description },
    state.directive || '',
    state.profile,
    state.detectionReport?.jobMode || 'unknown',
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
            jobMode: state.detectionReport?.jobMode,
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
    const { invokeWithTracking, logTokenUsageToFile, getTaskTokenUsage } = await import('../../../../../common/graph/llmHelpers');
    const beforeUsage = getTaskTokenUsage(state as any);
    const response = await invokeWithTracking(
      llm,
      [{ role: 'user', content: prompt }],
      state as any,
      { temperature: LLM_TEMPERATURE.PLAN_KEYWORD, maxTokens: LLM_MAX_TOKENS.KEYWORD }
    );

    // ✅ Log to debug/tokens/
    const afterUsage = getTaskTokenUsage(state as any);
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

      // ✅ Save keywords to debug file (non-blocking)
      saveKeywordsForDebug(state, task, result, !!directoryTree).catch(() => {});

      return result;
    }
  } catch (error) {
    console.warn(`⚠️  Keyword generation failed:`, error);
  }

  return {
    errorFiles: [],
    keywords: task.name.toLowerCase().split(' ').filter(w => w.length > 3),
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

/**
 * Save keyword generation results to debug file
 * 
 * Saves to: {featurePath}/sessions/architect/debug/keywords/{jobId}.json
 * All task keywords for a job are stored in a single JSON file (array of entries).
 * 
 * Follows the same pattern as savePlanTextForDebug in planGeneration.ts.
 */
async function saveKeywordsForDebug(
  state: ArchitectGraphState,
  task: CodeTask,
  keywords: TaskKeywords,
  hasDirectoryTree: boolean
): Promise<void> {
  try {
    const featurePath = state.context.featurePath;
    const jobId = state._httpJobId;

    if (!featurePath || !jobId) {
      return;
    }

    const keywordsDir = getSessionDebugDir(featurePath, 'architect', 'keywords');
    await fs.mkdir(keywordsDir, { recursive: true });

    const filepath = path.join(keywordsDir, `${jobId}.json`);

    // Load existing entries or start fresh
    let entries: any[] = [];
    try {
      const existing = await fs.readFile(filepath, 'utf-8');
      entries = JSON.parse(existing);
    } catch {
      // File doesn't exist yet
    }

    // Convert references Map to plain object for JSON serialization
    const referencesObj: Record<string, string[]> = {};
    if (keywords.references) {
      keywords.references.forEach((kws, proj) => {
        referencesObj[proj] = kws;
      });
    }

    entries.push({
      taskId: task.id,
      taskName: task.name,
      generated: new Date().toISOString(),
      hasDirectoryTree,
      requiredFiles: keywords.requiredFiles,
      keywords: keywords.keywords,
      errorFiles: keywords.errorFiles,
      references: referencesObj,
    });

    await fs.writeFile(filepath, JSON.stringify(entries, null, 2), 'utf-8');
  } catch {
    // Non-blocking - keyword debug save failed
  }
}

/**
 * Update the last keyword entry with actual retrieval results
 * 
 * Called after combineCodeContext completes to record what files were actually loaded.
 * Merges a `retrieval` field into the last entry of the keywords debug JSON.
 */
export async function updateKeywordsWithRetrieval(
  state: ArchitectGraphState,
  taskId: string,
  retrieval: {
    requiredFilesLoaded: string[];
    errorFilesLoaded: string[];
    semanticFilesLoaded: string[];
    totalFilesLoaded: number;
  }
): Promise<void> {
  try {
    const featurePath = state.context.featurePath;
    const jobId = state._httpJobId;

    if (!featurePath || !jobId) return;

    const keywordsDir = getSessionDebugDir(featurePath, 'architect', 'keywords');
    const filepath = path.join(keywordsDir, `${jobId}.json`);

    let entries: any[] = [];
    try {
      const existing = await fs.readFile(filepath, 'utf-8');
      entries = JSON.parse(existing);
    } catch {
      return; // No keyword file to update
    }

    // Find the entry for this task and add retrieval data
    const entry = entries.find((e: any) => e.taskId === taskId);
    if (entry) {
      entry.retrieval = retrieval;
      await fs.writeFile(filepath, JSON.stringify(entries, null, 2), 'utf-8');
    }
  } catch {
    // Non-blocking
  }
}

