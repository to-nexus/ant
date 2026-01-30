/**
 * Ask System
 * 
 * Handles questions about the Ant system itself.
 * Uses static knowledge and workspace state to provide contextual answers.
 * 
 * Scope:
 * - ✅ Ant usage, jobs, prerequisites, workflow
 * - ❌ Project codebase questions (redirect to Code Job)
 * - ❌ General knowledge (out of scope)
 */

import { AskContext, AskResponse, AskDependencies } from './types.js';
import { AskResponseGenerator, askResponseGenerator } from './AskResponseGenerator.js';
import { WorkspaceState } from '../../agents/common/nodes/triage/types.js';
import { LLMClient } from '../ports/llm.js';

export type { AskContext, AskResponse, AskDependencies } from './types.js';
export { AskResponseGenerator, askResponseGenerator } from './AskResponseGenerator.js';

/**
 * Process an ask request
 * 
 * @param question - User's question
 * @param workspaceState - Current workspace state (from Triage)
 * @param deps - Dependencies (LLM)
 * @param options - Additional options
 */
export async function processAskRequest(
  question: string,
  workspaceState: WorkspaceState,
  deps: { llm: LLMClient },
  options?: {
    currentJob?: string;
    currentAgent?: string;
    language?: 'ko' | 'en';
  }
): Promise<AskResponse> {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('💬 ASK SYSTEM');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  console.log(`📝 Question: ${question}`);
  console.log(`🌐 Language: ${options?.language || detectLanguage(question)}`);
  console.log('');
  
  const context: AskContext = {
    userQuestion: question,
    workspaceState,
    currentJob: options?.currentJob,
    currentAgent: options?.currentAgent,
    language: options?.language || detectLanguage(question),
  };
  
  const response = await askResponseGenerator.generate(context, deps);
  
  console.log('📤 Response generated');
  console.log(`   In-scope: ${response.inScope}`);
  if (response.suggestions?.length) {
    console.log(`   Suggestions: ${response.suggestions.length}`);
  }
  console.log('');
  
  return response;
}

/**
 * Detect language from text
 */
function detectLanguage(text: string): 'ko' | 'en' {
  // Simple Korean detection (contains Hangul)
  const hasKorean = /[\uAC00-\uD7AF]/.test(text);
  return hasKorean ? 'ko' : 'en';
}

/**
 * Quick helper to check if a question is about Ant system
 * (For pre-filtering before full Ask processing)
 */
export function isLikelyAskQuestion(question: string): boolean {
  const askKeywords = [
    // English
    'ant', 'how', 'what', 'why', 'when', 'which', 'help',
    'design job', 'code job', 'learn job',
    'prerequisite', 'input', 'output', 'workflow',
    // Korean
    '뭐', '어떻게', '왜', '언제', '어디', '필요',
    '디자인잡', '코드잡', '런잡',
    '준비물', '입력', '출력', '워크플로우',
  ];
  
  const lowerQuestion = question.toLowerCase();
  return askKeywords.some(kw => lowerQuestion.includes(kw.toLowerCase()));
}
