import * as fs from "fs";
import * as path from "path";
import { GitPort } from "../../ports";
import { CodeContext, FileWithSource } from "../types";

/**
 * File Loader
 * 
 * Loads file contents from disk (current + Git HEAD versions).
 */
export class FileLoader {
  
  /**
   * Load file versions (current + original for changed files)
   * 
   * @param files - Files to load with source tracking
   * @param workingDir - Working directory
   * @param git - Git port (optional, for HEAD versions)
   * @param maxTokens - Maximum tokens to load
   * @returns Code context with loaded files
   */
  async load(
    files: FileWithSource[],
    workingDir: string,
    git: GitPort | undefined,
    maxTokens: number
  ): Promise<CodeContext> {
    
    const currentFiles: Array<{ path: string; content: string }> = [];
    const headFiles: Array<{ path: string; content: string }> = [];
    
    let totalTokens = 0;
    let filesChanged = 0;

    for (const fileInfo of files) {
      const fullPath = path.isAbsolute(fileInfo.path)
        ? fileInfo.path
        : path.join(workingDir, fileInfo.path);

      if (!fs.existsSync(fullPath)) {
        console.warn(`   ⚠️  File not found: ${fileInfo.path}`);
        continue;
      }

      // Load current version (working tree)
      const currentContent = fs.readFileSync(fullPath, 'utf8');
      const tokens = this.estimateTokens(currentContent);

      if (totalTokens + tokens > maxTokens) {
        console.warn(`   ⚠️  Token budget exceeded, stopping at ${currentFiles.length} files`);
        break;
      }

      const relativePath = path.relative(workingDir, fullPath);
      
      currentFiles.push({
        path: relativePath,
        content: currentContent
      });
      totalTokens += tokens;

      // ✅ Load Git HEAD version (if file has local changes AND Git is available)
      if (fileInfo.hasLocalChanges && git) {
        try {
          const headContent = await git.getHeadFile(relativePath);
          if (headContent !== null) {
            headFiles.push({
              path: relativePath,
              content: headContent
            });
            filesChanged++;
          }
        } catch (error) {
          console.warn(`   ⚠️  Failed to load HEAD version for ${relativePath}:`, error);
        }
      }
    }

    // Calculate source breakdown
    const sourceBreakdown = this.calculateSourceBreakdown(
      files.slice(0, currentFiles.length)
    );

    console.log(`   📂 Loaded ${currentFiles.length} files (~${totalTokens} tokens)`);
    if (filesChanged > 0) {
      console.log(`   🔀 ${filesChanged} files with Git HEAD versions`);
    }

    return {
      code: this.formatCodeBlock(currentFiles),
      codeHead: headFiles.length > 0 ? this.formatCodeBlock(headFiles) : undefined,
      files: files.slice(0, currentFiles.length),
      strategy: 'hybrid',
      stats: {
        filesLoaded: currentFiles.length,
        filesChanged,
        estimatedTokens: totalTokens,
        sourceBreakdown
      }
    };
  }

  /**
   * Calculate source breakdown statistics
   */
  private calculateSourceBreakdown(
    files: FileWithSource[]
  ): {
    vectorSearch: number;
    keywordSearch: number;
    gitChanged: number;
    importGraph: number;
  } {
    const breakdown = {
      vectorSearch: 0,
      keywordSearch: 0,
      gitChanged: 0,
      importGraph: 0
    };

    for (const file of files) {
      for (const source of file.sources) {
        if (source.type === 'vector') breakdown.vectorSearch++;
        else if (source.type === 'keyword') breakdown.keywordSearch++;
        else if (source.type === 'git-changed') breakdown.gitChanged++;
        else if (source.type === 'import-graph') breakdown.importGraph++;
      }
    }

    return breakdown;
  }

  /**
   * Format files into code block
   */
  private formatCodeBlock(
    files: Array<{ path: string; content: string }>
  ): string {
    return files
      .map(f => `FILE: ${f.path}\n${f.content}`)
      .join("\n\n---\n\n");
  }

  /**
   * Estimate tokens (rough approximation: 1 token ≈ 4 chars)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

