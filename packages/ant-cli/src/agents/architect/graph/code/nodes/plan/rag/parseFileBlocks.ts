/**
 * `--- FILE: <path>\n<content>` block parser used by RAG retrieval paths
 * (`combine`, `semantic`).
 */
export function extractFilesFromCode(code: string): Array<{path: string; content: string}> {
  const files: Array<{path: string; content: string}> = [];
  const fileBlocks = code.split(/\n---\s+FILE:\s+/);

  for (let i = 1; i < fileBlocks.length; i++) {
    const block = fileBlocks[i];
    const firstLineEnd = block.indexOf('\n');
    if (firstLineEnd === -1) continue;

    const path = block.substring(0, firstLineEnd).trim();
    const content = block.substring(firstLineEnd + 1);

    if (path && content) {
      files.push({ path, content });
    }
  }

  return files;
}
