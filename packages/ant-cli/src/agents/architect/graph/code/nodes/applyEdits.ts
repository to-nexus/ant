/**
 * ============================================================================
 * Edit Application Utility
 * ============================================================================
 * 
 * Applies search/replace edit instructions to file contents.
 * Supports exact matching and fuzzy matching (whitespace normalization).
 */

import type { EditInstruction } from './parseResponse';

/**
 * Applies a single edit instruction to file content
 * 
 * @param originalContent - The original file content
 * @param edit - The edit instruction (search/replace)
 * @returns Updated file content
 * @throws Error if search pattern not found
 */
export function applyEditToFile(
  originalContent: string,
  edit: EditInstruction
): string {
  const { search, replace } = edit;
  
  // ✅ Safety check: Handle null/undefined content
  if (!originalContent || originalContent === null || originalContent === undefined) {
    throw new Error(
      `File content is null or undefined. File might not exist or failed to read.`
    );
  }
  
  // Strategy 1: Exact match (preferred)
  if (originalContent.includes(search)) {
    console.log(`   ✅ Exact match found`);
    return originalContent.replace(search, replace);
  }
  
  // Strategy 2: Fuzzy match (normalize whitespace)
  // This handles cases where indentation or line breaks differ slightly
  const normalizedOriginal = normalizeWhitespace(originalContent);
  const normalizedSearch = normalizeWhitespace(search);
  
  if (normalizedOriginal.includes(normalizedSearch)) {
    console.log(`   ✅ Fuzzy match found (whitespace normalized)`);
    
    // Find the start position in normalized content
    const normalizedStartIdx = normalizedOriginal.indexOf(normalizedSearch);
    
    // Map back to original content position
    const originalStartIdx = mapNormalizedToOriginal(
      originalContent,
      normalizedStartIdx
    );
    
    const originalEndIdx = mapNormalizedToOriginal(
      originalContent,
      normalizedStartIdx + normalizedSearch.length
    );
    
    // Replace in original content preserving original whitespace around it
    return (
      originalContent.slice(0, originalStartIdx) +
      replace +
      originalContent.slice(originalEndIdx)
    );
  }
  
  // Strategy 3: Line-based fuzzy match (for small differences)
  const lineMatch = findLineBasedMatch(originalContent, search);
  if (lineMatch !== null) {
    console.log(`   ✅ Line-based match found`);
    return (
      originalContent.slice(0, lineMatch.start) +
      replace +
      originalContent.slice(lineMatch.end)
    );
  }
  
  // No match found
  throw new Error(
    `Search pattern not found in file.\n\n` +
    `Expected to find:\n${search.slice(0, 200)}${search.length > 200 ? '...' : ''}\n\n` +
    `File content (first 500 chars):\n${originalContent.slice(0, 500)}...`
  );
}

/**
 * Normalizes whitespace for fuzzy matching
 * - Converts all whitespace sequences to single spaces
 * - Trims leading/trailing whitespace
 */
function normalizeWhitespace(content: string): string {
  return content.replace(/\s+/g, ' ').trim();
}

/**
 * Maps a position in normalized content back to original content
 * 
 * This is complex because we need to account for whitespace differences.
 * We count non-whitespace characters to find the corresponding position.
 */
function mapNormalizedToOriginal(
  originalContent: string,
  normalizedPosition: number
): number {
  let nonWhitespaceCount = 0;
  let i = 0;
  
  // Skip leading whitespace in original
  while (i < originalContent.length && /\s/.test(originalContent[i])) {
    i++;
  }
  
  // Count non-whitespace characters until we reach normalizedPosition
  while (
    nonWhitespaceCount < normalizedPosition &&
    i < originalContent.length
  ) {
    if (!/\s/.test(originalContent[i])) {
      nonWhitespaceCount++;
    }
    i++;
  }
  
  return i;
}

/**
 * Attempts to find a match by comparing line-by-line with some tolerance
 * Returns { start, end } indices if found, null otherwise
 */
function findLineBasedMatch(
  content: string,
  search: string
): { start: number; end: number } | null {
  const contentLines = content.split('\n');
  const searchLines = search.split('\n');
  
  // Need at least one line to match
  if (searchLines.length === 0) return null;
  
  // Try to find a sequence of lines that match (with normalized whitespace)
  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    let matches = true;
    
    for (let j = 0; j < searchLines.length; j++) {
      const contentLine = normalizeWhitespace(contentLines[i + j]);
      const searchLine = normalizeWhitespace(searchLines[j]);
      
      if (contentLine !== searchLine) {
        matches = false;
        break;
      }
    }
    
    if (matches) {
      // Calculate start and end indices
      const start = contentLines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
      const end = contentLines.slice(0, i + searchLines.length).join('\n').length;
      return { start, end };
    }
  }
  
  return null;
}

/**
 * Applies multiple edits to a file
 * Edits are applied in order, so later edits work on the result of earlier ones
 * 
 * @param originalContent - The original file content
 * @param edits - Array of edit instructions for the same file
 * @returns Updated file content
 */
export function applyMultipleEdits(
  originalContent: string,
  edits: EditInstruction[]
): string {
  let content = originalContent;
  
  for (let i = 0; i < edits.length; i++) {
    try {
      content = applyEditToFile(content, edits[i]);
      console.log(`   ✅ Applied edit ${i + 1}/${edits.length}`);
    } catch (error) {
      throw new Error(
        `Failed to apply edit ${i + 1}/${edits.length}: ${(error as Error).message}`
      );
    }
  }
  
  return content;
}

