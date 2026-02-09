import * as fs from "fs";
import * as path from "path";
import { FileSource } from "../types";
import { FileSystemPort } from "../../ports";

/**
 * Keyword Search Strategy
 * 
 * Uses text-based keyword matching (grep-like).
 */
export class KeywordSearchStrategy {
  
  /**
   * Search files using keyword matching
   * 
   * @param directive - User's directive/query
   * @param workingDir - Working directory to search
   * @param options - Search options
   * @param git - Optional GitPort (for signature compatibility, not used in keyword search)
   * @param fileSystem - Optional FileSystemPort for file operations
   * @returns Array of file paths with match counts
   */
  async search(
    directive: string,
    workingDir: string,
    options: {
      maxFiles: number;
      exclude: string[];
    },
    git?: any,
    fileSystem?: FileSystemPort
  ): Promise<Array<{ path: string; source: FileSource }>> {
    // Extract keywords from directive
    const keywords = this.extractKeywords(directive);
    
    if (keywords.length === 0) {
      console.log('   ⚡ Keyword search: no keywords extracted');
      return [];
    }

    // Find files containing keywords
    const matchedFiles = await this.findFilesByKeywords(
      workingDir,
      keywords,
      options.exclude,
      fileSystem
    );

    // Sort by relevance and take top N
    const topFiles = matchedFiles
      .sort((a, b) => {
        const aMatches = a.source.type === 'keyword' ? a.source.matches : 0;
        const bMatches = b.source.type === 'keyword' ? b.source.matches : 0;
        return bMatches - aMatches;
      })
      .slice(0, options.maxFiles);

    if (topFiles.length === 0) {
      console.log('   ⚡ Keyword search: no matches found');
      return [];
    }

    console.log(`   ⚡ Keyword search: ${topFiles.length} files (keywords: ${keywords.slice(0, 3).join(', ')}...)`);
    
    return topFiles;
  }

  /**
   * Extract keywords from directive
   */
  private extractKeywords(directive: string): string[] {
    // Extract file names
    const fileMatches = directive.match(/[\w-]+\.(ts|js|tsx|jsx|py|go|rs|java)/g) || [];
    
    // Extract identifiers (functions, classes, variables)
    const identifierMatches = directive.match(/[A-Z][a-zA-Z0-9]+|[a-z][a-zA-Z0-9]+/g) || [];
    
    // Remove common words
    const commonWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'add', 'update', 'fix', 'remove', 'create', 'delete', 'modify', 'change'
    ]);
    const filtered = identifierMatches.filter(w => 
      !commonWords.has(w.toLowerCase()) && w.length > 2
    );
    
    return [...fileMatches, ...filtered];
  }

  /**
   * Find files by keywords (filename + content matching)
   */
  private async findFilesByKeywords(
    workingDir: string,
    keywords: string[],
    exclude: string[],
    fileSystem?: FileSystemPort
  ): Promise<Array<{ path: string; source: FileSource }>> {
    const results: Array<{ path: string; source: FileSource }> = [];
    const allFiles = await this.findAllSourceFiles(workingDir, exclude, fileSystem);

    for (const filePath of allFiles) {
      try {
        let matches = 0;
        const fileName = path.basename(filePath, path.extname(filePath)).toLowerCase();
        
        // 1. Check filename first (high priority - e.g., StorageAdapter.ts)
        for (const keyword of keywords) {
          if (fileName.includes(keyword.toLowerCase())) {
            matches += 10;  // High weight for filename match
          }
        }
        
        // 2. Check file content
        const content = fs.readFileSync(filePath, 'utf8').toLowerCase();
        for (const keyword of keywords) {
          const keywordMatches = (content.match(new RegExp(keyword.toLowerCase(), 'g')) || []).length;
          matches += keywordMatches;
        }
        
        if (matches > 0) {
          results.push({
            path: path.relative(workingDir, filePath),
            source: { type: 'keyword', matches }
          });
        }
      } catch (error) {
        // Skip files that can't be read
        continue;
      }
    }

    return results;
  }


  /**
   * Find all source files in directory
   * ✅ REFACTORED: Use FileSystemPort instead of direct fs calls
   */
  private async findAllSourceFiles(
    dir: string, 
    exclude: string[], 
    fileSystem?: FileSystemPort
  ): Promise<string[]> {
    const results: string[] = [];
    const sourceExtensions = [
      '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java',
      '.c', '.cpp', '.h', '.hpp', '.rb', '.php', '.swift', '.kt'
    ];

    // ✅ Use FileSystemPort if available, otherwise fallback to fs
    if (fileSystem) {
      const walk = async (currentPath: string): Promise<void> => {
        const relativePath = path.relative(dir, currentPath);
        
        if (this.shouldExclude(relativePath, exclude)) return;

        const exists = await fileSystem.fileExists(currentPath);
        if (!exists) return;

        try {
          const entries = await fileSystem.readDirectory(currentPath);
          
          // Process files
          for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;
            
            const fullPath = path.join(currentPath, entry.name);
            
            if (entry.isDirectory) {
              await walk(fullPath);
            } else {
              const ext = path.extname(entry.name);
              if (sourceExtensions.includes(ext)) {
                results.push(fullPath);
              }
            }
          }
        } catch (error) {
          // Directory might not exist or not readable, skip
          return;
        }
      };

      await walk(dir);
    } else {
      // ✅ Fallback to direct fs
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
    }
    
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
}

