/**
 * list_files handler — context-injected version
 */

import type { ToolExecutionContext, ToolResult } from '../types';
import { resolveToolDirectory, prependFixMessage } from './pathResolver';

export async function handleListFiles(
  ctx: ToolExecutionContext,
  args: { directory?: string; pattern?: string },
): Promise<ToolResult> {
  const { directory = '.', pattern } = args;
  const fileSystem = ctx.fileSystem;

  const resolvedDir = await resolveToolDirectory(ctx, directory);

  const listingIndex = await ctx.chatStatus.showStatus('listing_files', {
    directory: resolvedDir.displayPath || '.',
    pattern,
  });

  try {
    console.log(`[listFiles] Listing directory: ${resolvedDir.displayPath} (fsPath: ${resolvedDir.fsPath}, pattern: ${pattern})`);

    const items = await fileSystem.readDirectory(resolvedDir.fsPath);
    const itemsWithType = items.map(item =>
      item.isDirectory ? `${item.name}/` : item.name,
    );

    const filtered = pattern
      ? itemsWithType.filter(f => f.includes(pattern))
      : itemsWithType;

    console.log(`[listFiles] Listed ${filtered.length} items in ${directory}`);

    if (filtered.length === 0) {
      if (listingIndex !== undefined) {
        await ctx.chatStatus.removeStatus(listingIndex, 'listing_files');
      }
    } else {
      await ctx.chatStatus.showStatus('listed_files', {
        filesCount: filtered.length,
        totalFiles: items.length,
        pattern,
        filesList: filtered.slice(0, 20),
        _mergeIndex: listingIndex,
      });
    }

    const resultArr = resolvedDir.wasFixed && resolvedDir.fixMessage
      ? [resolvedDir.fixMessage, ...filtered]
      : filtered;

    return { content: resultArr.join('\n') };
  } catch (e) {
    const errorMsg = (e as Error).message;
    console.error(`[listFiles] ❌ Error:`, errorMsg);
    if (listingIndex !== undefined) {
      try {
        await ctx.chatStatus.removeStatus(listingIndex, 'listing_files');
      } catch (removeErr) {
        console.warn('[listFiles] failed to remove listing_files status on error:', removeErr);
      }
    }
    return { content: `Error: ${errorMsg}`, error: errorMsg };
  }
}
