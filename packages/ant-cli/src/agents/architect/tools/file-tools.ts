/**
 * File Tools
 * 
 * Tools for reading files, listing directories, and searching code
 */

import { Tool } from './registry';
import { GitPort } from '../../../core/ports';
import { getChatAPIClient } from '../../../core/adapters/ChatAPIClient';

/**
 * read_file tool
 * Reads the contents of a specific file from the codebase
 */
export function createReadFileTool(gitPort: GitPort): Tool {
  return {
    definition: {
      name: 'read_file',
      description: 'Read the contents of a file from the codebase. Use this when you need to see the current state of a file to understand its structure, find bugs, or make modifications.',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The file path relative to the project root (e.g., "src/app/layout.tsx")',
          },
        },
        required: ['path'],
      },
    },
    executor: async (input: Record<string, any>) => {
      const { path } = input;
      const chatAPI = getChatAPIClient();
      
      if (!path || typeof path !== 'string') {
        return {
          error: true,
          message: 'Missing or invalid "path" parameter',
        };
      }

      try {
        // ✅ UI: Show reading status
        await chatAPI.showChatStatus('reading', { file: path });
        
        const content = await gitPort.readFile(path);
        if (!content) {
          return {
            error: true,
            message: 'File is empty or does not exist',
            path,
          };
        }
        
        const lines = content.split('\n');
        
        // ✅ UI: Complete reading status (accumulated in ChatService)
        // Note: Multiple read_file calls will accumulate, then ChatService shows 'read' summary
        
        return {
          path,
          content,
          lines: lines.length,
          size: content.length,
        };
      } catch (error: any) {
        return {
          error: true,
          message: `Failed to read file: ${error.message}`,
          path,
        };
      }
    },
  };
}

/**
 * list_files tool
 * Lists all files in a directory or the entire codebase
 */
export function createListFilesTool(gitPort: GitPort): Tool {
  return {
    definition: {
      name: 'list_files',
      description: 'List all files in a directory or the entire codebase. Use this to explore the project structure and find specific files.',
      input_schema: {
        type: 'object',
        properties: {
          directory: {
            type: 'string',
            description: 'The directory path to list (e.g., "src/app"). Leave empty or use "." to list the entire codebase.',
          },
          pattern: {
            type: 'string',
            description: 'Optional glob pattern to filter files (e.g., "*.tsx", "*.ts")',
          },
        },
      },
    },
    executor: async (input: Record<string, any>) => {
      const { directory, pattern } = input;
      const chatAPI = getChatAPIClient();
      
      try {
        // ✅ UI: Show exploring status
        await chatAPI.showChatStatus('exploring', { filesCount: 0, totalFiles: 0 });
        
        // Get all files from the codebase
        const allFiles = await gitPort.listFiles('.', [
          'node_modules',
          '.git',
          'dist',
          'build',
          '.next',
          'coverage',
          '*.log',
          'pnpm-lock.yaml',
          'package-lock.json',
        ]);

        // Filter by directory if specified
        let files = directory && directory !== '.' 
          ? allFiles.filter(f => f.startsWith(directory))
          : allFiles;

        // Filter by pattern if specified
        if (pattern) {
          const regex = new RegExp(pattern.replace(/\*/g, '.*'));
          files = files.filter(f => regex.test(f));
        }

        // Group by directory for better structure
        const fileTree: Record<string, string[]> = {};
        files.forEach(file => {
          const dir = file.includes('/') ? file.substring(0, file.lastIndexOf('/')) : '.';
          if (!fileTree[dir]) fileTree[dir] = [];
          fileTree[dir].push(file);
        });

        // ✅ UI: Complete exploring status
        await chatAPI.showChatStatus('explored', { 
          filesCount: files.length, 
          totalFiles: allFiles.length 
        });

        return {
          directory: directory || '.',
          pattern,
          files,
          count: files.length,
          total: allFiles.length,
          tree: fileTree,
        };
      } catch (error: any) {
        // ✅ CRITICAL: Update status to explored (failed) before returning error
        await chatAPI.showChatStatus('explored', { 
          filesCount: 0, 
          totalFiles: 0,
          error: error.message
        });
        
        return {
          error: true,
          message: `Failed to list files: ${error.message}`,
        };
      }
    },
  };
}

/**
 * delete_file tool
 * Deletes a file from the codebase
 */
export function createDeleteFileTool(gitPort: GitPort): Tool {
  return {
    definition: {
      name: 'delete_file',
      description: 'Delete a file from the codebase. Use this to remove unnecessary, outdated, or redundant files.',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The file path relative to the project root (e.g., "src/legacy/OldComponent.tsx")',
          },
        },
        required: ['path'],
      },
    },
    executor: async (input: Record<string, any>) => {
      const { path } = input;
      
      if (!path || typeof path !== 'string') {
        return {
          error: true,
          message: 'Missing or invalid "path" parameter',
        };
      }

      try {
        const exists = await gitPort.fileExists(path);
        if (!exists) {
          return {
            error: true,
            message: `File does not exist: ${path}`,
            path,
          };
        }

        await gitPort.deleteFile(path);
        
        return {
          success: true,
          message: `File deleted successfully: ${path}`,
          path,
        };
      } catch (error: any) {
        return {
          error: true,
          message: `Failed to delete file: ${error.message}`,
          path,
        };
      }
    },
  };
}

/**
 * apply_patch tool
 * Applies a unified diff (patch) to a file
 * 
 * This is MORE EFFICIENT and SAFER than write_file for:
 * - Modifying specific lines in large files
 * - Making multiple changes in one file
 * - Avoiding sending entire file content
 * 
 * Patch format: Standard unified diff (git diff format)
 * Example:
 * ```
 * @@ -10,5 +10,5 @@
 *  const x = 1;
 * -const y = 2;
 * +const y = 3;
 *  const z = 4;
 * ```
 */
export function createApplyPatchTool(gitPort: GitPort): Tool {
  return {
    definition: {
      name: 'apply_patch',
      description: `Apply a unified diff (patch) to a file. This is MORE EFFICIENT than write_file for modifying existing files.

Use this when:
- Modifying specific lines in a large file (> 50 lines)
- Making multiple changes in one file
- You want precise, line-based modifications

Patch format: Standard unified diff (git diff format)
Example:
\`\`\`diff
@@ -10,3 +10,3 @@
 const x = 1;
-const y = 2;
+const y = 3;
 const z = 4;
\`\`\`

The patch will be applied using git apply, ensuring accuracy and safety.`,
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The file path relative to the project root (e.g., "src/App.tsx")',
          },
          patch: {
            type: 'string',
            description: 'The unified diff patch content (standard git diff format)',
          },
        },
        required: ['path', 'patch'],
      },
    },
    executor: async (input: Record<string, any>) => {
      const { path, patch } = input;
      
      if (!path || typeof path !== 'string') {
        return {
          error: true,
          message: 'Missing or invalid "path" parameter',
        };
      }

      if (!patch || typeof patch !== 'string') {
        return {
          error: true,
          message: 'Missing or invalid "patch" parameter',
        };
      }

      try {
        // Check if file exists
        const exists = await gitPort.fileExists(path);
        if (!exists) {
          return {
            error: true,
            message: `File does not exist: ${path}. Use write_file to create new files.`,
            path,
          };
        }

        // Read original content
        const originalContent = await gitPort.readFile(path);
        if (!originalContent) {
          return {
            error: true,
            message: `Failed to read original file: ${path}`,
            path,
          };
        }

        // Apply patch using simple line-based algorithm
        // (Git-based patch application would be more robust, but this is simpler)
        const patchedContent = applyUnifiedDiff(originalContent, patch);
        
        if (!patchedContent) {
          return {
            error: true,
            message: `Failed to apply patch: Invalid diff format or patch doesn't match file content`,
            path,
            patch,
          };
        }

        // Write patched content
        await gitPort.writeFile(path, patchedContent);

        const originalLines = originalContent.split('\n').length;
        const patchedLines = patchedContent.split('\n').length;
        const delta = patchedLines - originalLines;

        return {
          success: true,
          message: `Patch applied successfully to ${path}`,
          path,
          originalLines,
          patchedLines,
          delta,
        };
      } catch (error: any) {
        return {
          error: true,
          message: `Failed to apply patch: ${error.message}`,
          path,
        };
      }
    },
  };
}

/**
 * Apply unified diff to content
 * Parses unified diff format and applies changes line by line
 */
function applyUnifiedDiff(originalContent: string, patch: string): string | null {
  try {
    const lines = originalContent.split('\n');
    const patchLines = patch.split('\n');

    // Parse hunks from patch
    const hunks: Array<{
      originalStart: number;
      originalCount: number;
      newStart: number;
      newCount: number;
      lines: string[];
    }> = [];

    let currentHunk: typeof hunks[0] | null = null;

    for (const line of patchLines) {
      // Parse hunk header: @@ -10,5 +10,6 @@
      const hunkMatch = line.match(/^@@\s+-(\d+),?(\d*)\s+\+(\d+),?(\d*)\s+@@/);
      if (hunkMatch) {
        if (currentHunk) {
          hunks.push(currentHunk);
        }
        currentHunk = {
          originalStart: parseInt(hunkMatch[1]),
          originalCount: parseInt(hunkMatch[2] || '1'),
          newStart: parseInt(hunkMatch[3]),
          newCount: parseInt(hunkMatch[4] || '1'),
          lines: [],
        };
        continue;
      }

      // Add lines to current hunk
      if (currentHunk) {
        currentHunk.lines.push(line);
      }
    }

    if (currentHunk) {
      hunks.push(currentHunk);
    }

    if (hunks.length === 0) {
      return null;  // No valid hunks found
    }

    // Apply hunks in reverse order to maintain line numbers
    let result = [...lines];

    for (let i = hunks.length - 1; i >= 0; i--) {
      const hunk = hunks[i];
      const startLine = hunk.originalStart - 1;  // 0-indexed

      // Extract changes from hunk
      const removals: number[] = [];
      const additions: string[] = [];
      let lineOffset = 0;

      for (const line of hunk.lines) {
        if (line.startsWith('-')) {
          removals.push(lineOffset);
          lineOffset++;
        } else if (line.startsWith('+')) {
          additions.push(line.substring(1));
        } else if (line.startsWith(' ')) {
          lineOffset++;
        }
      }

      // Apply removals (in reverse to maintain indices)
      for (let j = removals.length - 1; j >= 0; j--) {
        const removeIndex = startLine + removals[j];
        result.splice(removeIndex, 1);
      }

      // Apply additions
      if (additions.length > 0) {
        result.splice(startLine + removals[0] || startLine, 0, ...additions);
      }
    }

    return result.join('\n');
  } catch (error) {
    console.error(`❌ Failed to apply patch:`, error);
    return null;
  }
}

/**
 * mkdir tool
 * Creates a directory (and parent directories if needed)
 */
export function createMkdirTool(gitPort: GitPort): Tool {
  return {
    definition: {
      name: 'mkdir',
      description: 'Create a directory (and parent directories if needed). Use this when setting up new project structure or organizing files.',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The directory path relative to the project root (e.g., "src/components/forms")',
          },
        },
        required: ['path'],
      },
    },
    executor: async (input: Record<string, any>) => {
      const { path } = input;
      
      if (!path || typeof path !== 'string') {
        return {
          error: true,
          message: 'Missing or invalid "path" parameter',
        };
      }

      try {
        await gitPort.createDirectory(path);
        
        return {
          success: true,
          message: `Directory created: ${path}`,
          path,
        };
      } catch (error: any) {
        return {
          error: true,
          message: `Failed to create directory: ${error.message}`,
          path,
        };
      }
    },
  };
}

/**
 * search_code tool
 * Searches for a pattern in the codebase using grep
 */
export function createSearchCodeTool(gitPort: GitPort): Tool {
  return {
    definition: {
      name: 'search_code',
      description: 'Search for a pattern in the codebase using grep. Use this to find where specific code, functions, imports, or text patterns are used across multiple files.',
      input_schema: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'The search pattern (supports regex, e.g., "import.*Inter", "function\\s+\\w+")',
          },
          file_pattern: {
            type: 'string',
            description: 'Optional file pattern to limit search (e.g., "*.ts", "src/**/*.tsx")',
          },
          case_sensitive: {
            type: 'string',
            description: 'Whether the search is case-sensitive (default: false)',
          },
        },
        required: ['pattern'],
      },
    },
    executor: async (input: Record<string, any>) => {
      const { pattern, file_pattern, case_sensitive } = input;
      const chatAPI = getChatAPIClient();
      
      if (!pattern || typeof pattern !== 'string') {
        return {
          error: true,
          message: 'Missing or invalid "pattern" parameter',
        };
      }

      try {
        // ✅ UI: Show grepping status
        await chatAPI.showChatStatus('grepping', { totalFiles: 0 });
        
        // Simple file search (grep may not be implemented yet)
        const allFiles = await gitPort.listFiles('.', [
          'node_modules',
          '.git',
          'dist',
          'build',
        ]);

        const results: any[] = [];
        const regex = new RegExp(pattern, case_sensitive ? '' : 'i');
        const filesToSearch = allFiles.slice(0, 50);  // Limit files to search

        for (const file of filesToSearch) {
          try {
            if (file_pattern) {
              const fileRegex = new RegExp(file_pattern.replace(/\*/g, '.*'));
              if (!fileRegex.test(file)) continue;
            }

            const content = await gitPort.readFile(file);
            if (!content) continue;

            const lines = content.split('\n');
            lines.forEach((line, idx) => {
              if (regex.test(line)) {
                results.push({
                  file,
                  line,
                  lineNumber: idx + 1,
                  snippet: line.trim(),
                });
              }
            });

            if (results.length >= 100) break;  // Stop after 100 results
          } catch {
            // Skip files that can't be read
          }
        }

        const hasMore = results.length >= 100;
        const filesWithMatches = [...new Set(results.map(r => r.file))];

        // ✅ UI: Complete grepping status
        await chatAPI.showChatStatus('grepped', { 
          strategy: case_sensitive ? 'case-sensitive grep' : 'grep',
          filesCount: filesWithMatches.length,
          filesList: filesWithMatches
        });

        return {
          pattern,
          file_pattern,
          results: results.slice(0, 100),
          total: results.length,
          showing: results.length,
          filesMatched: filesWithMatches.length,
          hasMore,
          message: hasMore ? `Showing first 100 results (search limited to 50 files)` : undefined,
        };
      } catch (error: any) {
        console.warn(`⚠️  Search failed: ${error.message}`);
        return {
          error: true,
          message: `Search failed: ${error.message}`,
          pattern,
        };
      }
    },
  };
}

