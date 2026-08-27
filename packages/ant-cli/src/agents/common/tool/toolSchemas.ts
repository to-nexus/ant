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
    description: "Read the system's own state. scope='run' (default): the LIVE run state of this job — the full description (scope/intent) and authored file manifest of tasks already completed, straight from memory (ahead of any on-disk checkpoint, so it includes a sibling that just finished); the prior-completed-files list shows only a truncated taste of each task — call this to expand one, and use it before re-deriving something a prior task already decided. scope='history': this feature's PAST conversation originals (user requests + assistant answers from earlier jobs), including turns already folded into the rolling summary — use it when an injected digest/summary/constraint seems incomplete and the original wording matters.",
    input_schema: {
      type: 'object' as const,
      properties: {
        task: {
          type: 'string',
          description: "scope='run': name or id of a completed task to expand to its full scope + file manifest; omit to list all completed tasks. scope='history': a search text (matched against past user/assistant text) or a turn id; omit to list recent past turns.",
        },
        scope: {
          type: 'string',
          enum: ['run', 'history'],
          description: "'run' (default) = this job's completed tasks. 'history' = this feature's past conversation originals across earlier jobs.",
        },
      },
      required: [],
    },
  },

  edit_file: {
    name: 'edit_file',
    // path first in the schema + "emit path first": the shell of the live
    // edit card opens as soon as the path argument closes (tool_use_delta).
    eagerInputStreaming: true,
    description: `Edit an existing file by replacing old_str with new_str. Emit the path argument first. The old_str must match the current file content EXACTLY (including whitespace and indentation). Use content from your context (retrieved files, previous reads). If edit fails with "not found", call read_file to get current content and retry.`,
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

  create_file: {
    name: 'create_file',
    // Live rendering contract: arguments stream as fragments; the file card
    // opens on `path` and content renders line-by-line as it is generated.
    eagerInputStreaming: true,
    description: 'Create a NEW file — the standard way to author a file. Emit the path argument first, then the complete content; the content streams to the user in real time as you generate it. Fails if the file already exists (use edit_file to modify, or pass overwrite: true only when a full deliberate replacement of an existing file is intended). For very large files, emit an initial create_file and continue with append_file calls.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to feature root. Code files MUST use codebase/ prefix (e.g., codebase/src/main.ts, codebase/internal/handler/auth.go)',
        },
        content: {
          type: 'string',
          description: 'The complete content of the new file',
        },
        overwrite: {
          type: 'boolean',
          description: 'Set true ONLY to deliberately replace an existing file in full. Without it, writing to an existing path fails with a conflict to prevent silent clobber.',
        },
      },
      required: ['path', 'content'],
    },
  },

  append_file: {
    name: 'append_file',
    eagerInputStreaming: true,
    description: 'Append content to the END of an EXISTING file, verbatim. Two uses: (1) continuing a large file you started with create_file (chunked authoring — keep each call a coherent chunk ending at a natural boundary), and (2) resuming a file whose creation was cut off by the output-token limit. Emit the path argument first. Only for content that belongs at the physical end of the file — for middle insertions use edit_file.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Path of the existing file to append to, relative to feature root. Code files MUST use codebase/ prefix.',
        },
        content: {
          type: 'string',
          description: 'Content appended verbatim to the end of the file (no separators are added — include leading newline if needed)',
        },
      },
      required: ['path', 'content'],
    },
  },

  copy_file: {
    name: 'copy_file',
    description:
      'Place an EXISTING file at another path, byte-for-byte. Use this whenever a file must be PLACED rather than authored — most often moving a user-supplied asset out of the workspace asset pool (assets/game/**, assets/service/**) into the location the running app loads it from (e.g. a static-asset root). This is the ONLY way to write a binary file: create_file and edit_file write utf-8 and refuse binary targets, and a text round-trip corrupts the bytes irreversibly. Overwrites the destination if it exists, creates parent directories, and verifies integrity on both sides — a corrupt source is refused rather than copied. Do NOT use it to author new content, and do NOT hand-copy bytes you read from a file.',
    input_schema: {
      type: 'object' as const,
      properties: {
        source: {
          type: 'string',
          description:
            'Path of the existing file to copy, relative to feature root. Asset-pool sources keep their own prefix (e.g. assets/game/models/Duck.glb) — do NOT add a codebase/ prefix to them.',
        },
        destination: {
          type: 'string',
          description:
            'Path to write to, relative to feature root. Code/app paths MUST use the codebase/ prefix (e.g. codebase/public/models/Duck.glb). Parent directories are created automatically.',
        },
      },
      required: ['source', 'destination'],
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
          description:
            'Optional filter on the entry name. A pattern containing glob metacharacters (*, ?, [...]) is matched as a glob ("*.tsx" → every .tsx entry); any other pattern is matched as a plain substring ("Button" → every name containing "Button"). Omit it to list everything — omitting is the right default when you are checking whether a directory or file exists.',
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
  
  search_files: {
    name: 'search_files',
    description: 'Search the working file tree with ripgrep. Returns matches as `file:line:content`. Paths are relative to the working tree root — there is no codebase/ prefix convention. By default `node_modules`, `.git`, `dist`, `build` are excluded. Empty results include a `[search context]` block listing the resolved cwd / file_pattern / excludes so you can tell "really absent" from "cut by a filter".',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: {
          type: 'string',
          description: 'Ripgrep regex pattern (Rust regex syntax, no lookaround). Escape literal metacharacters. Examples: "weekly report" (literal), "on(Load|Init)\\b" (alternation).',
        },
        file_pattern: {
          type: 'string',
          description: 'Ripgrep glob relative to the working tree root, passed verbatim. Examples: "**/*.md", "reports/**/*.{md,csv}", "!**/*.tmp" (exclude).',
        },
        include_dependencies: {
          type: 'boolean',
          description: 'Include `node_modules` / `vendor` and bypass `.gitignore` (default: false). Only relevant when the tree contains an uploaded codebase.',
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
          description: 'Optional git ref. Omit for the project base branch. Ant feature branches are named exactly after the feature.',
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
        branch: { type: 'string', description: 'Optional git ref (default: registered branch / the project base branch).' },
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
        branch: { type: 'string', description: 'Optional git ref (default: registered branch / the project base branch).' },
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
        branch: { type: 'string', description: 'Optional git ref (default: registered branch / the project base branch).' },
      },
      required: ['project', 'pattern'],
    },
  },
  read_ant_source: {
    name: 'read_ant_source',
    description:
      'Read a file from Ant\'s OWN source or docs — the platform running this job (NOT the app you are building). Use when a runtime/serving/build symptom cannot be explained from the app alone (e.g. reproduces only in preview/deploy, not locally) to see how the platform serves apps. Read-only. Large files are truncated — use startLine/endLine to read further sections.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'File path relative to the source root (e.g. "periphery/adapters/http/middleware/deployProxy.ts").' },
        source: { type: 'string', enum: ['cli', 'ui', 'docs'], description: 'Which Ant source: "cli" (backend/serving), "ui" (frontend), "docs". Default: cli.' },
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
    description:
      "List the real asset files placed in this workspace's asset pool, with their sizes. " +
      'The pool root is resolved for you from the workspace domain — call with no arguments ' +
      'to see every asset plus the category names that exist.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          description:
            'Optional single category name to filter by, e.g. "models" or "icons". A name from ' +
            'the `availableCategories` this tool returns — NOT a path, and it does NOT include ' +
            'the pool root (use "models", never "assets/game/models" or "game/models"). Omit ' +
            'to list the whole pool.',
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

  explore: {
    name: 'explore',
    description:
      'Launch a background research subagent that investigates the workspace with read-only tools and returns a distilled report. ASYNC contract: this tool returns IMMEDIATELY with a launch acknowledgment — do NOT wait or poll. The report is injected into this conversation later as a [SUBAGENT REPORT <id>] message, and any still-pending report is always delivered before this phase can conclude. Launch multiple explores in one response for parallel investigation of independent questions, then CONTINUE YOUR OWN WORK on things that do not depend on the reports. Delegate read-heavy, parallelizable investigation or unfamiliar-territory scans; do NOT delegate a single read of a file you already know or a trivial lookup.',
    input_schema: {
      type: 'object' as const,
      properties: {
        goal: {
          type: 'string',
          description:
            'Self-contained investigation brief: what to find out, why it matters, and what a useful answer looks like. The subagent sees ONLY this text (plus hints) — include every path, symbol, or constraint it needs.',
        },
        hints: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional starting points: file paths, directories, symbols, or search terms.',
        },
      },
      required: ['goal'],
    },
  },

  subagent_report: {
    name: 'subagent_report',
    description:
      'Read the full text of a subagent report whose inline form noted omitted content. Instant and read-only. Only useful after a report block that says content was not inlined — it names this tool and an id. Returns a slice plus the total length: jump straight to a section with an offset from the report\'s outline, or page sequentially until the end.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'The subagent id given in the report\'s omission notice.',
        },
        offset: {
          type: 'number',
          description: 'Char offset to read from (use an outline offset for a specific section). Default 0.',
        },
        maxChars: {
          type: 'number',
          description: 'Max chars to return in this slice. Default: the inline report budget.',
        },
      },
      required: ['id'],
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
 * Notice for model-authored parameters outside a tool's schema. The dispatch
 * layer has no arg validation, so an unschema'd param is silently invisible to
 * the handler — the model gets a wrong-but-plausible result and no signal
 * (narrow-ending-flour: read_ant_source + startLine). Warning-append, not
 * reject: the result is usually still useful. Tools without an
 * ARCHITECT_TOOLS entry (MCP overlay, api__*, job-local tools) own their
 * schemas elsewhere and are skipped.
 */
export function unknownParamNotice(toolName: string, args: Record<string, any>): string | undefined {
  const def = ARCHITECT_TOOLS[toolName as keyof typeof ARCHITECT_TOOLS];
  if (!def) return undefined;
  const known = Object.keys(def.input_schema.properties as Record<string, unknown>);
  const unknown = Object.keys(args ?? {}).filter((k) => !known.includes(k));
  if (unknown.length === 0) return undefined;
  return `\n\n⚠️ Ignored unknown parameter(s): ${unknown.join(', ')} — ${toolName} accepts: ${known.join(', ')}.`;
}

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


