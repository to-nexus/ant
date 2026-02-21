/**
 * Common Tool Definitions
 * 
 * Shared tool definitions used by both Code and Design jobs.
 * Each job can filter which tools to expose based on their needs.
 * 
 * Tool descriptions with templates are loaded via PromptPort.render()
 * This keeps tool guidance consistent with other prompt templates.
 */

import type { ToolDefinition } from '../../../core/ports/llm';
import type { PromptPort } from '../../../core/ports/prompt';

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
    description: `Edit an existing file by replacing old_str with new_str. The old_str must match the current file content EXACTLY (including whitespace and indentation). Use content from your context (retrieved files, previous reads). If edit fails with "not found", call read_file to get current content and retry.`,
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
    description: 'Execute a shell command. See tool description for restrictions.', // Loaded from template
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
        keep_running: {
          type: 'boolean',
          description: 'For long-running servers: set to true to keep server running beyond task completion (very rare). Default: false (auto-cleanup)',
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
  // ✅ NEW: UI Design specific tools
  read_reference_image: {
    name: 'read_reference_image',
    description: 'Load a reference image for visual analysis. Returns image in base64 format. Use this to analyze design screenshots for color extraction, typography, spacing, and layout.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Image path relative to feature folder (e.g., "inputs/references/homepage-desktop.png")',
        },
      },
      required: ['path'],
    },
  },
  
  list_reference_images: {
    name: 'list_reference_images',
    description: 'List all available reference images in inputs/references/. Use this first to discover what images are available for analysis. Optional subdirectory filter.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          description: 'Optional subdirectory name to filter by',
        },
      },
      required: [],
    },
  },
  
  list_assets: {
    name: 'list_assets',
    description: 'List all runtime asset files in inputs/assets/. Use this to document asset mappings for ui-assets.json. Optional subdirectory filter.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          description: 'Optional subdirectory name to filter by',
        },
      },
      required: [],
    },
  },
} as const satisfies Record<string, ToolDefinition>;

/**
 * Tool names for easy reference
 */
export type ToolName = keyof typeof ARCHITECT_TOOLS;

/**
 * Tools that have template files for their descriptions
 */
const TOOLS_WITH_TEMPLATES = ['run_command'] as const;

/**
 * Get tools by names
 * Basic version - returns tools with default descriptions
 */
export function getToolsByNames(toolNames: ToolName[]): ToolDefinition[] {
  return toolNames.map(name => ARCHITECT_TOOLS[name]);
}

/**
 * Get tools by names with descriptions loaded from templates
 * Uses PromptPort.render() pattern consistent with other prompts
 * 
 * @param toolNames - Tool names to retrieve
 * @param promptPort - PromptPort for loading template descriptions
 */
export async function getToolsByNamesWithTemplates(
  toolNames: ToolName[],
  promptPort?: PromptPort
): Promise<ToolDefinition[]> {
  // Create mutable copies with explicit type
  const tools: ToolDefinition[] = toolNames.map(name => ({ 
    ...ARCHITECT_TOOLS[name],
    description: ARCHITECT_TOOLS[name].description as string  // Make mutable
  }));
  
  if (!promptPort) {
    return tools;
  }
  
  // Load descriptions from templates for tools that have them
  for (const tool of tools) {
    if (TOOLS_WITH_TEMPLATES.includes(tool.name as typeof TOOLS_WITH_TEMPLATES[number])) {
      try {
        const description = await promptPort.render(`code/base/tools/${tool.name}`, {});
        if (description && description.trim()) {
          tool.description = description.trim();
        }
      } catch {
        // Keep default description if template not found
      }
    }
  }
  
  return tools;
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

  // Plan node: read-only exploration (verify existing modules, avoid duplication)
  planExplore: ['read_file', 'list_files', 'search_code'] as ToolName[],

  // Full set for design job (no run_command, no reference)
  design: ['read_file', 'edit_file', 'list_files', 'search_code', 'delete_file', 'mkdir'] as ToolName[],
  
  // UI Design job - includes image/asset tools for multimodal document generation
  uiDesign: [
    'read_file',
    'edit_file',
    'list_files',
    'delete_file',
    'mkdir',
    'read_reference_image',
    'list_reference_images',
    'list_assets',
  ] as ToolName[],
} as const;

