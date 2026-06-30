/**
 * Codebase Analyzer Port
 * Interface for detecting language, framework, and conventions from source code
 */

import { CodebaseProfile } from '../types';
import type { Stack, Language } from '@ant/shared';

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

  /**
   * Lightweight stack/language/framework detection from a working directory
   * alone (reads package.json + file structure; no git files-block needed).
   *
   * Returns `undefined` when there is no usable signal (greenfield / empty dir /
   * low-confidence default) so callers can avoid asserting a stack we did not
   * actually observe — never defaults to a frontend guess. The `language` field
   * is always set when a `stack` is returned, because the basis renderer skips
   * any tier that lacks a language (the framework partial would never inject).
   */
  detectStack(workingDir: string): Promise<{
    stack?: Stack;
    language?: Language;
    framework?: string;
  } | undefined>;
}

