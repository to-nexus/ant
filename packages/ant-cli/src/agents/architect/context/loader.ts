/**
 * Context Loader
 * 
 * Pre-loads codebase context based on analyzed strategy
 * (Similar to Cursor's automatic context loading)
 */

import { GitPort } from '../../../core/ports';
import { getChatAPIClient } from '../../../core/adapters/ChatAPIClient';
import { ContextStrategy } from './analyzer';

export interface LoadedContext {
  fileTree: string;
  grepResults: string;
  fileContents: string;
  summary: string;
}

/**
 * Load context based on strategy
 */
export async function loadContext(
  strategy: ContextStrategy,
  gitPort: GitPort
): Promise<LoadedContext> {
  const chatAPI = getChatAPIClient();
  
  const context: LoadedContext = {
    fileTree: '',
    grepResults: '',
    fileContents: '',
    summary: '',
  };
  
  // ===== 1. EXPLORE: List all files =====
  if (strategy.needsExplore) {
    await chatAPI.showChatStatus('exploring', { filesCount: 0, totalFiles: 0 });
    
    const allFiles = await gitPort.listFiles('', [
      'node_modules',
      'dist',
      'build',
      '.next',
      'coverage',
      'package-lock.json',
      'yarn.lock',
      'pnpm-lock.yaml',
      '.git',
      '*.test.ts',
      '*.test.tsx',
      '*.spec.ts',
      '*.spec.tsx',
      '*.log',
    ]);
    
    await chatAPI.showChatStatus('explored', { 
      filesCount: allFiles.length, 
      totalFiles: allFiles.length 
    });
    
    context.fileTree = buildFileTree(allFiles);
    console.log(`   ✅ Explored ${allFiles.length} files`);
  }
  
  // ===== 2. GREP: Search for keywords =====
  if (strategy.needsGrep && strategy.keywords.length > 0) {
    await chatAPI.showChatStatus('grepping', { totalFiles: 0 });
    
    const searchResults = await searchCodebase(
      gitPort,
      strategy.keywords,
      strategy.filePatterns
    );
    
    await chatAPI.showChatStatus('grepped', { 
      strategy: 'keyword search',
      filesCount: searchResults.filesMatched,
      filesList: searchResults.files
    });
    
    context.grepResults = formatGrepResults(searchResults);
    console.log(`   ✅ Found ${searchResults.totalMatches} matches in ${searchResults.filesMatched} files`);
  }
  
  // ===== 3. READ: Read top relevant files =====
  if (strategy.needsRead) {
    // A. Prioritize explicit readFiles (from error context)
    let filesToRead: string[] = [];
    
    if (strategy.readFiles && strategy.readFiles.length > 0) {
      console.log(`   📖 Reading ${strategy.readFiles.length} error-specific files`);
      filesToRead = strategy.readFiles;
    } else if (context.grepResults) {
      // B. Fallback to top-ranked grep results
      filesToRead = extractTopFiles(context.grepResults, strategy.maxFilesToRead);
      console.log(`   📖 Reading top ${filesToRead.length} files from grep results`);
    }
    
    if (filesToRead.length > 0) {
      const fileContents: string[] = [];
      
      for (const filePath of filesToRead) {
        try {
          await chatAPI.showChatStatus('reading', { file: filePath });
          
          const content = await gitPort.readFile(filePath);
          if (content) {
            fileContents.push(formatFileContent(filePath, content));
          }
        } catch (error) {
          console.warn(`   ⚠️  Failed to read ${filePath}:`, error);
        }
      }
      
      context.fileContents = fileContents.join('\n\n');
      console.log(`   ✅ Read ${fileContents.length} files`);
    }
  }
  
  // ===== 4. SUMMARY =====
  const parts: string[] = [];
  if (context.fileTree) parts.push('file tree');
  if (context.grepResults) parts.push('search results');
  if (context.fileContents) parts.push('file contents');
  
  context.summary = parts.length > 0 
    ? `Loaded: ${parts.join(', ')}`
    : 'No context loaded';
  
  return context;
}

/**
 * Build file tree representation
 */
function buildFileTree(files: string[]): string {
  const fileTree: Record<string, string[]> = {};
  
  files.forEach(file => {
    const dir = file.includes('/') ? file.substring(0, file.lastIndexOf('/')) : '.';
    if (!fileTree[dir]) fileTree[dir] = [];
    fileTree[dir].push(file.split('/').pop()!);
  });
  
  const lines: string[] = [
    '=== FILE TREE ===',
    `Total files: ${files.length}\n`,
  ];
  
  Object.keys(fileTree).sort().forEach(dir => {
    lines.push(`📁 ${dir}/`);
    fileTree[dir].forEach(file => {
      lines.push(`  └─ ${file}`);
    });
    lines.push('');
  });
  
  return lines.join('\n');
}

/**
 * Search codebase for keywords
 */
async function searchCodebase(
  gitPort: GitPort,
  keywords: string[],
  filePatterns: string[]
): Promise<{
  totalMatches: number;
  filesMatched: number;
  files: string[];
  matches: Array<{ file: string; line: number; snippet: string }>;
}> {
  const allFiles = await gitPort.listFiles('.', [
    'node_modules',
    '.git',
    'dist',
    'build',
    '.next',
  ]);
  
  const results: Array<{ file: string; line: number; snippet: string }> = [];
  const filesSet = new Set<string>();
  
  // Search for each keyword
  for (const keyword of keywords) {
    const regex = new RegExp(keyword, 'i');
    
    for (const file of allFiles.slice(0, 100)) {  // Limit to 100 files
      try {
        // Filter by file pattern if specified
        if (filePatterns.length > 0) {
          const matchesPattern = filePatterns.some(pattern => {
            const patternRegex = new RegExp(pattern.replace(/\*/g, '.*'));
            return patternRegex.test(file);
          });
          if (!matchesPattern) continue;
        }
        
        const content = await gitPort.readFile(file);
        if (!content) continue;
        
        const lines = content.split('\n');
        lines.forEach((line: string, idx: number) => {
          if (regex.test(line)) {
            results.push({
              file,
              line: idx + 1,
              snippet: line.trim(),
            });
            filesSet.add(file);
          }
        });
        
        if (results.length >= 100) break;  // Max 100 matches
      } catch {
        // Skip files that can't be read
      }
    }
    
    if (results.length >= 100) break;
  }
  
  return {
    totalMatches: results.length,
    filesMatched: filesSet.size,
    files: Array.from(filesSet),
    matches: results,
  };
}

/**
 * Format grep results
 */
function formatGrepResults(results: {
  totalMatches: number;
  filesMatched: number;
  files: string[];
  matches: Array<{ file: string; line: number; snippet: string }>;
}): string {
  const lines: string[] = [
    '=== SEARCH RESULTS ===',
    `Found ${results.totalMatches} matches in ${results.filesMatched} files\n`,
  ];
  
  // Group by file
  const byFile = new Map<string, Array<{ line: number; snippet: string }>>();
  results.matches.forEach(match => {
    if (!byFile.has(match.file)) {
      byFile.set(match.file, []);
    }
    byFile.get(match.file)!.push({ line: match.line, snippet: match.snippet });
  });
  
  // Format
  byFile.forEach((matches, file) => {
    lines.push(`📄 ${file}`);
    matches.slice(0, 5).forEach(m => {  // Max 5 per file
      lines.push(`   ${m.line}: ${m.snippet}`);
    });
    if (matches.length > 5) {
      lines.push(`   ... and ${matches.length - 5} more matches`);
    }
    lines.push('');
  });
  
  return lines.join('\n');
}

/**
 * Extract top files from grep results
 */
function extractTopFiles(grepResults: string, maxFiles: number): string[] {
  const fileMatches = grepResults.match(/📄 ([\w\-\.\/]+)/g);
  if (!fileMatches) return [];
  
  return fileMatches
    .map(m => m.replace('📄 ', ''))
    .slice(0, maxFiles);
}

/**
 * Format file content
 */
function formatFileContent(filePath: string, content: string): string {
  const lines = content.split('\n');
  const preview = lines.length > 500 
    ? `${lines.slice(0, 500).join('\n')}\n\n... (truncated, ${lines.length - 500} more lines)`
    : content;
  
  return `=== ${filePath} ===\n${preview}`;
}

