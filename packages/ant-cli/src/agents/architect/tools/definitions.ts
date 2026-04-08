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
    description: 'Read the contents of a file. For large files, returns the beginning with a structural outline and total line count. Use startLine/endLine to read specific sections.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to feature root. Code files MUST use codebase/ prefix (e.g., codebase/src/main.ts, codebase/internal/handler/auth.go)',
        },
        startLine: {
          type: 'number',
          description: 'Start line number (1-based, inclusive). Omit to read from the beginning.',
        },
        endLine: {
          type: 'number',
          description: 'End line number (1-based, inclusive). Omit to read to the end.',
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
          description: 'File path relative to feature root. Code files MUST use codebase/ prefix (e.g., codebase/src/main.ts, codebase/internal/handler/auth.go)',
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
          description: 'Directory path relative to feature root (optional, defaults to "."). Code dirs use codebase/ prefix (e.g., codebase/src)',
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
          description: 'File path relative to feature root. Code files MUST use codebase/ prefix (e.g., codebase/src/old.ts)',
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
          description: 'Directory path relative to feature root. Code dirs MUST use codebase/ prefix (e.g., codebase/src/utils)',
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
          description: 'Working directory relative to feature root (optional, defaults to feature root). Use "codebase" for build/dev commands.',
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

  search_web: {
    name: 'search_web',
    description: 'Search the web for technical information, SDK documentation, API references, framework constraints, or technology best practices. Use when you need current information that may not be in your training data.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query — be specific (e.g., "wagmi v2 connector API", "Next.js 14 app router SSR limitations")',
        },
      },
      required: ['query'],
    },
  },

  // Figma MCP tools (used in UI Design Figma mode)
  figma_get_metadata: {
    name: 'figma_get_metadata',
    description: 'Get structural metadata of a Figma design node. Returns the node tree with types, names, dimensions, and hierarchy. Use this to understand the overall structure before drilling into specific components.',
    input_schema: {
      type: 'object' as const,
      properties: {
        fileKey: {
          type: 'string',
          description: 'Figma file key (from URL: figma.com/design/:fileKey/...)',
        },
        nodeId: {
          type: 'string',
          description: 'Node ID to inspect (e.g., "0:1" for root, or specific node like "123:456")',
        },
      },
      required: ['fileKey', 'nodeId'],
    },
  },

  figma_get_design_context: {
    name: 'figma_get_design_context',
    description: 'Get detailed design context for a Figma node including layout properties, styles, colors, typography, spacing, and auto-layout settings. Returns rich design data for token extraction and spec generation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        fileKey: {
          type: 'string',
          description: 'Figma file key (from URL: figma.com/design/:fileKey/...)',
        },
        nodeId: {
          type: 'string',
          description: 'Node ID to get design context for',
        },
      },
      required: ['fileKey', 'nodeId'],
    },
  },

  figma_get_screenshot: {
    name: 'figma_get_screenshot',
    description: 'Get a screenshot/rendered image of a Figma node. Returns the visual representation for layout analysis and visual verification.',
    input_schema: {
      type: 'object' as const,
      properties: {
        fileKey: {
          type: 'string',
          description: 'Figma file key (from URL: figma.com/design/:fileKey/...)',
        },
        nodeId: {
          type: 'string',
          description: 'Node ID to screenshot',
        },
      },
      required: ['fileKey', 'nodeId'],
    },
  },

  download_asset: {
    name: 'download_asset',
    description: 'Download a file from a URL and save it to inputs/assets/. Use this to download Figma-exported asset images (SVG, PNG, etc.) returned by get_design_context. The file is saved under inputs/assets/{category}/{filename}. If category is omitted, it is inferred from the file extension (svg→icons, png/jpg/webp→images).',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'The URL to download the asset from (e.g., Figma CDN URL)',
        },
        filename: {
          type: 'string',
          description: 'Destination filename (e.g., "logo.svg", "hero-bg.png")',
        },
        category: {
          type: 'string',
          description: 'Optional subdirectory under inputs/assets/ (e.g., "icons", "images"). If omitted, inferred from file extension.',
        },
      },
      required: ['url', 'filename'],
    },
  },

  figma_get_variable_defs: {
    name: 'figma_get_variable_defs',
    description: 'Get variable/token definitions from a Figma file. Returns design tokens including colors, spacing, typography scales, and other variables defined in the Figma file.',
    input_schema: {
      type: 'object' as const,
      properties: {
        fileKey: {
          type: 'string',
          description: 'Figma file key (from URL: figma.com/design/:fileKey/...)',
        },
        nodeId: {
          type: 'string',
          description: 'Node ID scope for variable lookup',
        },
      },
      required: ['fileKey', 'nodeId'],
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

  // Plan node: read-only exploration (verify existing modules, discover dependency APIs, avoid duplication)
  planExplore: ['read_file', 'list_files', 'search_code', 'search_web', 'run_command'] as ToolName[],

  // Design explain mode: read-only exploration (no writes, no run_command)
  designExplain: ['read_file', 'list_files', 'search_code', 'search_web'] as ToolName[],

  // Code explain mode: read-only exploration (identical to designExplain)
  codeExplain: ['read_file', 'list_files', 'search_code', 'search_web'] as ToolName[],

  // Full set for design job (no run_command, no reference)
  design: ['read_file', 'edit_file', 'list_files', 'search_code', 'delete_file', 'mkdir', 'search_web'] as ToolName[],
  
  // UI Design base tools (shared by both reference and Figma modes)
  uiDesignBase: [
    'read_file',
    'edit_file',
    'list_files',
    'delete_file',
    'mkdir',
    'list_assets',
  ] as ToolName[],

  // UI Design by-ref: base + reference image tools
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

  // UI Design by-figma: base + Figma MCP tools + asset download (no reference image tools)
  uiDesignFigma: [
    'read_file',
    'edit_file',
    'list_files',
    'delete_file',
    'mkdir',
    'list_assets',
    'download_asset',
    'figma_get_metadata',
    'figma_get_design_context',
    'figma_get_screenshot',
    'figma_get_variable_defs',
  ] as ToolName[],

  // Spec design + Figma: design tools + Figma MCP + asset download
  specFigma: [
    'read_file',
    'edit_file',
    'list_files',
    'search_code',
    'delete_file',
    'mkdir',
    'search_web',
    'list_assets',
    'download_asset',
    'figma_get_metadata',
    'figma_get_design_context',
    'figma_get_screenshot',
    'figma_get_variable_defs',
  ] as ToolName[],

  // figmaExplore node: Figma MCP tools + file write for exploration output
  figmaExplore: [
    'read_file',
    'edit_file',
    'list_files',
    'mkdir',
    'figma_get_metadata',
    'figma_get_design_context',
    'figma_get_screenshot',
    'figma_get_variable_defs',
  ] as ToolName[],
} as const;

