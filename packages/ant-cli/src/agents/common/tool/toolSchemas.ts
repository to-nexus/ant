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
  
  read_state: {
    name: 'read_state',
    description: "Read the LIVE run state of this job — the full description (scope/intent) and authored file manifest of tasks already completed, straight from memory (ahead of any on-disk checkpoint, so it includes a sibling that just finished). The prior-completed-files list shows only a truncated taste of each task; call this to expand one. Pass `task` (a completed task's name or id) for its full scope + files; omit `task` to list every completed task. Use it before re-deriving something a prior task already decided — especially a paired feature task's full intent.",
    input_schema: {
      type: 'object' as const,
      properties: {
        task: {
          type: 'string',
          description: 'Name or id of a completed task to expand to its full scope + file manifest. Omit to list all completed tasks.',
        },
      },
      required: [],
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
          description: 'For dev/preview/watch servers (next dev, vite dev, npm run start, cargo run, go run). Default false: spawn → startup window (5s normal / 30s compile-run) → 1 HTTP probe of "/" → auto-kill. Set true to keep the server alive across rounds; the result reports server_pid + server_url, and you then use the `http_request` tool to verify specific routes/methods. You MUST explicitly kill the server_pid before <done>. Do NOT background via `&` / `nohup` — use this flag so the runtime tracks the PID/port and can act as a safety net. See persistent-process-policy injection.',
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

  http_request: {
    name: 'http_request',
    description: 'Make an HTTP request to a running dev server route. See tool description.', // Loaded from template
    input_schema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'Absolute URL, OR a path beginning with "/" (e.g. "/api/auth/callback?code=x") which is resolved against the most-recently-started keep_running dev server. Required.',
        },
        method: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
          description: 'HTTP method (default GET).',
        },
        headers: {
          type: 'object' as const,
          description: 'Request headers as a string→string map (e.g. {"content-type":"application/json"}).',
        },
        body: {
          type: 'string',
          description: 'Raw request body (e.g. a JSON string). Omit for GET/HEAD.',
        },
        port: {
          type: 'number',
          description: 'Override the auto-resolved dev-server port (only when url is a path).',
        },
        follow_redirects: {
          type: 'boolean',
          description: 'Follow 3xx Location chains (default false — the redirect chain is returned as facts so you can judge).',
        },
      },
      required: ['url'],
    },
  },

  register_reference: {
    name: 'register_reference',
    description:
      'Register a related project (a sibling project in your workspace) as a code reference so you can read its source directly. Call this the moment you realize another project holds contracts/APIs/types you must match. After registering, use list_reference_files / read_reference_file / search_reference_code with the same project name. Read-only — you can never modify a reference project.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project: {
          type: 'string',
          description: 'Reference project name from your workspace (e.g., "my-backend").',
        },
        branch: {
          type: 'string',
          description: 'Optional git ref. Omit for the default branch (main). A feature is "feature/{name}".',
        },
      },
      required: ['project'],
    },
  },
  read_reference_file: {
    name: 'read_reference_file',
    description:
      'Read one file from a registered reference project. Path is relative to that project\'s codebase root. Large files require startLine/endLine. Register the project first with register_reference.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Registered reference project name.' },
        path: { type: 'string', description: 'File path relative to the reference codebase root.' },
        branch: { type: 'string', description: 'Optional git ref (default: registered branch / main).' },
        startLine: { type: 'number', description: 'Optional 1-based start line (inclusive).' },
        endLine: { type: 'number', description: 'Optional 1-based end line (inclusive).' },
      },
      required: ['project', 'path'],
    },
  },
  list_reference_files: {
    name: 'list_reference_files',
    description:
      'List a directory in a registered reference project. Register the project first with register_reference.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Registered reference project name.' },
        directory: { type: 'string', description: 'Directory relative to the reference codebase root (default: root).' },
        branch: { type: 'string', description: 'Optional git ref (default: registered branch / main).' },
        pattern: { type: 'string', description: 'Optional substring filter on entry names.' },
      },
      required: ['project'],
    },
  },
  search_reference_code: {
    name: 'search_reference_code',
    description:
      'Search a registered reference project\'s code. `pattern` is a ripgrep/regex; `file_pattern` is an optional glob. Register the project first with register_reference.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Registered reference project name.' },
        pattern: { type: 'string', description: 'Ripgrep regex to search for (Rust regex syntax).' },
        file_pattern: { type: 'string', description: 'Optional ripgrep glob to scope the search (e.g. "**/*.ts").' },
        branch: { type: 'string', description: 'Optional git ref (default: registered branch / main).' },
      },
      required: ['project', 'pattern'],
    },
  },
  read_ant_source: {
    name: 'read_ant_source',
    description:
      'Read a file from Ant\'s OWN source or docs — the platform running this job (NOT the app you are building). Use when a runtime/serving/build symptom cannot be explained from the app alone (e.g. reproduces only in preview/deploy, not locally) to see how the platform serves apps. Read-only.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'File path relative to the source root (e.g. "periphery/adapters/http/middleware/deployProxy.ts").' },
        source: { type: 'string', enum: ['cli', 'ui', 'docs'], description: 'Which Ant source: "cli" (backend/serving), "ui" (frontend), "docs". Default: cli.' },
      },
      required: ['path'],
    },
  },
  list_ant_files: {
    name: 'list_ant_files',
    description:
      'List a directory in Ant\'s own source or docs. Use to discover platform source structure before reading (e.g. the preview/deploy middleware). Read-only.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Directory path relative to the source root.' },
        source: { type: 'string', enum: ['cli', 'ui', 'docs'], description: 'Which Ant source. Default: cli.' },
      },
      required: ['path'],
    },
  },
  search_ant_code: {
    name: 'search_ant_code',
    description:
      'Search Ant\'s own source or docs for a substring. Use to locate where the platform implements a behavior (e.g. basePath injection, proxy routing) when diagnosing an app↔platform boundary symptom. Read-only.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Substring to search for (2-100 chars).' },
        source: { type: 'string', enum: ['cli', 'ui', 'docs'], description: 'Which Ant source. Default: cli.' },
        filePattern: { type: 'string', description: 'Optional file suffix filter (e.g. "*.ts", "*.md"). Default: *.ts (cli/ui) or *.md (docs).' },
      },
      required: ['query'],
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
    description: 'Search the web by KEYWORD for technical information, SDK documentation, API references, framework constraints, or technology best practices. Use when you need current information that may not be in your training data. This is a keyword search — to read the content of a SPECIFIC URL, use fetch_url instead.',
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

  fetch_url: {
    name: 'fetch_url',
    description: 'Fetch and read the page content of a SPECIFIC URL. Use when the directive names a concrete URL, live site, or deployed page to analyze — this retrieves that page\'s actual content. This is NOT a keyword search: to discover pages by keyword use search_web, to read a page whose URL you already have use fetch_url. Do not overlap the two.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'The absolute URL to fetch (e.g., "https://example.com/pricing").',
        },
      },
      required: ['url'],
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
const TOOLS_WITH_TEMPLATES = ['run_command', 'http_request'] as const;

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


