/**
 * Common Tool Definitions
 * 
 * Shared tool definitions used by both Code and Design jobs.
 * Each job can filter which tools to expose based on their needs.
 */

import type { ToolDefinition } from '../../../core/ports/llm';

/**
 * All available tools for Architect agent
 */
export const ARCHITECT_TOOLS = {
  read_file: {
    name: 'read_file',
    description: 'Read the contents of a file',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to project root',
        },
      },
      required: ['path'],
    },
  },
  
  edit_file: {
    name: 'edit_file',
    description: `Edit an existing file by replacing old_str with new_str. The old_str must match EXACTLY (including whitespace and indentation). If the file content has changed since you last read it, you must read_file again before calling edit_file.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to project root',
        },
        old_str: {
          type: 'string',
          description: 'The exact string to search for (must match file content character-by-character, including all whitespace). Include 3-5 lines of context before and after to ensure uniqueness.',
        },
        new_str: {
          type: 'string',
          description: 'The new string to replace old_str with',
        },
      },
      required: ['path', 'old_str', 'new_str'],
    },
  },
  
  list_files: {
    name: 'list_files',
    description: 'List files in a directory',
    input_schema: {
      type: 'object' as const,
      properties: {
        directory: {
          type: 'string',
          description: 'Directory path (optional, defaults to ".")',
        },
        pattern: {
          type: 'string',
          description: 'Filename pattern to filter (optional)',
        },
      },
      required: [],
    },
  },
  
  search_code: {
    name: 'search_code',
    description: 'Search for a pattern in the codebase',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: {
          type: 'string',
          description: 'Search pattern',
        },
        file_pattern: {
          type: 'string',
          description: 'File pattern to filter (optional)',
        },
      },
      required: ['pattern'],
    },
  },
  
  delete_file: {
    name: 'delete_file',
    description: 'Delete a file from the codebase',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to project root',
        },
      },
      required: ['path'],
    },
  },
  
  mkdir: {
    name: 'mkdir',
    description: 'Create a directory (and parent directories if needed)',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Directory path relative to project root',
        },
      },
      required: ['path'],
    },
  },
  
  run_command: {
    name: 'run_command',
    description: `Execute a shell command. Supports both build commands and server verification.

For servers (npm start, npm run dev, etc.):
- Starts the server and monitors for 10 seconds
- If no errors during startup, returns success
- Automatically terminates after verification
- Use this to verify "does the fix work?" without hanging

Examples:
- npm install, npm run build, npm test (runs to completion)
- npm start, npm run dev (verifies startup, then terminates)`,
    input_schema: {
      type: 'object' as const,
      properties: {
        command: {
          type: 'string',
          description: 'Shell command to execute',
        },
        working_directory: {
          type: 'string',
          description: 'Working directory (optional, defaults to project root)',
        },
      },
      required: ['command'],
    },
  },
  
  search_reference_code: {
    name: 'search_reference_code',
    description: 'Search reference project using semantic search (vector DB). This is the ONLY way to access reference project code since you don\'t know the file paths. Describe what you need and relevant files will be returned with their content.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project: {
          type: 'string',
          description: 'Reference project name (e.g., "ant-pong-be")',
        },
        query: {
          type: 'string',
          description: 'Detailed description of what code you need. Examples: "WebSocket gateway implementation and message handlers", "room management API endpoints and DTOs", "game state types and interfaces"',
        },
        maxFiles: {
          type: 'number',
          description: 'Maximum number of files to return (default: 5, max: 10)',
        },
      },
      required: ['project', 'query'],
    },
  },
} as const satisfies Record<string, ToolDefinition>;

/**
 * Tool names for easy reference
 */
export type ToolName = keyof typeof ARCHITECT_TOOLS;

/**
 * Get tools by names
 */
export function getToolsByNames(toolNames: ToolName[]): ToolDefinition[] {
  return toolNames.map(name => ARCHITECT_TOOLS[name]);
}

/**
 * Common tool sets for different contexts
 */
export const TOOL_SETS = {
  // Basic file operations (read, edit, delete, create dir)
  fileOps: ['read_file', 'edit_file', 'delete_file', 'mkdir'] as ToolName[],
  
  // File browsing (list, search)
  fileBrowsing: ['list_files', 'search_code'] as ToolName[],
  
  // Shell operations
  shell: ['run_command'] as ToolName[],
  
  // Reference project access
  reference: ['search_reference_code'] as ToolName[],
  
  // Full set for code job (without reference)
  codeBasic: ['read_file', 'edit_file', 'list_files', 'search_code', 'delete_file', 'mkdir', 'run_command'] as ToolName[],
  
  // Full set for design job (no run_command, no reference)
  design: ['read_file', 'edit_file', 'list_files', 'search_code', 'delete_file', 'mkdir'] as ToolName[],
} as const;

