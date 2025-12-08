/**
 * Git Diff Summary
 * 
 * Represents a compact summary of changes between HEAD and Working Tree.
 * This replaces sending full file content duplicates by using currentCode + gitDiff.
 * 
 * Instead of duplicating entire files, we send:
 *   currentCode:   Button.tsx (100 lines) + App.tsx (50 lines) + Modal.tsx (20 lines) = 170 lines
 *   gitDiff:       Summary of what changed (10-20 lines)
 *   Total: ~190 lines (40% reduction!)
 */

export interface GitDiffSummary {
  /**
   * List of modified files
   */
  modified: Array<{
    path: string;
    insertions: number;
    deletions: number;
    summary: string;  // e.g., "+5 -2 (added onClick handler)"
  }>;
  
  /**
   * List of new files (not in HEAD)
   */
  added: Array<{
    path: string;
    lines: number;
  }>;
  
  /**
   * List of deleted files (in HEAD but not in working tree)
   */
  deleted: Array<{
    path: string;
  }>;
  
  /**
   * Overall statistics
   */
  stats: {
    totalFiles: number;
    totalInsertions: number;
    totalDeletions: number;
  };
  
  /**
   * Human-readable summary
   */
  summary: string;  // e.g., "3 files changed: 2 modified, 1 added"
}

/**
 * Generate Git diff summary
 */
export async function generateGitDiffSummary(
  git: import('../ports').GitPort,
  workingDir: string,
  files: string[]
): Promise<GitDiffSummary | null> {
  try {
    const { default: simpleGit } = await import('simple-git');
    const gitInstance = simpleGit({ baseDir: workingDir });
    
    // Get diff between HEAD and working tree
    const diffSummary = await gitInstance.diffSummary(['HEAD']);
    
    const modified: GitDiffSummary['modified'] = [];
    const added: GitDiffSummary['added'] = [];
    const deleted: GitDiffSummary['deleted'] = [];
    
    let totalInsertions = 0;
    let totalDeletions = 0;
    
    for (const file of diffSummary.files) {
      // Only include files that are in our loaded files list
      if (!files.includes(file.file)) {
        continue;
      }
      
      if (file.binary) {
        // Skip binary files
        continue;
      }
      
      totalInsertions += file.insertions;
      totalDeletions += file.deletions;
      
      // Determine file status
      if (file.insertions > 0 && file.deletions === 0) {
        // New file
        added.push({
          path: file.file,
          lines: file.insertions
        });
      } else if (file.insertions === 0 && file.deletions > 0) {
        // Deleted file
        deleted.push({
          path: file.file
        });
      } else {
        // Modified file
        const summary = `+${file.insertions} -${file.deletions}`;
        modified.push({
          path: file.file,
          insertions: file.insertions,
          deletions: file.deletions,
          summary
        });
      }
    }
    
    // Generate human-readable summary
    const parts: string[] = [];
    if (modified.length > 0) parts.push(`${modified.length} modified`);
    if (added.length > 0) parts.push(`${added.length} added`);
    if (deleted.length > 0) parts.push(`${deleted.length} deleted`);
    
    const summary = parts.length > 0
      ? `${modified.length + added.length + deleted.length} files changed: ${parts.join(', ')}`
      : 'No changes detected';
    
    return {
      modified,
      added,
      deleted,
      stats: {
        totalFiles: modified.length + added.length + deleted.length,
        totalInsertions,
        totalDeletions
      },
      summary
    };
    
  } catch (error) {
    console.warn('⚠️  Failed to generate git diff summary:', error);
    return null;
  }
}

/**
 * Format Git diff summary as markdown for LLM prompt
 */
export function formatGitDiffForPrompt(diff: GitDiffSummary): string {
  const lines: string[] = [];
  
  lines.push('## Git Changes (HEAD → Working Tree)');
  lines.push('');
  lines.push(diff.summary);
  lines.push('');
  
  if (diff.modified.length > 0) {
    lines.push('### Modified Files');
    for (const file of diff.modified) {
      lines.push(`- \`${file.path}\`: ${file.summary}`);
    }
    lines.push('');
  }
  
  if (diff.added.length > 0) {
    lines.push('### New Files');
    for (const file of diff.added) {
      lines.push(`- \`${file.path}\`: ${file.lines} lines`);
    }
    lines.push('');
  }
  
  if (diff.deleted.length > 0) {
    lines.push('### Deleted Files');
    for (const file of diff.deleted) {
      lines.push(`- \`${file.path}\``);
    }
    lines.push('');
  }
  
  lines.push(`💡 **Tip**: Modified files show current version in codebase. Use git changes to understand what was added/removed.`);
  
  return lines.join('\n');
}

