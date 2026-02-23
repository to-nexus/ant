/**
 * Context Analyzer
 * 
 * Analyzes TASK (not directive) to determine what context to pre-load
 * (Similar to Cursor's smart context loading)
 * 
 * NOTE: 
 * - Directive is handled by DECOMPOSE node (initial task breakdown)
 * - This runs in PLAN node for each individual task
 * - Focus: Task type, name, description, error context, design relevance
 */

import { CodeTask } from '../types/task';

export interface ContextStrategy {
  needsExplore: boolean;      // List all files
  needsGrep: boolean;         // Search for keywords
  needsRead: boolean;         // Read specific files
  keywords: string[];         // Keywords to search
  filePatterns: string[];     // File patterns to focus on
  readFiles: string[];        // Specific files to read (for errors)
  maxFilesToRead: number;     // Max files to pre-read
}

/**
 * Analyze TASK to determine context strategy
 * 
 * @param task - Current task (PRIMARY source)
 * @param enforcementReason - Error context (SECONDARY source for error tasks)
 * @param design - Design document (TERTIARY source for keyword extraction)
 * @param existingFiles - Current generated files (QUATERNARY for pattern matching)
 */
export function analyzeContextNeeds(
  task: CodeTask,
  enforcementReason?: string | null,
  design?: string,
  existingFiles?: string[]
): ContextStrategy {
  const lowerTaskName = task.name.toLowerCase();
  const lowerTaskDesc = task.description?.toLowerCase() || '';
  const hasError = Boolean(enforcementReason);
  
  // Default strategy
  const strategy: ContextStrategy = {
    needsExplore: true,       // Always explore (file tree is cheap)
    needsGrep: false,
    needsRead: false,
    keywords: [],
    filePatterns: [],
    readFiles: [],
    maxFilesToRead: 10,
  };
  
  // ===== ERROR TASK: Focus on error context =====
  if (hasError || task.type === 'error') {
    console.log(`   🔍 [Context] Error task → focused context loading`);
    
    strategy.needsGrep = true;
    strategy.needsRead = true;
    strategy.maxFilesToRead = 5;  // Less files, more focused
    
    // Extract error-related keywords and files
    if (enforcementReason) {
      strategy.keywords = extractErrorKeywords(enforcementReason);
      strategy.readFiles = extractErrorFiles(enforcementReason);
      console.log(`      Keywords: ${strategy.keywords.slice(0, 3).join(', ')}${strategy.keywords.length > 3 ? '...' : ''}`);
      console.log(`      Files: ${strategy.readFiles.slice(0, 3).join(', ')}${strategy.readFiles.length > 3 ? '...' : ''}`);
    }
    
    return strategy;
  }
  
  // ===== SETUP TASK: Minimal context (project initialization) =====
  if (task.type === 'setup') {
    console.log(`   🔍 [Context] Setup task → explore only (no existing code needed)`);
    
    strategy.needsGrep = false;
    strategy.needsRead = false;  // Setup doesn't need existing code
    
    return strategy;
  }
  
  // ===== DOC TASK: Load existing documentation and config for doc generation =====
  if (task.type === 'doc') {
    console.log(`   🔍 [Context] Doc task → loading docs and configs for documentation`);
    
    strategy.needsGrep = true;
    strategy.needsRead = true;
    strategy.maxFilesToRead = 10;
    strategy.filePatterns = ['README.md', 'docs/**/*.md', 'package.json', 'go.mod', 'Cargo.toml', 'Makefile'];
    
    return strategy;
  }
  
  // ===== TESTGEN TASK: Load existing source code for test target observation =====
  if (task.type === 'testgen') {
    console.log(`   🔍 [Context] Testgen task → loading source code for test targets`);
    
    strategy.needsGrep = true;
    strategy.needsRead = true;
    strategy.maxFilesToRead = 10;
    
    const taskKeywords = extractKeywords(
      `${task.name} ${task.description || ''}`
    );
    strategy.keywords = taskKeywords.slice(0, 5);
    
    console.log(`      Keywords: ${strategy.keywords.join(', ')}`);
    
    return strategy;
  }
  
  // ===== FEATURE TASK: Search for similar patterns =====
  if (task.type === 'feature') {
    console.log(`   🔍 [Context] Feature task → searching for similar patterns`);
    
    strategy.needsGrep = true;
    strategy.needsRead = true;
    strategy.maxFilesToRead = 10;
    
    // A. Extract keywords from task name + description
    const taskKeywords = extractKeywords(
      `${task.name} ${task.description || ''}`
    );
    
    // B. Extract keywords from design document (task-relevant section)
    const designKeywords = design ? extractDesignKeywords(design, task) : [];
    
    // C. Merge and deduplicate
    strategy.keywords = [...new Set([...taskKeywords, ...designKeywords])].slice(0, 5);
    
    console.log(`      Keywords: ${strategy.keywords.join(', ')}`);
    
    return strategy;
  }
  
  // ===== DEFAULT: Minimal grep =====
  console.log(`   🔍 [Context] Default → light grep only`);
  
  strategy.needsGrep = true;
  strategy.needsRead = false;  // Let LLM decide via tool calls
  strategy.keywords = extractKeywords(task.name);
  
  return strategy;
}

/**
 * Extract keywords from error message
 */
function extractErrorKeywords(errorMessage: string): string[] {
  const keywords: string[] = [];
  
  // Extract file names
  const fileMatches = errorMessage.match(/[\w-]+\.(ts|tsx|js|jsx|py|go|rs)/gi);
  if (fileMatches) {
    keywords.push(...fileMatches.map(f => f.replace(/\.(ts|tsx|js|jsx|py|go|rs)$/i, '')));
  }
  
  // Extract function/class names
  const nameMatches = errorMessage.match(/['"`](\w+)['"`]/g);
  if (nameMatches) {
    keywords.push(...nameMatches.map(m => m.replace(/['"`]/g, '')));
  }
  
  // Extract error types
  if (errorMessage.includes('import')) keywords.push('import');
  if (errorMessage.includes('export')) keywords.push('export');
  if (errorMessage.includes('type')) keywords.push('type', 'interface');
  if (errorMessage.includes('missing')) keywords.push('function', 'const', 'class');
  
  return [...new Set(keywords)].slice(0, 5);  // Max 5 keywords
}

/**
 * Extract keywords from design document (task-relevant sections)
 */
function extractDesignKeywords(design: string, task: CodeTask): string[] {
  // Extract main words from task name
  const taskWords = task.name
    .toLowerCase()
    .split(/\s+/)
    .filter((w: string) => w.length > 3);  // Filter short words
  
  if (taskWords.length === 0) return [];
  
  // Find sections in design that mention task words
  const lines = design.split('\n');
  const relevantLines: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    
    // Check if line contains any task word
    if (taskWords.some((word: string) => line.includes(word))) {
      // Extract surrounding context (±5 lines)
      const start = Math.max(0, i - 5);
      const end = Math.min(lines.length, i + 6);
      
      for (let j = start; j < end; j++) {
        if (!relevantLines.includes(lines[j])) {
          relevantLines.push(lines[j]);
        }
      }
    }
  }
  
  // Extract keywords from relevant sections
  const sectionText = relevantLines.join(' ');
  return extractKeywords(sectionText);
}

/**
 * Extract file paths from error message
 */
function extractErrorFiles(errorMessage: string): string[] {
  const files: string[] = [];
  
  // Match file paths: src/auth/file.ts, components/Button.tsx, etc.
  const pathMatches = errorMessage.match(/[\w/-]+\.(ts|tsx|js|jsx|vue|py|go|rs|java)/gi);
  if (pathMatches) {
    files.push(...pathMatches);
  }
  
  // Match "in file.ts" or "at file.ts" patterns
  const inFileMatches = errorMessage.match(/(?:in|at)\s+([\w-]+\.(ts|tsx|js|jsx))/gi);
  if (inFileMatches) {
    files.push(...inFileMatches.map(m => m.replace(/^(?:in|at)\s+/i, '')));
  }
  
  return [...new Set(files)];  // Deduplicate
}

/**
 * Extract general keywords from text
 */
function extractKeywords(text: string): string[] {
  // Remove common words
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be',
    'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
    'would', 'should', 'can', 'could', 'may', 'might', 'must', 'this',
    'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they'
  ]);
  
  // Extract words (alphanumeric)
  const words = text
    .toLowerCase()
    .match(/\b[a-z0-9]+\b/gi) || [];
  
  // Filter and deduplicate
  const keywords = words
    .filter(w => w.length > 2 && !stopWords.has(w))
    .filter((w, i, arr) => arr.indexOf(w) === i)  // Deduplicate
    .slice(0, 5);  // Max 5 keywords
  
  return keywords;
}

