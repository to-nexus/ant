/**
 * Codebase Context Loading (Common Module)
 * 
 * Shared utilities for loading codebase context in different scenarios:
 * - Decompose: Full codebase loading (simple, for task breakdown)
 * - Plan: Smart pre-loading (task-specific, for LLM context)
 */

import { GitPort } from '../../../core/ports';

/**
 * Common exclusion patterns for file listing
 */
export const DEFAULT_EXCLUDES = [
  'node_modules',
  'dist',
  'build',
  '.next',
  'out',
  'coverage',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  '.git',
  '*.test.ts',
  '*.test.tsx',
  '*.test.js',
  '*.test.jsx',
  '*.spec.ts',
  '*.spec.tsx',
  '*.spec.js',
  '*.spec.jsx',
];

/**
 * Load full codebase (for Decompose)
 * Simple, straightforward loading of all files
 */
export async function loadFullCodebase(
  gitPort: GitPort,
  options: {
    maxFiles?: number;
    maxTokens?: number;
  } = {}
): Promise<{
  files: string[];
  content: string;
  totalTokens: number;
}> {
  const maxFiles = options.maxFiles || 50;
  const maxTokens = options.maxTokens || 100000;
  
  console.log('📂 Loading full codebase from disk...');
  
  const allFiles = await gitPort.listFiles('', DEFAULT_EXCLUDES);
  
  const fileContents: string[] = [];
  let totalTokens = 0;
  const loadedFiles: string[] = [];
  
  for (const file of allFiles.slice(0, maxFiles)) {
    try {
      const content = await gitPort.readFile(file);
      if (content && content.length > 0) {
        fileContents.push(`=== ${file} ===\n${content}\n`);
        totalTokens += Math.ceil(content.length / 4);
        loadedFiles.push(file);
        
        if (totalTokens > maxTokens) {
          console.log(`   ⚠️  Reached token limit (${totalTokens} tokens), stopping...`);
          break;
        }
      }
    } catch (error) {
      // Skip files that can't be read
    }
  }
  
  console.log(`   ✅ Loaded ${loadedFiles.length} files (~${totalTokens} tokens)`);
  
  return {
    files: loadedFiles,
    content: fileContents.join('\n'),
    totalTokens,
  };
}

/**
 * Check if codebase exists (has files)
 */
export async function hasCodebase(gitPort: GitPort): Promise<boolean> {
  try {
    const allFiles = await gitPort.listFiles('', DEFAULT_EXCLUDES);
    return allFiles.length > 0;
  } catch {
    return false;
  }
}

/**
 * Get file count (for statistics)
 */
export async function getFileCount(gitPort: GitPort): Promise<number> {
  try {
    const allFiles = await gitPort.listFiles('', DEFAULT_EXCLUDES);
    return allFiles.length;
  } catch {
    return 0;
  }
}

