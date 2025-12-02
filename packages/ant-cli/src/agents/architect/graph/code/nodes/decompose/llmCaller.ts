/**
 * Decompose LLM Caller
 * 
 * Uses PromptEngine for template-based prompt building
 */

import { LLMClient } from "../../../../../../core/ports";

export interface DecomposePromptContext {
  directive: string;
  designDoc: string;
  hasDesignDoc: boolean;
  mode: string;
  profile: any;
  codebaseFilePaths?: string[];
  gitDiff?: {
    hasChanges: boolean;
    summary: string;
    changedFiles: Array<{
      path: string;
      status: string;
      additions: number;
      deletions: number;
    }>;
  };
}

/**
 * Build decompose prompt using PromptEngine
 */
export async function buildDecomposePrompt(
  promptEngine: any,
  context: DecomposePromptContext
): Promise<string> {
  if (!promptEngine) {
    throw new Error('[Decompose] PromptEngine not available');
  }
  
  return await promptEngine.buildDecomposePrompt(context);
}

/**
 * Call LLM for task decomposition
 */
export async function callLLMForDecompose(
  llm: LLMClient,
  prompt: string
): Promise<string> {
  console.log('🤖 [Decompose] Calling LLM for task breakdown...');
  
  const response = await llm.invoke([
    { role: 'user', content: prompt }
  ], {
    temperature: 0.3,
    maxTokens: 4000
  });
  
  return response;
}
