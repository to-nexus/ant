/**
 * Tool Catalog — Single source of truth for all tool definitions
 *
 * Every tool in the system MUST be declared here.
 * - ToolName enum: exhaustive list of tool identifiers
 * - TOOL_HANDLERS: ToolName → handler function mapping
 * - TOOL_DISPLAY_NAMES: UI display strings
 * - JOB_TOOL_MATRIX: which job uses which tools
 * - CACHEABLE_TOOLS / SHADOW_ALIASES: behavioral metadata
 *
 * To add a new tool:
 *   1. Add value to ToolName enum
 *   2. Write handler in handlers/
 *   3. Add entry to TOOL_HANDLERS
 *   4. Add entry to TOOL_DISPLAY_NAMES
 *   5. Add to appropriate job(s) in JOB_TOOL_MATRIX
 */

import type { ToolHandler } from './types';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ToolName — exhaustive enumeration of all tools
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export enum ToolName {
  // ── Read (scope: codebase, artifact, ant-source, workspace) ──
  READ_FILE            = 'read_file',
  READ_SOURCE_DOC      = 'read_source_doc',
  READ_ANT_SOURCE      = 'read_ant_source',
  READ_WORKSPACE_FILE  = 'read_workspace_file',

  // ── List (scope: codebase, artifact, ant-source, workspace) ──
  LIST_FILES           = 'list_files',
  LIST_ASSETS          = 'list_assets',
  LIST_ANT_FILES       = 'list_ant_files',
  LIST_WORKSPACE_FILES = 'list_workspace_files',

  // ── Search (scope: codebase, web, reference project, ant-source) ──
  SEARCH_CODE          = 'search_code',
  SEARCH_WEB           = 'search_web',
  SEARCH_REFERENCE     = 'search_reference_code',
  SEARCH_ANT_CODE      = 'search_ant_code',

  // ── Write ──
  EDIT_FILE            = 'edit_file',
  CREATE_FILE          = 'create_file',
  DELETE_FILE          = 'delete_file',
  MKDIR                = 'mkdir',

  // ── Execute ──
  RUN_COMMAND          = 'run_command',

  // ── Fetch / Download ──
  DOWNLOAD_ASSET       = 'download_asset',
  FIGMA_DESIGN_CTX     = 'figma_get_design_context',
  FIGMA_SCREENSHOT     = 'figma_get_screenshot',
  FIGMA_METADATA       = 'figma_get_metadata',
  FIGMA_VARIABLES      = 'figma_get_variable_defs',

  // ── Shadow aliases (LLM sometimes uses these instead of CREATE_FILE) ──
  FILE                 = 'file',
  WRITE_FILE           = 'write_file',
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Job types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export enum JobType {
  CODE   = 'code',
  DESIGN = 'design',
  PLAN   = 'plan',
  ASK    = 'ask',
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TOOL_DISPLAY_NAMES — UI status text per tool
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const TOOL_DISPLAY_NAMES: Record<ToolName, string> = {
  // Read
  [ToolName.READ_FILE]:            '📖 Reading file',
  [ToolName.READ_SOURCE_DOC]:      '📖 Reading source doc',
  [ToolName.READ_ANT_SOURCE]:      '📖 Reading Ant source',
  [ToolName.READ_WORKSPACE_FILE]:  '📖 Reading workspace file',
  // List
  [ToolName.LIST_FILES]:           '📂 Listing files',
  [ToolName.LIST_ASSETS]:          '📦 Listing assets',
  [ToolName.LIST_ANT_FILES]:       '📂 Listing Ant files',
  [ToolName.LIST_WORKSPACE_FILES]: '📂 Listing workspace files',
  // Search
  [ToolName.SEARCH_CODE]:          '🔍 Searching code',
  [ToolName.SEARCH_WEB]:           '🌐 Searching web',
  [ToolName.SEARCH_REFERENCE]:     '🔎 Searching reference',
  [ToolName.SEARCH_ANT_CODE]:      '🔍 Searching Ant code',
  // Write
  [ToolName.EDIT_FILE]:            '✏️ Editing file',
  [ToolName.CREATE_FILE]:          '📄 Creating file',
  [ToolName.DELETE_FILE]:          '🗑️ Deleting file',
  [ToolName.MKDIR]:                '📁 Creating directory',
  // Execute
  [ToolName.RUN_COMMAND]:          '⚙️ Running command',
  // Fetch / Download
  [ToolName.DOWNLOAD_ASSET]:       '📥 Downloading asset',
  [ToolName.FIGMA_DESIGN_CTX]:     '🎨 Fetching Figma design',
  [ToolName.FIGMA_SCREENSHOT]:     '📸 Capturing Figma screenshot',
  [ToolName.FIGMA_METADATA]:       '📋 Fetching Figma metadata',
  [ToolName.FIGMA_VARIABLES]:      '🎨 Fetching Figma variables',
  // Shadow aliases
  [ToolName.FILE]:                 '📄 Creating file',
  [ToolName.WRITE_FILE]:           '📄 Creating file',
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SHADOW_ALIASES — tool names that resolve to another tool's handler
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const SHADOW_ALIASES: ReadonlyMap<ToolName, ToolName> = new Map([
  [ToolName.FILE,       ToolName.CREATE_FILE],
  [ToolName.WRITE_FILE, ToolName.CREATE_FILE],
]);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CACHEABLE_TOOLS — read-only tools whose results can be cached
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const CACHEABLE_TOOLS: ReadonlySet<ToolName> = new Set([
  ToolName.READ_FILE,
  ToolName.LIST_FILES,
  ToolName.SEARCH_CODE,
  ToolName.READ_SOURCE_DOC,
  ToolName.LIST_ASSETS,
]);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FIGMA_TOOLS — grouped for convenience
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const FIGMA_TOOLS: readonly ToolName[] = [
  ToolName.FIGMA_DESIGN_CTX,
  ToolName.FIGMA_SCREENSHOT,
  ToolName.FIGMA_METADATA,
  ToolName.FIGMA_VARIABLES,
] as const;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// JOB_TOOL_MATRIX — declarative: which tools each job uses
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// The matrix below is the AUTHORITATIVE specification.
// presets.ts reads from this matrix — it does not invent tool lists.
//
// Tools marked with (*) have a job-specific handler override.
// All other tools use the default handler from TOOL_HANDLERS.

export const JOB_TOOL_MATRIX: Record<JobType, readonly ToolName[]> = {
  [JobType.CODE]: [
    // Read / List / Search (codebase scope)
    ToolName.READ_FILE,
    ToolName.LIST_FILES,
    ToolName.SEARCH_CODE,
    // Read / Search (reference project scope)
    ToolName.SEARCH_REFERENCE,
    // Search (web)
    ToolName.SEARCH_WEB,
    // Write
    ToolName.EDIT_FILE,
    ToolName.CREATE_FILE,
    ToolName.DELETE_FILE,
    ToolName.MKDIR,
    ToolName.FILE,          // shadow alias
    ToolName.WRITE_FILE,    // shadow alias
    // Execute — (*) wrapped with CodeCommandPolicy
    ToolName.RUN_COMMAND,
    // Fetch (Figma)
    ...FIGMA_TOOLS,
  ],

  [JobType.DESIGN]: [
    // Read / List / Search (codebase scope)
    ToolName.READ_FILE,
    ToolName.LIST_FILES,
    ToolName.SEARCH_CODE,
    // Read (artifact scope)
    ToolName.READ_SOURCE_DOC,
    ToolName.LIST_ASSETS,
    // Search (web)
    ToolName.SEARCH_WEB,
    // Write
    ToolName.EDIT_FILE,
    ToolName.DELETE_FILE,
    ToolName.MKDIR,
    // NOTE: RUN_COMMAND intentionally absent. Design plan + docGen phases
    // are document-producing — `codebaseGate.rejectRunCommand` already
    // short-circuits shell execution, so advertising the tool wasted
    // tokens and produced "unavailable in this phase" failure turns
    // (see `spare-keeping-metal` RCA). Code exploration is covered by
    // `search_code` (ripgrep-backed) + `read_file` / `list_files`.
    // Fetch (Figma + asset download)
    ToolName.DOWNLOAD_ASSET,
    ...FIGMA_TOOLS,
  ],

  [JobType.PLAN]: [
    // Read / List / Search (codebase scope)
    ToolName.READ_FILE,
    ToolName.LIST_FILES,
    ToolName.SEARCH_CODE,
    // Search (web)
    ToolName.SEARCH_WEB,
    // Write
    ToolName.EDIT_FILE,
    ToolName.CREATE_FILE,
    ToolName.MKDIR,
    ToolName.FILE,          // shadow alias
    ToolName.WRITE_FILE,    // shadow alias
  ],

  [JobType.ASK]: [
    // Read / List (ant-source scope)
    ToolName.READ_ANT_SOURCE,
    ToolName.LIST_ANT_FILES,
    // Search (ant-source scope)
    ToolName.SEARCH_ANT_CODE,
    // Read / List (workspace scope)
    ToolName.READ_WORKSPACE_FILE,
    ToolName.LIST_WORKSPACE_FILES,
  ],
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TOOL_SETS — phase/context-level tool groupings
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// JOB_TOOL_MATRIX is the full tool set per job type.
// TOOL_SETS provides finer-grained sub-selections used by
// specific phases/contexts within a job (e.g., plan exploration,
// explain mode, UI design variants).

export const TOOL_SETS = {
  fileOps: [ToolName.READ_FILE, ToolName.EDIT_FILE, ToolName.DELETE_FILE, ToolName.MKDIR] as ToolName[],
  fileBrowsing: [ToolName.LIST_FILES, ToolName.SEARCH_CODE] as ToolName[],
  shell: [ToolName.RUN_COMMAND] as ToolName[],
  reference: [ToolName.SEARCH_REFERENCE] as ToolName[],

  codeBasic: [
    ToolName.READ_FILE, ToolName.EDIT_FILE, ToolName.LIST_FILES,
    ToolName.SEARCH_CODE, ToolName.DELETE_FILE, ToolName.MKDIR, ToolName.RUN_COMMAND,
  ] as ToolName[],

  planExplore: [
    ToolName.READ_FILE, ToolName.LIST_FILES, ToolName.SEARCH_CODE,
    ToolName.SEARCH_WEB, ToolName.RUN_COMMAND,
  ] as ToolName[],

  // Design plan-LLM read-only exploration. NO file-write tools and NO
  // download_asset — plan is for "deciding the solution" only; writing
  // (and asset download) is the docGen node's responsibility.
  designPlanExplore: [
    ToolName.READ_FILE, ToolName.LIST_FILES, ToolName.SEARCH_CODE,
    ToolName.READ_SOURCE_DOC, ToolName.SEARCH_WEB,
  ] as ToolName[],

  // Figma-augmented design plan exploration — adds Figma MCP read tools
  // for UI/spec tasks that need to consult Figma metadata before sealing
  // the plan. Still strictly read-only.
  designPlanFigma: [
    ToolName.READ_FILE, ToolName.LIST_FILES, ToolName.SEARCH_CODE,
    ToolName.READ_SOURCE_DOC, ToolName.SEARCH_WEB,
    ToolName.FIGMA_METADATA, ToolName.FIGMA_DESIGN_CTX, ToolName.FIGMA_SCREENSHOT,
  ] as ToolName[],

  designExplain: [ToolName.READ_FILE, ToolName.LIST_FILES, ToolName.SEARCH_CODE, ToolName.SEARCH_WEB] as ToolName[],
  codeExplain: [ToolName.READ_FILE, ToolName.LIST_FILES, ToolName.SEARCH_CODE, ToolName.SEARCH_WEB] as ToolName[],

  // Design docGen default set — see JOB_TOOL_MATRIX[JobType.DESIGN]
  // rationale for why `RUN_COMMAND` is absent.
  design: [
    ToolName.READ_FILE, ToolName.EDIT_FILE, ToolName.LIST_FILES,
    ToolName.SEARCH_CODE, ToolName.DELETE_FILE, ToolName.MKDIR, ToolName.SEARCH_WEB,
  ] as ToolName[],

  // SEARCH_CODE included so existing-project workspaces can satisfy the
  // Codebase Channel SSOT "MUST inspect" directive even in UI design jobs.
  uiDesignBase: [
    ToolName.READ_FILE, ToolName.EDIT_FILE, ToolName.LIST_FILES,
    ToolName.SEARCH_CODE,
    ToolName.DELETE_FILE, ToolName.MKDIR, ToolName.LIST_ASSETS,
  ] as ToolName[],

  uiDesign: [
    ToolName.READ_FILE, ToolName.EDIT_FILE, ToolName.LIST_FILES,
    ToolName.SEARCH_CODE,
    ToolName.DELETE_FILE, ToolName.MKDIR, ToolName.LIST_ASSETS,
  ] as ToolName[],

  uiDesignFigma: [
    ToolName.READ_FILE, ToolName.EDIT_FILE, ToolName.LIST_FILES,
    ToolName.SEARCH_CODE,
    ToolName.DELETE_FILE, ToolName.MKDIR, ToolName.LIST_ASSETS,
    ToolName.DOWNLOAD_ASSET, ToolName.FIGMA_METADATA,
    ToolName.FIGMA_DESIGN_CTX, ToolName.FIGMA_SCREENSHOT, ToolName.FIGMA_VARIABLES,
  ] as ToolName[],

  // Spec-Figma design variant — see JOB_TOOL_MATRIX[JobType.DESIGN]
  // rationale for why `RUN_COMMAND` is absent.
  specFigma: [
    ToolName.READ_FILE, ToolName.EDIT_FILE, ToolName.LIST_FILES, ToolName.SEARCH_CODE,
    ToolName.DELETE_FILE, ToolName.MKDIR, ToolName.SEARCH_WEB, ToolName.LIST_ASSETS,
    ToolName.DOWNLOAD_ASSET, ToolName.FIGMA_METADATA,
    ToolName.FIGMA_DESIGN_CTX, ToolName.FIGMA_SCREENSHOT, ToolName.FIGMA_VARIABLES,
  ] as ToolName[],

  figmaExplore: [
    ToolName.READ_FILE, ToolName.EDIT_FILE, ToolName.LIST_FILES, ToolName.MKDIR,
    ToolName.FIGMA_METADATA, ToolName.FIGMA_DESIGN_CTX,
    ToolName.FIGMA_SCREENSHOT, ToolName.FIGMA_VARIABLES,
  ] as ToolName[],
} as const;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TOOL_HANDLERS — ToolName → default handler function
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// Tools whose handlers depend on job-specific graph state (e.g.,
// artifact-scope readers, ant-source readers) are not in this map.
// Their handlers are registered at runtime by the job's tool node wrapper.

import {
  handleReadFile,
  handleListFiles,
  handleSearchCode,
  handleDeleteFile,
  handleEditFile,
  handleCreateFile,
  handleMkdir,
  handleSearchWeb,
  handleSearchReferenceCode,
  handleRunCommand,
  handleFigmaTool,
} from './handlers';

export const TOOL_HANDLERS: ReadonlyMap<ToolName, ToolHandler> = new Map<ToolName, ToolHandler>(
  ([
    [ToolName.READ_FILE,        handleReadFile],
    [ToolName.LIST_FILES,       handleListFiles],
    [ToolName.SEARCH_CODE,      handleSearchCode],
    [ToolName.MKDIR,            handleMkdir],
    [ToolName.DELETE_FILE,      handleDeleteFile],
    [ToolName.EDIT_FILE,        handleEditFile],
    [ToolName.CREATE_FILE,      handleCreateFile],
    [ToolName.RUN_COMMAND,      handleRunCommand],
    [ToolName.SEARCH_WEB,       handleSearchWeb],
    [ToolName.SEARCH_REFERENCE, handleSearchReferenceCode],
    // Figma: handler needs tool name argument, so we use a factory
    [ToolName.FIGMA_DESIGN_CTX, (ctx, args) => handleFigmaTool(ctx, args, ToolName.FIGMA_DESIGN_CTX)],
    [ToolName.FIGMA_SCREENSHOT, (ctx, args) => handleFigmaTool(ctx, args, ToolName.FIGMA_SCREENSHOT)],
    [ToolName.FIGMA_METADATA,   (ctx, args) => handleFigmaTool(ctx, args, ToolName.FIGMA_METADATA)],
    [ToolName.FIGMA_VARIABLES,  (ctx, args) => handleFigmaTool(ctx, args, ToolName.FIGMA_VARIABLES)],
  ] as [ToolName, ToolHandler][]),
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Resolve a string tool name to a ToolName enum value.
 * Returns the canonical name for shadow aliases (e.g., 'file' → CREATE_FILE).
 * Returns undefined only if the string is not a valid ToolName at all.
 */
export function resolveToolName(name: string): ToolName | undefined {
  const allValues = new Set(Object.values(ToolName) as string[]);
  if (!allValues.has(name)) return undefined;

  const asEnum = name as ToolName;
  const alias = SHADOW_ALIASES.get(asEnum);
  return alias ?? asEnum;
}

/** Check if a tool name is a Figma MCP tool. */
export function isFigmaTool(name: ToolName): boolean {
  return (FIGMA_TOOLS as readonly string[]).includes(name);
}

/** Get tools for a given job type. */
export function getToolsForJob(job: JobType): readonly ToolName[] {
  return JOB_TOOL_MATRIX[job];
}

/** All unique tool names across all jobs. */
export function getAllToolNames(): ToolName[] {
  const set = new Set<ToolName>();
  for (const tools of Object.values(JOB_TOOL_MATRIX)) {
    for (const t of tools) set.add(t);
  }
  return Array.from(set);
}
