/**
 * Prompt Building for DetectEnvironment Node
 */

import { ArchitectGraphState } from "../../state";

export async function buildDetectPrompt(state: ArchitectGraphState): Promise<string> {
  const promptEngine = state.deps?.promptEngine;
  if (!promptEngine) {
    throw new Error('[DetectEnvironment] PromptEngine not available');
  }
  
  const designDocs = state.designDocs 
    ? Object.keys(state.designDocs).filter(key => 
        state.designDocs![key as keyof typeof state.designDocs]
      )
    : [];
  
  return await promptEngine.buildDetectEnvironmentPrompt(
    state.directive || '',
    designDocs,
    state.profile
  );
}
