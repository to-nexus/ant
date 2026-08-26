/**
 * EditOperations - Handle file editing with search/replace
 */

import { toNfc } from '../../../utils/unicodePath';

export interface EditOperation {
  filePath: string;
  searchContent: string;
  replaceContent: string;
}

/**
 * NFC/NFD-tolerant fallback for the exact-match miss path: macOS-uploaded
 * files carry NFD Hangul/accents on disk while the model re-emits NFC —
 * visually identical, byte-different, so `includes()` can never match.
 * Finds the UNIQUE full-line span whose per-line NFC form equals the search
 * block's, then splices by character offsets so every byte outside the span
 * is preserved verbatim. 0 or ≥2 candidate spans → `null` (fail-closed; the
 * ambiguity means the model's bytes cannot be trusted to pick an occurrence).
 */
function tryNfcLineSpanReplace(
  original: string,
  search: string,
  replacement: string,
): string | null {
  let searchLines = search.split('\n');
  let consumeTrailingNewline = false;
  if (searchLines.length > 1 && searchLines[searchLines.length - 1] === '') {
    searchLines = searchLines.slice(0, -1);
    consumeTrailingNewline = true;
  }
  if (searchLines.length === 0 || searchLines.every(l => l.length === 0)) return null;

  const origLines = original.split('\n');
  if (searchLines.length > origLines.length) return null;

  const searchNfc = searchLines.map(toNfc);
  const origNfc = origLines.map(toNfc);

  let matchIndex = -1;
  for (let i = 0; i + searchNfc.length <= origNfc.length; i++) {
    let matches = true;
    for (let j = 0; j < searchNfc.length; j++) {
      if (origNfc[i + j] !== searchNfc[j]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      if (matchIndex !== -1) return null;
      matchIndex = i;
    }
  }
  if (matchIndex === -1) return null;

  let startOffset = 0;
  for (let i = 0; i < matchIndex; i++) startOffset += origLines[i].length + 1;
  let endOffset = startOffset;
  for (let j = 0; j < searchNfc.length; j++) {
    endOffset += origLines[matchIndex + j].length + (j > 0 ? 1 : 0);
  }
  if (consumeTrailingNewline) {
    if (original[endOffset] !== '\n') return null;
    endOffset += 1;
  }

  return original.slice(0, startOffset) + replacement + original.slice(endOffset);
}

/**
 * Apply search/replace edit to file content
 * Returns modified content or throws error if search block not found
 */
export function applySearchReplace(
  originalContent: string,
  searchContent: string,
  replaceContent: string,
  filePath: string,
  onFallbackNote?: (note: string) => void
): string {
  // Exact match
  if (originalContent.includes(searchContent)) {
    const modifiedContent = originalContent.replace(searchContent, replaceContent);
    console.log(`✅ [Edit] Applied search/replace to ${filePath}`);
    console.log(`   Replaced ${searchContent.length} chars with ${replaceContent.length} chars`);
    return modifiedContent;
  }

  // NFC/NFD normalization tolerance — only when normalization is actually in
  // play (byte-exact successes above are untouched; ASCII/NFC-only misses fall
  // straight through to the error path).
  if (toNfc(searchContent) !== searchContent || toNfc(originalContent) !== originalContent) {
    const spliced = tryNfcLineSpanReplace(originalContent, searchContent, replaceContent);
    if (spliced !== null) {
      console.log(`⚠️ [Edit] Applied NFC-tolerant search/replace to ${filePath} (on-disk content is NFD-normalized)`);
      onFallbackNote?.(
        'Note: old_str matched via Unicode NFC/NFD normalization tolerance — this file\'s content is NFD-encoded on disk. ' +
        'For future edits, copy old_str exactly from read_file output.'
      );
      return spliced;
    }
  }

  // If exact match fails, provide helpful error
  const searchLines = searchContent.split('\n');
  const contentLines = originalContent.split('\n');
  
  // Try to find similar lines for better error message
  const firstSearchLine = searchLines[0]?.trim();
  const matchingLineNumbers: number[] = [];
  
  contentLines.forEach((line, index) => {
    if (line.trim() === firstSearchLine) {
      matchingLineNumbers.push(index + 1);
    }
  });
  
  let errorMsg = `❌ [Edit] Search block not found in ${filePath}\n\n`;
  errorMsg += `🔍 Search block (${searchLines.length} lines, ${searchContent.length} chars):\n`;
  errorMsg += `────────────────────────────────────────\n`;
  errorMsg += searchContent.substring(0, 500);
  if (searchContent.length > 500) errorMsg += '\n... (truncated)';
  errorMsg += `\n────────────────────────────────────────\n\n`;
  
  if (matchingLineNumbers.length > 0) {
    errorMsg += `💡 Found similar first line at line(s): ${matchingLineNumbers.join(', ')}\n`;
    errorMsg += `   Possible causes:\n`;
    errorMsg += `   - Whitespace mismatch (spaces vs tabs)\n`;
    errorMsg += `   - Missing/extra lines in search block\n`;
    errorMsg += `   - File was already modified in previous edit\n`;
    errorMsg += `   - Search block contains outdated code\n\n`;
  } else {
    errorMsg += `💡 First line "${firstSearchLine}" not found in file\n`;
    errorMsg += `   The search block may be completely outdated or wrong\n\n`;
  }
  
  errorMsg += `📄 Current file content (first 1000 chars):\n`;
  errorMsg += `────────────────────────────────────────\n`;
  errorMsg += originalContent.substring(0, 1000);
  if (originalContent.length > 1000) errorMsg += '\n... (truncated)';
  errorMsg += `\n────────────────────────────────────────\n\n`;
  
  errorMsg += `⚠️  This error means the file content has changed since the LLM last saw it.\n`;
  errorMsg += `💡 Solution: LLM should read the file again before attempting to edit it.`;
  
  console.error(errorMsg);
  
  // ✅ Throw simple error (detailed log already printed to console)
  throw new Error(`Search block not found in ${filePath}`);
}

/**
 * Manage edit operations for multiple files
 */
export class EditOperationManager {
  private operations: Map<string, EditOperation> = new Map();
  
  /**
   * Initialize edit operation for a file
   */
  initEdit(filePath: string): void {
    this.operations.set(filePath, {
      filePath,
      searchContent: '',
      replaceContent: ''
    });
  }
  
  /**
   * Add search content to edit operation
   */
  addSearchContent(filePath: string, content: string): void {
    const op = this.operations.get(filePath);
    if (op) {
      op.searchContent += content;
    }
  }
  
  /**
   * Add replace content to edit operation
   */
  addReplaceContent(filePath: string, content: string): void {
    const op = this.operations.get(filePath);
    if (op) {
      op.replaceContent += content;
    }
  }
  
  /**
   * Get edit operation for a file
   */
  getOperation(filePath: string): EditOperation | undefined {
    return this.operations.get(filePath);
  }
  
  /**
   * Delete edit operation
   */
  deleteOperation(filePath: string): void {
    this.operations.delete(filePath);
  }
  
  /**
   * Clear all operations
   */
  clear(): void {
    this.operations.clear();
  }
}
