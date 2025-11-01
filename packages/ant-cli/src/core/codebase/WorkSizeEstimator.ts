import * as fs from "fs";
import * as path from "path";
import { GitPort } from "../ports";

/**
 * Work size estimation result
 */
export interface WorkSizeEstimation {
  estimatedTokens: number;
  estimatedFiles: number;
  needsBatch: boolean;
  reason: string;
}

/**
 * WorkSizeEstimator
 * 
 * Determines execution strategy (normal vs batch) based on work size
 * This is NOT about code loading - it's about execution planning
 * 
 * Responsibility: Analyze directive and codebase to estimate scope
 */
export class WorkSizeEstimator {
  private defaultExclude = [
    'node_modules',
    '.git',
    'dist',
    'build',
    'coverage',
    '.next',
    '.nuxt',
    'target',
    '*.log',
    '*.lock',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml'
  ];

  /**
   * ✅ SIMPLIFIED: Estimate work size for informational purposes only
   * 
   * Decision: ALL work uses Task Queue Mode with LLM-delegated validation
   * - LLM decides which tasks need validation and which can be batched
   * - No more automatic Batch Mode based on keywords
   * - Simpler, more consistent, more flexible
   */
  async estimate(
    directive: string,
    workingDir: string,
    git?: GitPort
  ): Promise<WorkSizeEstimation> {
    const exclude = this.defaultExclude;

    // 1. Check if this is a git-based change (small, focused)
    if (git) {
      try {
        const hasChanges = await git.hasChanges();
        if (hasChanges) {
          const changedFiles = await git.getChangedFiles();
          if (changedFiles.length > 0 && changedFiles.length <= 50) {
            return {
              estimatedTokens: changedFiles.length * 2000,
              estimatedFiles: changedFiles.length,
              needsBatch: false,  // ✅ ALWAYS false - no more Batch Mode
              reason: 'Git changes detected, focused modification'
            };
          }
        }
      } catch (error) {
        // Git not available, continue
      }
    }

    // 2. Estimate from codebase size
    const allSourceFiles = this.findAllSourceFiles(workingDir, exclude);
    const totalFiles = allSourceFiles.length;

    // 3. Simple estimation for logging purposes
    const keywords = this.extractKeywords(directive);
    const matchingFiles = allSourceFiles.filter(file => {
      const content = this.readFileSafely(file);
      return keywords.some(kw => content.toLowerCase().includes(kw.toLowerCase()));
    });

    const estimatedFiles = matchingFiles.length || Math.min(50, totalFiles || 50);
    const estimatedTokens = estimatedFiles * 2000;

    // 4. ✅ ALWAYS return needsBatch: false
    //    Let LLM handle validation strategy through Task decomposition
    return {
      estimatedTokens,
      estimatedFiles,
      needsBatch: false,  // ✅ UNIFIED: Always use Task Queue Mode
      reason: totalFiles < 30
        ? 'New project - using task-based generation'
        : `Existing codebase (~${totalFiles} files) - using task-based modification`
    };
  }

  /**
   * Extract keywords from directive
   */
  private extractKeywords(directive: string): string[] {
    const words = directive.toLowerCase().split(/\s+/);
    return words
      .filter(w => w.length > 3)
      .filter(w => !['that', 'this', 'with', 'from', 'should', 'would', 'could'].includes(w))
      .slice(0, 10);
  }

  /**
   * Detect global refactoring keywords
   */
  private detectGlobalRefactor(directive: string): boolean {
    const globalKeywords = [
      'all files',
      'entire codebase',
      'every file',
      'global',
      'rename all',
      'refactor all',
      'migrate all',
      'update all',
      'everywhere'
    ];

    const lowerDirective = directive.toLowerCase();
    return globalKeywords.some(kw => lowerDirective.includes(kw));
  }

  /**
   * Find all source files
   */
  private findAllSourceFiles(dir: string, exclude: string[]): string[] {
    const results: string[] = [];
    const sourceExtensions = [
      '.ts', '.tsx', '.js', '.jsx',
      '.py', '.go', '.rs', '.java',
      '.c', '.cpp', '.h', '.hpp',
      '.rb', '.php', '.swift', '.kt'
    ];

    const walk = (currentPath: string) => {
      if (!fs.existsSync(currentPath)) return;

      const stat = fs.statSync(currentPath);
      const relativePath = path.relative(dir, currentPath);

      if (this.shouldExclude(relativePath, exclude)) return;

      if (stat.isDirectory()) {
        const entries = fs.readdirSync(currentPath);
        for (const entry of entries) {
          if (entry.startsWith('.')) continue;
          walk(path.join(currentPath, entry));
        }
      } else if (stat.isFile()) {
        const ext = path.extname(currentPath);
        if (sourceExtensions.includes(ext)) {
          results.push(currentPath);
        }
      }
    };

    walk(dir);
    return results;
  }

  /**
   * Check if path should be excluded
   */
  private shouldExclude(relativePath: string, exclude: string[]): boolean {
    const normalizedPath = relativePath.replace(/\\/g, '/');
    
    for (const pattern of exclude) {
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        if (regex.test(normalizedPath)) return true;
      } else {
        if (normalizedPath === pattern || 
            normalizedPath.startsWith(pattern + '/') ||
            normalizedPath.includes('/' + pattern + '/')) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Read file safely
   */
  private readFileSafely(filePath: string): string {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch {
      return '';
    }
  }
}

