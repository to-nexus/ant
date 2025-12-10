/**
 * EditOperations - Handle file editing with search/replace
 */

export interface EditOperation {
  filePath: string;
  searchContent: string;
  replaceContent: string;
}

/**
 * Apply search/replace edit to file content
 * Returns modified content or throws error if search block not found
 */
export function applySearchReplace(
  originalContent: string,
  searchContent: string,
  replaceContent: string,
  filePath: string
): string {
  // Exact match
  if (originalContent.includes(searchContent)) {
    const modifiedContent = originalContent.replace(searchContent, replaceContent);
    console.log(`✅ [Edit] Applied search/replace to ${filePath}`);
    console.log(`   Replaced ${searchContent.length} chars with ${replaceContent.length} chars`);
    return modifiedContent;
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
  throw new Error(errorMsg);
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
