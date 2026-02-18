/**
 * Response Cleaners
 * 
 * Shared utilities for cleaning LLM responses before storing in conversation history.
 * Replaces file content XML tags with compact markers so the LLM retains awareness
 * of which files were written without bloating the context window.
 */

/**
 * Replace file content XML tags with `[file written to disk: path]` markers.
 * Used by all three conversation history paths (conflict, no-done, tool-call)
 * to ensure the LLM knows which files are already saved.
 */
export function cleanFileContentFromResponse(text: string): string {
  let cleaned = text;
  // Pass 1: Extract file paths from well-formed tags
  cleaned = cleaned.replace(/<file\s[^>]*path="([^"]*)"[^>]*>[\s\S]*?<\/file>/g, '[file written to disk: $1]');
  cleaned = cleaned.replace(/<edit\s[^>]*path="([^"]*)"[^>]*>[\s\S]*?<\/edit>/g, '[file edited: $1]');
  cleaned = cleaned.replace(/<append\s[^>]*path="([^"]*)"[^>]*>[\s\S]*?<\/append>/g, '[file appended: $1]');
  // Pass 2: Safety net for malformed tags that Pass 1 didn't match
  cleaned = cleaned.replace(/<file[^>]*>[\s\S]*?<\/file>/g, '[file creation removed]');
  cleaned = cleaned.replace(/<edit[^>]*>[\s\S]*?<\/edit>/g, '[code edit removed]');
  cleaned = cleaned.replace(/<append[^>]*>[\s\S]*?<\/append>/g, '[code append removed]');
  return cleaned.trim();
}

/**
 * Variant for the conflict path: marks conflicting files differently from successful ones.
 */
export function cleanFileContentWithConflicts(text: string, conflictPaths: Set<string>): string {
  let cleaned = text;
  cleaned = cleaned.replace(/<file\s[^>]*path="([^"]*)"[^>]*>[\s\S]*?<\/file>/g,
    (_match: string, filePath: string) => conflictPaths.has(filePath)
      ? `[file NOT written - conflict: ${filePath}]`
      : `[file written to disk: ${filePath}]`
  );
  cleaned = cleaned.replace(/<edit\s[^>]*path="([^"]*)"[^>]*>[\s\S]*?<\/edit>/g, '[file edited: $1]');
  cleaned = cleaned.replace(/<append\s[^>]*path="([^"]*)"[^>]*>[\s\S]*?<\/append>/g, '[file appended: $1]');
  cleaned = cleaned.replace(/<file[^>]*>[\s\S]*?<\/file>/g, '[file creation removed]');
  cleaned = cleaned.replace(/<edit[^>]*>[\s\S]*?<\/edit>/g, '[code edit removed]');
  cleaned = cleaned.replace(/<append[^>]*>[\s\S]*?<\/append>/g, '[code append removed]');
  return cleaned.trim();
}
