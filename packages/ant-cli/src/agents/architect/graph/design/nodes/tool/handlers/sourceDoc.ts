import { DesignGraphState } from '../../../state';
import { ArtifactPoolView } from '../../../../../../../core/prompt/builder/ArtifactPipeline';

/**
 * Handle read_source_doc tool — reads from artifact pool.
 * Supports optional startLine/endLine for selective reading of large documents.
 */
export function handleReadSourceFileFromState(
  state: DesignGraphState,
  args: { filename: string; startLine?: number; endLine?: number }
): string {
  const { filename, startLine, endLine } = args;
  const pool = new ArtifactPoolView(state.artifacts || []);
  const docs = pool.sourcesAsRecord();
  if (!docs[filename]) {
    const available = Object.keys(docs).length > 0 ? Object.keys(docs).join(', ') : 'none';
    return `Error: File "${filename}" not found. Available: ${available}`;
  }

  const content = docs[filename];
  const lines = content.split('\n');
  const totalLines = lines.length;

  if (startLine || endLine) {
    const start = Math.max(1, startLine || 1);
    const end = Math.min(totalLines, endLine || totalLines);
    const slice = lines.slice(start - 1, end).join('\n');
    return `[Lines ${start}-${end} of ${totalLines}]\n\n${slice}`;
  }

  return `[Total: ${totalLines} lines]\n\n${content}`;
}
