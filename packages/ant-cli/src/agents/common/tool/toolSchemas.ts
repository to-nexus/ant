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
import { ToolName, TOOL_SETS } from './toolCatalog';
// `verifies` is a free-form gate label (typecheck/build/test); the schema
// enum is the SSOT after plan §5.4 retired the gate vocabulary file.
const GATE_ORDER = ['typecheck', 'build', 'test'] as const;

export { ToolName, TOOL_SETS };

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
          description: 'File path relative to feature root. Code files use codebase/ prefix (e.g., codebase/src/main.ts). System/spec design docs use architecture/ (system/, spec/); UI/game-art docs use visual/ (ui/, game-art/).',
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
          description: 'Directory path relative to feature root (optional, defaults to "."). Code dirs use codebase/ prefix (e.g., codebase/src). System/spec design docs are under architecture/ (system/, spec/); UI/game-art docs under visual/ (ui/, game-art/).',
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
    description: 'Search the workspace with ripgrep. Returns matches as `file:line:content`. By default `node_modules`, `vendor`, `.git`, `dist`, `build` are excluded for performance. When you need to inspect installed library source (e.g., `@types/*.d.ts`) the handler auto-detects intent from `file_pattern` and bypasses both the dependency exclude and `.gitignore`; pass `include_dependencies: true` only when you want deps included without scoping a `file_pattern`. Empty results include a `[search context]` block listing the resolved cwd / file_pattern / excludes / dependency mode so you can tell "really absent" from "cut by a filter".',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: {
          type: 'string',
          description: 'Ripgrep regex pattern (Rust regex syntax, no lookaround). Escape literal metacharacters. Examples: "onMouseOver" (literal), "onMouseO(ver|ut)" (alternation), "use(State|Effect|Ref)\\b" (multi-hook).',
        },
        file_pattern: {
          type: 'string',
          description: 'Ripgrep glob, workspace-root-relative — uses the same prefix convention as `read_file` / `edit_file` / `list_files` / `create_file`. Code paths take a `codebase/` prefix; sibling trees use their own (`features/`, `plan/`, `architecture/`, `visual/`, `assets/`, `meta/`, `sessions/`). A pattern with no recognized prefix is auto-corrected to `codebase/...`. A `file_pattern` that explicitly targets `node_modules/` or `vendor/` (e.g. `codebase/apps/web/node_modules/next-intl/**/*.{js,cjs,mjs}`) automatically enables dependency mode — no need to also pass `include_dependencies`. Examples: "codebase/**/*.tsx", "codebase/src/**/*.{ts,tsx}", "!codebase/**/*.test.ts" (exclude), "codebase/node_modules/@types/react/*.d.ts" (auto deps mode).',
        },
        include_dependencies: {
          type: 'boolean',
          description: 'Force dependency mode without a `file_pattern` scoping it (default: false). Auto-inferred to `true` whenever `file_pattern` itself targets `node_modules/` or `vendor/`, so explicit use is only needed for a global deps-included sweep. When on, `node_modules` / `vendor` are kept in scope AND `.gitignore` is bypassed (`.git/` stays hard-excluded).',
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
          description: 'For dev/preview/watch servers (next dev, vite dev, npm run start, cargo run, go run). Default false: spawn → startup window (5s normal / 30s compile-run) → 1 HTTP probe → auto-kill. Set true when you need to probe multiple paths or query the server across multiple run_command rounds; you MUST explicitly kill the PID returned in this tool result before <done>. Do NOT background via `&` / `nohup` — use this flag instead so the runtime tracks the PID and can act as a safety net. See persistent-process-policy injection.',
        },
        oneshot: {
          type: 'boolean',
          description: 'Declare this command as a one-shot operation: it should produce observable output and then exit on its own. When true and the process stays alive past last output, the watchdog reaps it shortly (~3s) instead of waiting the default no-output window. Mutually exclusive with keep_running. Default: false.',
        },
        verifies: {
          type: 'string',
          enum: [...GATE_ORDER] as string[],
          description: 'Verification gate this command exercises; omit when not a gate command.',
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
  list_assets: {
    name: 'list_assets',
    description: 'List all runtime asset files under assets/. Use this to document asset mappings for ui-assets.json. Optional subdirectory filter.',
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
    description: 'Download a file from a URL and save it to assets/. Use this to download Figma-exported asset images (SVG, PNG, etc.) returned by get_design_context. The file is saved under assets/{service|game}/{category}/{filename}. If category is omitted, it is inferred from the file extension (svg→icons, png/jpg/webp→images).',
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
          description: 'Optional subdirectory under assets/{service|game}/ (e.g., "icons", "images"). If omitted, inferred from file extension.',
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
 * Tools that have template files for their descriptions
 */
const TOOLS_WITH_TEMPLATES = ['run_command'] as const;

/**
 * Get tools by names
 * Basic version - returns tools with default descriptions
 */
export function getToolsByNames(toolNames: ToolName[]): ToolDefinition[] {
  return toolNames
    .map(name => ARCHITECT_TOOLS[name as keyof typeof ARCHITECT_TOOLS])
    .filter(Boolean);
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
  const tools: ToolDefinition[] = toolNames
    .filter(name => name in ARCHITECT_TOOLS)
    .map(name => ({ 
      ...ARCHITECT_TOOLS[name as keyof typeof ARCHITECT_TOOLS],
      description: ARCHITECT_TOOLS[name as keyof typeof ARCHITECT_TOOLS].description as string,
    }));
  
  if (!promptPort) {
    return tools;
  }
  
  // Load descriptions from templates for tools that have them
  for (const tool of tools) {
    if (TOOLS_WITH_TEMPLATES.includes(tool.name as typeof TOOLS_WITH_TEMPLATES[number])) {
      try {
        const description = await promptPort.render(`jobs/code/base/tools/${tool.name}`, {});
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


