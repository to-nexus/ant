/**
 * Keyword Generation for Plan Node
 *
 * Generates task-specific keywords for:
 * - Error files (exact paths from build/operation errors)
 * - Semantic keywords (context for understanding)
 * - Reference project keywords
 */

import { LLMClient } from "../../../../../../../core/ports";
import { ArchitectGraphState } from "../../../state";
import { CodeTask } from "../../../../../types/task";
import { getChatAPIClient } from "../../../../../../../core/adapters/ChatAPIClient";
import { logPrompt } from "../../../../../../../core/utils/promptLogger";
import { effectiveTechTier, getTechTier } from "@ant/shared";
import { LLM_TEMPERATURE, LLM_MAX_TOKENS } from "../../../../../../common/graph/llmConfig";
import { TaskKeywords } from "./combine";
import { KeywordDeduplicator } from "../../../../../../../core/prompt/builder/InputSanitizer";
import { normalizeToCodebasePath } from "../../../../../../../core/utils/pathNormalizer";

/**
 * Run a path through the workspace normalize SSOT and drop empties.
 * Applied to LLM-emitted `errorFiles` / `requiredFiles` arrays so
 * downstream loaders (`loadErrorFiles`, `loadRequiredFiles`) consume
 * canonical workspace-rel paths regardless of which prefix shape the
 * LLM happened to write.
 *
 * Exported so the rac-pool-normalize regression suite can lock the
 * normalize-at-source contract without standing up a full LLM mock.
 */
export function normalizePathArray(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  for (const p of arr) {
    if (typeof p !== 'string' || !p.trim()) continue;
    out.push(normalizeToCodebasePath(p).normalized);
  }
  return out;
}

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
 * Clear the dedup record for a single task. Called by the batch-split
 * Path A re-queue site so the parent verification task's keyword RAG
 * fires fresh on its next plan entry — without this, the second cycle
 * skipped keyword RAG entirely and lost its retrieval window
 * (`vast-curling-perch` D-0).
 */
export function clearKeywordDedupForTask(taskId: string): void {
  keywordDedup.delete(taskId);
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

  const promptBuilder = state.deps?.promptBuilder;
  if (!promptBuilder) {
    console.warn('[Plan] PromptBuilder not available, skipping keyword generation');
    return {
      errorFiles: [],
      keywords: [],
      requiredFiles: [],
      references: new Map()
    };
  }

  const techTier = task.techTiers?.length ? effectiveTechTier(task.techTiers) : getTechTier(state);
  const prompt = await promptBuilder.render('jobs/code/nodes/plan/base-keyword', {
    taskName: task.name,
    taskDescription: task.description,
    directive: state.directive || '',
    language: techTier?.language || 'unknown',
    framework: techTier?.framework || 'unknown',
    mode: state.resolvedAction?.mode || 'unknown',
    hasReferences: state.referenceRequests && state.referenceRequests.length > 0,
    referenceProjects: state.referenceRequests?.map(r => `- ${r.project}`).join('\n') || '',
    directoryTree: directoryTree || '',
    hasDirectoryTree: !!directoryTree,
  });

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
          templatePath: 'jobs/code/nodes/plan/base-keyword',
          usedTemplates: ['jobs/code/nodes/plan/rules-keyword'],
          injectedVariables: {
            taskName: task.name,
            taskDescription: task.description ? `[${task.description.length} chars]` : undefined,
            directive: state.directive ? `[${state.directive.length} chars]` : undefined,
            mode: state.resolvedAction?.mode,
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
    const { invokeWithTracking, logTokenUsageToFile, getTaskTokenUsage, updateKanbanTokenUsage } = await import('../../../../../../common/graph/llmHelpers');
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
        nodeHistoryLength: 0,
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
        // Normalize at source — downstream loaders (`loadErrorFiles`,
        // `loadRequiredFiles`) consume the canonical workspace-rel form
        // (`codebase/...` for code paths, sibling-prefix verbatim for
        // `architecture/`/`plan/`/etc.). `normalizePathArray` is also
        // tolerant of non-array input (returns `[]`), so no extra
        // `Array.isArray` guard is needed.
        errorFiles: normalizePathArray(parsed.errorFiles),
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
        requiredFiles: normalizePathArray(parsed.requiredFiles),
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
