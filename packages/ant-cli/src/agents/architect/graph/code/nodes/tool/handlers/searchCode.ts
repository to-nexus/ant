/**
 * Handle search_code tool
 */

import { ArchitectGraphState } from '../../../state';
import { getChatAPIClient } from '../../../../../../../core/adapters/ChatAPIClient';
import { SearchCodeArgs } from '../types';
import { getFileSystem, withErrorHandling, logFileOperation, resolveToolDirectory } from './utils';

export async function handleSearchCode(
  state: ArchitectGraphState,
  args: SearchCodeArgs
): Promise<string> {
  const { pattern, file_pattern } = args;
  
  if (!pattern) {
    throw new Error('search_code requires pattern');
  }
  
  const fileSystem = getFileSystem(state, 'searchCode');
  const chatAPI = getChatAPIClient();

  // Default search root:
  // - code jobs: repo root (codebase)
  // - if user explicitly targets workspace paths (features/inputs/outputs/sessions), search from workspace root
  const wantsWorkspaceScope = (() => {
    const fp = (file_pattern || '').replace(/\\/g, '/').replace(/^\.?\//, '');
    return fp.startsWith('features/') || fp.startsWith('inputs/') || fp.startsWith('outputs/') || fp.startsWith('sessions/');
  })();
  const resolvedRoot = await resolveToolDirectory(state, wantsWorkspaceScope ? 'features' : '.');
  
  // UI: Show searching_code status
  const searchingIndex = await chatAPI.showChatStatus('searching_code', { 
    pattern, 
    file_pattern 
  });
  
  return withErrorHandling('searchCode', async () => {
    // Use FileSystemPort to list files
    logFileOperation('searchCode', 'Listing files', resolvedRoot.displayPath, { 
      fsPath: resolvedRoot.fsPath,
      excludes: ['node_modules', '.git', 'dist', 'build'] 
    });
    
    const files = await fileSystem.listFiles(resolvedRoot.fsPath, ['node_modules', '.git', 'dist', 'build']);
    console.log(`[searchCode] Found ${files.length} files total`);
    
    // Filter by file pattern if provided (supports glob-like patterns from LLM)
    const filteredFiles = file_pattern
      ? files.filter(f => matchFilePattern(f, file_pattern))
      : files;
    
    console.log(`[searchCode] Filtered to ${filteredFiles.length} files (pattern: ${file_pattern || 'none'})`);
    
    // Search through files
    const results: string[] = [];
    for (const file of filteredFiles.slice(0, 50)) {  // Limit to 50 files
      const content = await fileSystem.readFile(file);
      if (!content) continue;
      
      const lines = content.split('\n');
      lines.forEach((line, index) => {
        if (line.includes(pattern)) {
          results.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      });
    }
    
    console.log(`[searchCode] Found ${results.length} matches for "${pattern}"`);
    
    // If no results found, throw error (LLM will handle it)
    if (results.length === 0) {
      const errorMsg = `No matches found for pattern "${pattern}"${file_pattern ? ` in files matching "${file_pattern}"` : ''}`;
      console.error(`[searchCode] ❌ ${errorMsg}`);
      
      // UI notification: search failed
      await chatAPI.showChatStatus('searched_code', { 
        pattern,
        filesCount: 0,
        totalMatches: 0,
        filesList: [],
        error: errorMsg,
        _mergeIndex: searchingIndex
      });
      
      throw new Error(errorMsg);
    }
    
    // UI notification: searched_code complete
    const matchedFiles = [...new Set(results.map(r => r.split(':')[0]))];
    await chatAPI.showChatStatus('searched_code', { 
      pattern,
      filesCount: matchedFiles.length,
      totalMatches: results.length,
      filesList: matchedFiles,
      _mergeIndex: searchingIndex
    });
    
    return results.join('\n');
  }, { pattern, file_pattern });
}

// Match file path against LLM-provided glob-like patterns.
// Handles: *.go, dir/*.go, dir/ ** /*.go, .go, dir/, handler.go, etc.
function matchFilePattern(filePath: string, pattern: string): boolean {
  const p = pattern.replace(/\\/g, '/');
  
  // ".ext" → extension match
  if (p.startsWith('.') && !p.includes('/')) {
    return filePath.endsWith(p);
  }
  
  // "dir/" → directory contains
  if (p.endsWith('/')) {
    return filePath.includes(p);
  }
  
  // If pattern contains glob characters (* or **), convert to regex
  if (p.includes('*')) {
    const regexStr = p
      .replace(/\*\*\//g, '(.+/)?')       // **/ → match any nested dirs
      .replace(/\*/g, '[^/]*');            // * → match within single segment
    const regex = new RegExp(`(^|/)${regexStr}$`);
    return regex.test(filePath);
  }
  
  // Fallback: substring match (original behavior)
  return filePath.includes(p);
}

