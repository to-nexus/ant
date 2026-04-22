/**
 * Utility functions for Plan node
 */

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
