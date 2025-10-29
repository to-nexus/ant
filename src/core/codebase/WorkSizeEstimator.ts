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
   * Estimate work size to decide execution strategy
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
              needsBatch: false,
              reason: 'Git changes detected, small focused modification'
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

    // 3. Analyze directive for scope
    const keywords = this.extractKeywords(directive);
    const isGlobalRefactor = this.detectGlobalRefactor(directive);

    if (isGlobalRefactor) {
      const estimatedAffectedFiles = Math.min(totalFiles, Math.ceil(totalFiles * 0.7));
      return {
        estimatedTokens: estimatedAffectedFiles * 2000,
        estimatedFiles: estimatedAffectedFiles,
        needsBatch: estimatedAffectedFiles > 30,
        reason: 'Global refactoring detected, affects many files'
      };
    }

    // 4. Targeted work: estimate based on keyword matches
    const matchingFiles = allSourceFiles.filter(file => {
      const content = this.readFileSafely(file);
      return keywords.some(kw => content.toLowerCase().includes(kw.toLowerCase()));
    });

    const estimatedFiles = Math.min(matchingFiles.length || 10, totalFiles);
    const estimatedTokens = estimatedFiles * 2000;

    // 5. Thresholds
    const BATCH_TOKEN_THRESHOLD = 150000;
    const BATCH_FILE_THRESHOLD = 40;

    return {
      estimatedTokens,
      estimatedFiles,
      needsBatch: estimatedTokens > BATCH_TOKEN_THRESHOLD || estimatedFiles > BATCH_FILE_THRESHOLD,
      reason: estimatedFiles > BATCH_FILE_THRESHOLD
        ? `Large scope: ~${estimatedFiles} files affected`
        : estimatedTokens > BATCH_TOKEN_THRESHOLD
        ? `Large context: ~${Math.ceil(estimatedTokens / 1000)}K tokens`
        : 'Normal scope, fits in single context'
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

