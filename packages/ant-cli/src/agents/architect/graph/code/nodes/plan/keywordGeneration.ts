/**
 * Keyword Generation for Plan Node
 * 
 * Generates task-specific keywords for:
 * - Error files (exact paths from build/operation errors)
 * - Semantic keywords (context for understanding)
 * - Reference project keywords
 */

import { LLMClient } from "../../../../../../core/ports";
import { ArchitectGraphState } from "../../state";
import { CodeTask } from "../../../../types/task";
import { getChatAPIClient } from "../../../../../../core/adapters/ChatAPIClient";

export interface TaskKeywords {
  errorFiles: string[];  // Files that caused errors (build errors, file operation errors)
  keywords: string[];    // Semantic keywords for search
  references: Map<string, string[]>;
}

/**
 * Generate task-specific keywords using LLM
 */
export async function generateTaskKeywords(
  llm: LLMClient,
  task: CodeTask,
  state: ArchitectGraphState
): Promise<TaskKeywords> {
  const promptEngine = state.deps?.promptEngine;
  if (!promptEngine) {
    console.warn('[Plan] PromptEngine not available, using fallback keywords');
    return {
      errorFiles: [],
      keywords: task.name.toLowerCase().split(' ').filter(w => w.length > 3),
      references: new Map()
    };
  }

  const prompt = await promptEngine.buildTaskKeywordsPrompt(
    { name: task.name, description: task.description },
    state.directive || '',
    state.profile,
    state.mode || 'unknown',
    state.referenceRequests
  );

  try {
    // ✅ Use centralized LLM wrapper with automatic token tracking
    const { invokeWithTracking } = await import('../../../common/llmHelpers');
    const response = await invokeWithTracking(
      llm,
      [{ role: 'user', content: prompt }],
      state as any,
      { temperature: 0.3, maxTokens: 800 }
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

      return {
        errorFiles: Array.isArray(parsed.errorFiles) ? parsed.errorFiles : [],
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
        references
      };
    }
  } catch (error) {
    console.warn(`⚠️  Keyword generation failed:`, error);
  }

  return {
    errorFiles: [],
    keywords: task.name.toLowerCase().split(' ').filter(w => w.length > 3),
    references: new Map()
  };
}

/**
 * Display keywords in Chat UI
 */
export async function displayKeywords(taskKeywords: TaskKeywords): Promise<void> {
  console.log(`\n🔍 [displayKeywords] Starting Chat UI update...`);
  console.log(`   Error files: ${taskKeywords.errorFiles.length}`);
  console.log(`   Semantic keywords: ${taskKeywords.keywords.length}`);
  
  const chatAPI = getChatAPIClient();
  
  if (taskKeywords.errorFiles.length === 0 && taskKeywords.keywords.length === 0) {
    console.log(`   ⊖ No keywords to display, skipping Chat UI update`);
    return;
  }
  
  const errorFilesCount = taskKeywords.errorFiles.length;
  const semanticCount = taskKeywords.keywords.length;
  const totalCount = errorFilesCount + semanticCount;
  
  // Build summary for main display
  const parts: string[] = [];
  if (errorFilesCount > 0) {
    parts.push(`${errorFilesCount} error files`);
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
  if (taskKeywords.keywords.length > 0) {
    console.log(`   🔍 Keywords: ${taskKeywords.keywords.join(', ')}`);
  }
  if (taskKeywords.references.size > 0) {
    taskKeywords.references.forEach((kws, proj) => {
      console.log(`   ✅ Reference [${proj}]: ${kws.join(', ')}`);
    });
  }
}

