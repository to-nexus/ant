/**
 * search_reference_code handler — context-injected version
 */

import type { ToolExecutionContext, ToolResult } from '../types';

export async function handleSearchReferenceCode(
  ctx: ToolExecutionContext,
  args: { project: string; query: string; maxFiles?: number },
): Promise<ToolResult> {
  const { project, query, maxFiles = 5 } = args;
  let searchingIndex: string | undefined;

  console.log(`   🔍 Searching reference project: ${project}`);
  console.log(`   Query: "${query}"`);

  try {
    const refRequest = ctx.referenceRequests?.find((r: any) => r.project === project);
    if (!refRequest) {
      const content = `❌ ERROR: Reference project "${project}" was not registered.\n\nAvailable reference projects: ${ctx.referenceRequests?.map((r: any) => r.project).join(', ') || 'none'}\n\nPlease mention the reference project in your directive to register it.`;
      return { content };
    }

    if (!ctx.retriever || !ctx.vectorDB || !ctx.git || !ctx.workspaceResolver) {
      const msg = 'Required dependencies not available (retriever, vectorDB, git, workspaceResolver)';
      return { content: msg, error: msg };
    }

    searchingIndex = await ctx.chatStatus.showStatus('searching_reference', { project, query });

    const userContext = {
      userId: ctx.userId || 'local',
      organizationId: ctx.organizationId || 'local',
    };

    const refCodebasePath = ctx.workspaceResolver.getCodebasePath(userContext, project);

    const searchResult = await ctx.retriever.retrieve(
      query,
      refCodebasePath,
      { git: ctx.git, vectorDB: ctx.vectorDB },
      {
        maxFiles: Math.min(maxFiles, 10),
        maxTokens: 15000,
        mode: ctx.resolvedActionMode || 'generate',
      },
    );

    if (!searchResult.code || searchResult.code.trim().length === 0) {
      console.log(`   ⚠️  No relevant code found in ${project}\n`);
      await ctx.chatStatus.showStatus('searched_reference', {
        project,
        filesCount: 0,
        error: 'No relevant code found',
        _mergeIndex: searchingIndex,
      });

      const content = `⚠️  No relevant code found in reference project "${project}" for query: "${query}"\n\nTry:\n- Using different keywords\n- Being more specific about what you need\n- Searching for broader concepts`;
      return { content };
    }

    console.log(`   Retrieved ${searchResult.stats.filesLoaded} relevant files (${searchResult.stats.estimatedTokens} tokens)\n`);

    const filesList = searchResult.files?.map((f: any) => `[${project}] ${f.path}`) || [];

    await ctx.chatStatus.showStatus('searched_reference', {
      project,
      filesCount: searchResult.stats.filesLoaded,
      _mergeIndex: searchingIndex,
    });

    if (filesList.length > 0) {
      const exploringIndex = await ctx.chatStatus.showStatus('exploring', { filesCount: 0, totalFiles: 0 });
      await ctx.chatStatus.showStatus('explored', {
        filesCount: searchResult.stats.filesLoaded,
        filesList,
        _mergeIndex: exploringIndex,
      });
    }

    const content = `Retrieved ${searchResult.stats.filesLoaded} relevant file(s) in "${project}":\n\n${searchResult.code}\n\n**Note:** This code is from the reference project "${project}". Use it to understand APIs, data structures, and implementation patterns. Do NOT modify these files.`;
    return { content };
  } catch (e) {
    const errorMsg = (e as Error).message;
    console.error(`   ❌ Failed to search reference project: ${errorMsg}\n`);
    try {
      await ctx.chatStatus.showStatus('searched_reference', {
        project,
        filesCount: 0,
        error: errorMsg,
        _mergeIndex: searchingIndex,
      });
    } catch (statusErr) {
      console.warn('   ⚠️  Failed to emit searched_reference error status:', statusErr);
    }
    return {
      content: `❌ ERROR: Failed to search reference project "${project}"\nQuery: "${query}"\nError: ${errorMsg}`,
      error: errorMsg,
    };
  }
}
