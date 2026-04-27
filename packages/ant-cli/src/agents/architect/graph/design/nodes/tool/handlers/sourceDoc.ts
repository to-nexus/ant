/**
 * read_source_doc handler (design-only, ctx-pure).
 *
 * Reads from the artifact pool (`ctx.sourceDocuments`) populated by
 * design `loadResolvedArtifacts`. The artifact pool is a RAC-scoped
 * subset of disk content already loaded into memory — bypassing it for a
 * fresh `read_file` would re-load already-resolved documents.
 *
 * Wraps a `read_source` chat status pair (`addReadingSource` →
 * `addReadSourceComplete`) so the chat UI shows the request as a source
 * read, not a generic file read.
 */

import type { ToolExecutionContext, ToolResult } from '../../../../../../common/tool/types';
import { ArtifactPoolView } from '../../../../../../../core/prompt/builder/ArtifactPipeline';

export async function handleReadSourceDoc(
  ctx: ToolExecutionContext,
  args: { filename: string; startLine?: number; endLine?: number },
): Promise<ToolResult> {
  const { filename, startLine, endLine } = args;

  if (!filename) {
    const msg = 'read_source_doc requires filename';
    return { content: msg, error: msg };
  }

  const readIdx = await ctx.chatStatus.addReadingSource(filename, startLine, endLine);

  const pool = new ArtifactPoolView(ctx.sourceDocuments || []);
  const docs = pool.sourcesAsRecord();

  if (!docs[filename]) {
    const available = Object.keys(docs).length > 0 ? Object.keys(docs).join(', ') : 'none';
    const errMsg = `File "${filename}" not found. Available: ${available}`;
    await ctx.chatStatus.addReadSourceComplete(filename, readIdx, {
      error: errMsg, startLine, endLine,
    });
    return { content: `Error: ${errMsg}`, error: errMsg };
  }

  const content = docs[filename];
  const lines = content.split('\n');
  const totalLines = lines.length;

  await ctx.chatStatus.addReadSourceComplete(filename, readIdx, {
    startLine, endLine, totalLines,
  });

  if (startLine || endLine) {
    const start = Math.max(1, startLine || 1);
    const end = Math.min(totalLines, endLine || totalLines);
    const slice = lines.slice(start - 1, end).join('\n');
    return { content: `[Lines ${start}-${end} of ${totalLines}]\n\n${slice}` };
  }

  return { content: `[Total: ${totalLines} lines]\n\n${content}` };
}
