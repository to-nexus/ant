/**
 * list_files handler — context-injected version
 */

import type { ToolExecutionContext, ToolResult } from '../types';
import { resolveToolDirectory, prependFixMessage } from './pathResolver';

/**
 * Match one directory entry against the caller's `pattern`.
 *
 * `pattern` used to be a bare `String.includes`, while both the architect tool
 * catalog and the schema description advertised glob syntax (`pattern="*.tsx"`).
 * Every glob therefore matched NOTHING — `'Duck.glb'.includes('*')` is false — and
 * the handler returned an empty string with no error, which reads to the LLM as
 * "this directory is empty". A `list_files(dir, '*')` probe of a directory that
 * did contain the file it was looking for came back blank
 * (level-dashing-plumb).
 *
 * Both forms are now honored, discriminated by the presence of glob
 * metacharacters, so previously-working substring calls keep working.
 */
function matchesPattern(name: string, pattern: string): boolean {
  if (!/[*?[\]]/.test(pattern)) return name.includes(pattern);

  const source = pattern.replace(/[.+^${}()|\\]/g, '\\$&')
    .replace(/\[!(.*?)\]/g, '[^$1]')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');
  try {
    // Directories are listed with a trailing '/', so allow it to be implicit.
    return new RegExp(`^${source}/?$`).test(name);
  } catch {
    return name.includes(pattern);
  }
}

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
      ? itemsWithType.filter(f => matchesPattern(f, pattern))
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

    // An empty listing MUST say so. Returning '' hands the LLM a blank
    // tool_result that is indistinguishable from "the directory is empty" —
    // and, when a pattern filtered everything out, indistinguishable from
    // "the file you are looking for does not exist" (level-dashing-plumb).
    const body: string[] = filtered.length > 0
      ? filtered
      : [
          items.length === 0
            ? `(directory "${resolvedDir.displayPath || '.'}" exists but is empty)`
            : `(no entry matching ${JSON.stringify(pattern)} in "${resolvedDir.displayPath || '.'}" — ` +
              `${items.length} ${items.length === 1 ? 'entry' : 'entries'} present; re-run without a pattern to see them)`,
        ];

    const resultArr = resolvedDir.wasFixed && resolvedDir.fixMessage
      ? [resolvedDir.fixMessage, ...body]
      : body;

    // Orientation for workspace-root listings: name where code vs artifacts
    // live so the agent doesn't assume the whole workspace is codebase/.
    if (resolvedDir.fsPath === '.') {
      resultArr.unshift(
        'Workspace root — code lives under codebase/; sibling artifact dirs (plan/ architecture/ visual/ assets/ meta/) hold PRD, design docs, and user-placed asset files.',
      );
    }

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
