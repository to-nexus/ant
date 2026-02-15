/**
 * Reference Project Loader
 * 
 * Loads code context from reference projects
 */

import path from "path";
import { ArchitectGraphState } from "../../state";
import { getChatAPIClient } from "../../../../../../core/adapters/ChatAPIClient";

export async function loadReferenceContexts(
  state: ArchitectGraphState,
  taskKeywords: { errorFiles: string[]; keywords: string[]; references?: Map<string, string[]> },
  retriever: any,
  vectorDB: any,
  git: any,
  extractFilesFromCode: (code: string) => Array<{path: string; content: string}>
): Promise<any[]> {
  const contexts: any[] = [];
  const chatAPI = getChatAPIClient();
  
  if (!state.referenceRequests || state.referenceRequests.length === 0) {
    return contexts;
  }
  
  if (!taskKeywords.references || taskKeywords.references.size === 0) {
    return contexts;
  }
  
  const workspaceResolver = state.deps?.workspaceResolver;
  if (!workspaceResolver) {
    return contexts;
  }
  
  for (const ref of state.referenceRequests) {
    const keywords = taskKeywords.references.get(ref.project);
    if (!keywords || keywords.length === 0) {
      console.log(`   ⊖ No keywords for reference [${ref.project}], skipping`);
      continue;
    }
    
    try {
      const userContext = {
        userId: state.context.userId || 'local',
        organizationId: state.context.organizationId || 'local',
      };
      
      const refCodebasePath = workspaceResolver.getCodebasePath(userContext, ref.project);
      
      const refQuery = keywords.join(' ');
      console.log(`🔍 [Plan] Searching reference [${ref.project}] with: ${keywords.join(', ')}`);
      
      await chatAPI.showChatStatus('searching_reference', {
        project: ref.project,
        query: refQuery
      });
      
      const refResult = await retriever.retrieve(
        refQuery,
        refCodebasePath,
        { vectorDB, git },
        {
          project: ref.project,
          maxTokens: 15000,
          maxFiles: 5,
          mode: 'refactor'
        }
      );
      
      const files = extractFilesFromCode(refResult.code);
      
      contexts.push({
        project: ref.project,
        branch: ref.branch,
        files,
        stats: refResult.stats
      });
      
      console.log(`   ✅ Reference [${ref.project}]: ${refResult.stats.filesLoaded} files`);
      
      await chatAPI.showChatStatus('searched_reference', {
        project: ref.project,
        filesCount: files.length,
        filesList: files.map(f => f.path)
      });
    } catch (error: any) {
      console.warn(`⚠️  Failed to load reference [${ref.project}]:`, error);
      
      await chatAPI.showChatStatus('searched_reference', {
        project: ref.project,
        error: error.message || 'Unknown error'
      });
    }
  }
  
  return contexts;
}
