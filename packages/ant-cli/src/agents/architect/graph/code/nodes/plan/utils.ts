/**
 * Utility functions for Plan node
 */

/**
 * Extract files read during Plan's tool loop from planConversationHistory.
 *
 * Scans assistant messages for read_file tool_use blocks, matches them with
 * corresponding tool_result blocks in the next user message, and returns
 * deduplicated file entries suitable for merging into projectCodeContext.
 */
export function extractFilesFromPlanToolLoop(
  history: Array<{ role: string; content: string | any[] }>,
  existingPaths: Set<string>,
): Array<{ path: string; content: string; source: 'plan_tool_loop' }> {
  const files: Array<{ path: string; content: string; source: 'plan_tool_loop' }> = [];
  const seenPaths = new Set<string>();

  for (let i = 0; i < history.length; i++) {
    const msg = history[i];
    if (msg.role !== 'assistant' || typeof msg.content === 'string') continue;

    // Collect read_file tool_use blocks from assistant message
    const readFileUses = new Map<string, string>(); // tool_use_id → path
    for (const block of msg.content) {
      if (block.type === 'tool_use' && block.name === 'read_file' && block.input?.path) {
        readFileUses.set(block.id, block.input.path);
      }
    }
    if (readFileUses.size === 0) continue;

    // Find corresponding tool_result in next user message
    const nextMsg = history[i + 1];
    if (!nextMsg || nextMsg.role !== 'user' || typeof nextMsg.content === 'string') continue;

    for (const block of nextMsg.content) {
      if (block.type !== 'tool_result') continue;
      const filePath = readFileUses.get(block.tool_use_id);
      if (!filePath) continue;

      // Skip if already in RAG context or already extracted
      if (existingPaths.has(filePath) || seenPaths.has(filePath)) continue;

      const content = typeof block.content === 'string'
        ? block.content
        : Array.isArray(block.content)
          ? block.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
          : '';

      if (content && !content.startsWith('Error:')) {
        files.push({ path: filePath, content, source: 'plan_tool_loop' });
        seenPaths.add(filePath);
      }
    }
  }

  return files;
}

/**
 * Compute CodeGen call budget from planText based on action types.
 * create actions cost ~1 call (<file> tag), modify actions cost ~3 calls (read + edit + retry margin).
 * Returns undefined if planText cannot be parsed (caller should use default budget).
 */
export function computeBudgetFromPlanText(planText: string): number | undefined {
  try {
    const parsed = JSON.parse(planText);
    const impl = parsed.implementation;
    if (!impl) return undefined;

    const createCount = Array.isArray(impl.create) ? impl.create.length : 0;
    const modifyCount = Array.isArray(impl.modify) ? impl.modify.length : 0;

    if (createCount === 0 && modifyCount === 0) return undefined;

    const budget = createCount * 1 + modifyCount * 3;
    // Minimum floor of 10 to allow for overhead (imports, wiring, etc.)
    return Math.max(budget, 10);
  } catch {
    return undefined;
  }
}

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
