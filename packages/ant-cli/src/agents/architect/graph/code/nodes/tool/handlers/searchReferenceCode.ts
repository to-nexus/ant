/**
 * Handle search_reference_code tool
 * Search reference project using vector DB semantic search
 */

import path from 'path';
import { ArchitectGraphState } from '../../../state';
import { getChatAPIClient } from '../../../../../../../core/adapters/ChatAPIClient';
import { SearchReferenceCodeArgs } from '../types';

export async function handleSearchReferenceCode(
  state: ArchitectGraphState,
  args: SearchReferenceCodeArgs
): Promise<string> {
  const { project, query, maxFiles = 5 } = args;
  
  console.log(`   🔍 Searching reference project: ${project}`);
  console.log(`   Query: "${query}"`);
  
  const chatAPI = getChatAPIClient();
  
  try {
    // 1. Check if this reference project was registered
    const refRequest = state.referenceRequests?.find(r => r.project === project);
    if (!refRequest) {
      return `❌ ERROR: Reference project "${project}" was not registered.

Available reference projects: ${state.referenceRequests?.map(r => r.project).join(', ') || 'none'}

Please mention the reference project in your directive to register it.`;
    }
    
    // 2. Check dependencies
    if (!state.deps?.retriever || !state.deps?.vectorDB || !state.deps?.git || !state.deps?.workspaceResolver) {
      throw new Error('Required dependencies not available (retriever, vectorDB, git, workspaceResolver)');
    }
    
    // 3. UI: Show searching status
    await chatAPI.showChatStatus('searching_reference', {
      project: project,
      query: query
    });
    
    // 4. Resolve reference project path using WorkspaceResolver
    const userContext = {
      userId: state.context.userId || 'local',
      organizationId: state.context.organizationId || 'local',
    };
    
    const refCodebasePath = state.deps.workspaceResolver.getCodebasePath(userContext, project);
    
    // 5. Search vector DB using CodebaseRetriever
    const searchResult = await state.deps.retriever.retrieve(
      query,
      refCodebasePath,
      { git: state.deps.git, vectorDB: state.deps.vectorDB },
      {
        maxFiles: Math.min(maxFiles, 10),  // Cap at 10
        maxTokens: 15000,  // Reasonable limit
        mode: state.detectionReport?.jobMode || 'generate'
      }
    );
    
    if (!searchResult.code || searchResult.code.trim().length === 0) {
      console.log(`   ⚠️  No relevant code found in ${project}\n`);
      
      // UI: Show search failed
      await chatAPI.showChatStatus('searched_reference', {
        project: project,
        filesCount: 0,
        error: 'No relevant code found'
      });
      
      return `⚠️  No relevant code found in reference project "${project}" for query: "${query}"

Try:
- Using different keywords
- Being more specific about what you need
- Searching for broader concepts (e.g., "API endpoints" instead of specific method names)`;
    }
    
    console.log(`   Retrieved ${searchResult.stats.filesLoaded} relevant files (${searchResult.stats.estimatedTokens} tokens)\n`);
    
    // 5. Update UI: Show search complete + explored files
    const filesList = searchResult.files?.map((f: any) => `[${project}] ${f.path}`) || [];
    
    await chatAPI.showChatStatus('searched_reference', {
      project: project,
      filesCount: searchResult.stats.filesLoaded
    });
    
    // ✅ Show explored files from reference project (with exploring first for proper merge)
    if (filesList.length > 0) {
      await chatAPI.showChatStatus('exploring', {
        filesCount: 0,
        totalFiles: 0
      });
      await chatAPI.showChatStatus('explored', {
        filesCount: searchResult.stats.filesLoaded,
        filesList: filesList
      });
    }
    
    // 6. Format result
    return `Retrieved ${searchResult.stats.filesLoaded} relevant file(s) in "${project}":

${searchResult.code}

**Note:** This code is from the reference project "${project}". Use it to understand APIs, data structures, and implementation patterns. Do NOT modify these files.`;
    
  } catch (error) {
    const errorMessage = (error as Error).message;
    console.error(`   ❌ Failed to search reference project: ${errorMessage}\n`);
    
    return `❌ ERROR: Failed to search reference project "${project}"
Query: "${query}"
Error: ${errorMessage}`;
  }
}

