import * as path from "path";
import { GitPort } from "../../ports";
import { CodeContext, FileWithSource } from "../types";
import { generateGitDiffSummary, formatGitDiffForPrompt, GitDiffSummary } from "../GitDiffSummary";

/**
 * File Loader
 * 
 * Loads file contents from disk (working tree) + Git HEAD versions (history).
 * ✅ NOTE: Working tree reads use Node fs for now (workspace-scoped FileSystemPort refactor pending).
 */
export class FileLoader {
  
  /**
   * Load file versions (current + original for changed files)
   * 
   * ✅ CRITICAL: GitPort is now REQUIRED (not optional)
   * - GitPort provides readFile() which works through FileSystemPort internally
   * - No more direct fs access
   * 
   * @param files - Files to load with source tracking
   * @param workingDir - Working directory (for relative path calculation)
   * @param git - Git port (REQUIRED for file reading)
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
      // ✅ GitPort.readFile() expects relative paths
      const relativePath = fileInfo.path;

      // ✅ Read current file from working tree (disk)
      let currentContent: string | null = null;
      try {
        const fs = await import('fs/promises');
        const abs = path.isAbsolute(relativePath)
          ? relativePath
          : path.join(workingDir, relativePath);
        currentContent = await fs.readFile(abs, 'utf-8');
      } catch {
        currentContent = null;
      }
      
      if (currentContent === null) {
        console.warn(`   ⚠️  File not found: ${fileInfo.path}`);
        continue;
      }

      const tokens = this.estimateTokens(currentContent);

      if (totalTokens + tokens > maxTokens) {
        console.warn(`   ⚠️  Token budget exceeded, stopping at ${currentFiles.length} files`);
        break;
      }
      
      currentFiles.push({
        path: relativePath,
        content: currentContent
      });
      totalTokens += tokens;

      // ✅ Load Git HEAD version (if file has local changes)
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
    
    // ✅ Generate Git diff summary (replaces codeHead)
    let gitDiff: GitDiffSummary | undefined = undefined;
    if (filesChanged > 0 && git) {
      const filePaths = files.slice(0, currentFiles.length).map(f => f.path);
      const diffResult = await generateGitDiffSummary(git, workingDir, filePaths);
      
      if (diffResult) {
        gitDiff = diffResult;
        console.log(`   📊 Git diff: ${diffResult.summary}`);
      }
    }

    return {
      code: this.formatCodeBlock(currentFiles),
      gitDiff,
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

