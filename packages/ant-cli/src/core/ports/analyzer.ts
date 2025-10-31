/**
 * Codebase Analyzer Port
 * Interface for detecting language, framework, and conventions from source code
 */

import { CodebaseProfile } from '../types';

export interface CodebaseAnalyzerPort {
  /**
   * Analyze source code to detect language, framework, and conventions
   * 
   * @param filesBlock - Source code text (from git or file system)
   * @param workingDir - Project root directory path
   * @returns Detected codebase metadata
   * 
   * @example
   * const profile = await analyzer.analyze(gitFilesBlock, '/path/to/repo');
   * // → { language: 'typescript', framework: 'react', version: '18.2.0' }
   */
  analyze(filesBlock: string, workingDir: string): Promise<CodebaseProfile>;
}

