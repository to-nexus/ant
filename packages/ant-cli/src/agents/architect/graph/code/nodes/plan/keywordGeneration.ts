/**
 * Keyword Generation for Plan Node
 * 
 * Generates task-specific keywords for:
 * - Stack trace files (exact paths from error traces)
 * - Semantic keywords (context for understanding)
 * - Reference project keywords
 */

import { LLMClient } from "../../../../../../core/ports";
import { ArchitectGraphState, Task } from "../../state";
import { getChatAPIClient } from "../../../../../../core/adapters/ChatAPIClient";

export interface TaskKeywords {
  stackTrace: string[];
  keywords: string[];
  references: Map<string, string[]>;
}

/**
 * Generate task-specific keywords using LLM
 */
export async function generateTaskKeywords(
  llm: LLMClient,
  task: Task,
  state: ArchitectGraphState
): Promise<TaskKeywords> {
  const promptEngine = state.deps?.promptEngine;
  if (!promptEngine) {
    console.warn('[Plan] PromptEngine not available, using fallback keywords');
    return {
      stackTrace: [],
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
    const response = await llm.invoke([
      { role: 'user', content: prompt }
    ], {
      temperature: 0.3,
      maxTokens: 800
    });

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
        stackTrace: Array.isArray(parsed.stackTrace) ? parsed.stackTrace : [],
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
        references
      };
    }
  } catch (error) {
    console.warn(`⚠️  Keyword generation failed:`, error);
  }

  return {
    stackTrace: [],
    keywords: task.name.toLowerCase().split(' ').filter(w => w.length > 3),
    references: new Map()
  };
}

/**
 * Display keywords in Chat UI
 */
export async function displayKeywords(taskKeywords: TaskKeywords): Promise<void> {
  const chatAPI = getChatAPIClient();
  
  if (taskKeywords.stackTrace.length === 0 && taskKeywords.keywords.length === 0) {
    return;
  }
  
  let keywordDisplay = '**Analyzed:** 🔑 Search Keywords Generated\n\n';
  
  if (taskKeywords.stackTrace.length > 0) {
    keywordDisplay += `📍 **Stack Trace Files** (${taskKeywords.stackTrace.length}):\n`;
    keywordDisplay += taskKeywords.stackTrace.map(f => `  • ${f}`).join('\n');
    keywordDisplay += '\n\n';
  }
  
  if (taskKeywords.keywords.length > 0) {
    keywordDisplay += `🔍 **Semantic Keywords** (${taskKeywords.keywords.length}):\n`;
    keywordDisplay += taskKeywords.keywords.map(k => `  • ${k}`).join('\n');
  }
  
  await chatAPI.showChatStatus('analyzed', {
    content: keywordDisplay,
    keywordCount: taskKeywords.stackTrace.length + taskKeywords.keywords.length,
    stackTraceCount: taskKeywords.stackTrace.length,
    semanticCount: taskKeywords.keywords.length
  });
}

/**
 * Log keywords to console
 */
export function logKeywords(taskKeywords: TaskKeywords): void {
  if (taskKeywords.stackTrace.length > 0) {
    console.log(`   📍 Stack trace: ${taskKeywords.stackTrace.join(', ')}`);
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

