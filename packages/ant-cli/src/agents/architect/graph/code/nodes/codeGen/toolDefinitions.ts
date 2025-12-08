/**
 * Tool Definitions for CodeGen Node
 * 
 * Extracted from original codeGen.ts:
 * - getAvailableTools: Returns tool definitions based on state
 */

import { ArchitectGraphState } from "../../state";
import type { ToolDefinition } from "../../../../../../core/ports/llm";

/**
 * Get available tools (filtered by state)
 */
export function getAvailableTools(state: ArchitectGraphState): ToolDefinition[] {
  const hasReferences = state.referenceRequests && state.referenceRequests.length > 0;
  
  // ✅ Return properly typed tool definitions
  const baseTools: ToolDefinition[] = [
    {
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
    {
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
    {
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
    {
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
    {
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
    {
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
    }
  ];
  
  // ✅ Add search_reference_code tool ONLY if references are available
  if (hasReferences) {
    baseTools.push({
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
    });
  }
  
  return baseTools;
}
