/**
 * Tool Catalog — Single source of truth for all tool definitions
 *
 * Every tool in the system MUST be declared here.
 * - ToolName enum: exhaustive list of tool identifiers
 * - TOOL_HANDLERS: ToolName → handler function mapping
 * - TOOL_DISPLAY_NAMES: UI display strings
 * - JOB_TOOL_MATRIX: which job uses which tools
 * - CACHEABLE_TOOLS: behavioral metadata
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
  READ_REFERENCE_FILE  = 'read_reference_file',
  // ── Read (scope: live run state — completed-task scope/manifest) ──
  READ_STATE           = 'read_state',

  // ── List (scope: codebase, artifact, ant-source, workspace, reference) ──
  LIST_FILES           = 'list_files',
  LIST_ASSETS          = 'list_assets',
  LIST_ANT_FILES       = 'list_ant_files',
  LIST_WORKSPACE_FILES = 'list_workspace_files',
  LIST_REFERENCE_FILES = 'list_reference_files',

  // ── Reference registration (cross-project code exploration) ──
  REGISTER_REFERENCE   = 'register_reference',

  // ── Search (scope: codebase, web, reference project, ant-source) ──
  SEARCH_CODE          = 'search_code',
  SEARCH_WEB           = 'search_web',
  FETCH_URL            = 'fetch_url',
  SEARCH_REFERENCE     = 'search_reference_code',
  SEARCH_ANT_CODE      = 'search_ant_code',

  // ── Write ──
  EDIT_FILE            = 'edit_file',
  CREATE_FILE          = 'create_file',
  DELETE_FILE          = 'delete_file',
  MKDIR                = 'mkdir',
  // Byte-faithful placement — the only write path that survives a binary
  // payload (every authoring surface writes utf-8 and refuses binary targets).
  COPY_FILE            = 'copy_file',

  // ── Execute ──
  RUN_COMMAND          = 'run_command',
  HTTP_REQUEST         = 'http_request',

  // ── Delegate (async explore subagent — read-only in-process child) ──
  EXPLORE              = 'explore',
  SUBAGENT_REPORT      = 'subagent_report',

  // ── Fetch / Download ──
  DOWNLOAD_ASSET       = 'download_asset',
  FIGMA_DESIGN_CTX     = 'figma_get_design_context',
  FIGMA_SCREENSHOT     = 'figma_get_screenshot',
  FIGMA_METADATA       = 'figma_get_metadata',
  FIGMA_VARIABLES      = 'figma_get_variable_defs',
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
  [ToolName.READ_STATE]:           '🧠 Reading run state',
  [ToolName.READ_SOURCE_DOC]:      '📖 Reading source doc',
  [ToolName.READ_ANT_SOURCE]:      '📖 Reading Ant source',
  [ToolName.READ_WORKSPACE_FILE]:  '📖 Reading workspace file',
  [ToolName.READ_REFERENCE_FILE]:  '📖 Reading reference file',
  // List
  [ToolName.LIST_FILES]:           '📂 Listing files',
  [ToolName.LIST_ASSETS]:          '📦 Listing assets',
  [ToolName.LIST_ANT_FILES]:       '📂 Listing Ant files',
  [ToolName.LIST_WORKSPACE_FILES]: '📂 Listing workspace files',
  [ToolName.LIST_REFERENCE_FILES]: '📂 Listing reference files',
  // Reference registration
  [ToolName.REGISTER_REFERENCE]:   '🔗 Registering reference project',
  // Search
  [ToolName.SEARCH_CODE]:          '🔍 Searching code',
  [ToolName.SEARCH_WEB]:           '🌐 Searching web',
  [ToolName.FETCH_URL]:            '🌐 Fetching URL',
  [ToolName.SEARCH_REFERENCE]:     '🔎 Searching reference',
  [ToolName.SEARCH_ANT_CODE]:      '🔍 Searching Ant code',
  // Write
  [ToolName.EDIT_FILE]:            '✏️ Editing file',
  [ToolName.CREATE_FILE]:          '📄 Creating file',
  [ToolName.DELETE_FILE]:          '🗑️ Deleting file',
  [ToolName.MKDIR]:                '📁 Creating directory',
  [ToolName.COPY_FILE]:            '📦 Placing file',
  // Execute
  [ToolName.RUN_COMMAND]:          '⚙️ Running command',
  [ToolName.HTTP_REQUEST]:         '🌐 HTTP request',
  // Delegate
  [ToolName.EXPLORE]:              '🧭 Launching explorer',
  [ToolName.SUBAGENT_REPORT]:      '📄 Reading subagent report',
  // Fetch / Download
  [ToolName.DOWNLOAD_ASSET]:       '📥 Downloading asset',
  [ToolName.FIGMA_DESIGN_CTX]:     '🎨 Fetching Figma design',
  [ToolName.FIGMA_SCREENSHOT]:     '📸 Capturing Figma screenshot',
  [ToolName.FIGMA_METADATA]:       '📋 Fetching Figma metadata',
  [ToolName.FIGMA_VARIABLES]:      '🎨 Fetching Figma variables',
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CACHEABLE_TOOLS — read-only tools whose results can be cached
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const CACHEABLE_TOOLS: ReadonlySet<ToolName> = new Set([
  ToolName.READ_FILE,
  ToolName.LIST_FILES,
  ToolName.SEARCH_CODE,
  ToolName.READ_SOURCE_DOC,
  ToolName.LIST_ASSETS,
  // Reference reads are pure (project+branch+path in args) → cacheable.
  // register_reference is NOT cacheable (it emits a state side-effect).
  ToolName.READ_REFERENCE_FILE,
  ToolName.LIST_REFERENCE_FILES,
  ToolName.SEARCH_REFERENCE,
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
    // Read (live run-state scope — completed-task full scope + manifest)
    ToolName.READ_STATE,
    // Reference project scope (cross-project code exploration)
    ToolName.REGISTER_REFERENCE,
    ToolName.READ_REFERENCE_FILE,
    ToolName.LIST_REFERENCE_FILES,
    ToolName.SEARCH_REFERENCE,
    // Ant-source self-diagnosis (platform + framework source, always-on)
    ToolName.READ_ANT_SOURCE,
    ToolName.LIST_ANT_FILES,
    ToolName.SEARCH_ANT_CODE,
    // Search (web) + fetch a specific URL's page content
    ToolName.SEARCH_WEB,
    ToolName.FETCH_URL,
    // Write
    ToolName.EDIT_FILE,
    ToolName.CREATE_FILE,
    ToolName.DELETE_FILE,
    ToolName.MKDIR,
    // Byte-faithful placement of an already-existing file (binary assets can
    // enter the codebase ONLY this way — the authoring surfaces are utf-8).
    ToolName.COPY_FILE,
    // Execute — (*) wrapped with CodeCommandPolicy
    ToolName.RUN_COMMAND,
    // Runtime route verification — only surfaced when persistent processes are
    // allowed (error / runtime-error verify); see plan/execute tool selectors.
    ToolName.HTTP_REQUEST,
    // Delegate (async explore subagent)
    ToolName.EXPLORE,
    ToolName.SUBAGENT_REPORT,
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
    // Reference project scope (cross-project code exploration — read-only)
    ToolName.REGISTER_REFERENCE,
    ToolName.READ_REFERENCE_FILE,
    ToolName.LIST_REFERENCE_FILES,
    ToolName.SEARCH_REFERENCE,
    // Ant-source self-diagnosis (platform + framework source, always-on)
    ToolName.READ_ANT_SOURCE,
    ToolName.LIST_ANT_FILES,
    ToolName.SEARCH_ANT_CODE,
    // Search (web) + fetch a specific URL's page content
    ToolName.SEARCH_WEB,
    ToolName.FETCH_URL,
    // Write
    ToolName.EDIT_FILE,
    ToolName.DELETE_FILE,
    ToolName.MKDIR,
    // NOTE: RUN_COMMAND intentionally absent. Design plan + execute phases
    // are document-producing — `codebaseGate.rejectRunCommand` already
    // short-circuits shell execution, so advertising the tool wasted
    // tokens and produced "unavailable in this phase" failure turns
    // (see `spare-keeping-metal` RCA). Code exploration is covered by
    // `search_code` (ripgrep-backed) + `read_file` / `list_files`.
    // Delegate (async explore subagent)
    ToolName.EXPLORE,
    ToolName.SUBAGENT_REPORT,
    // Fetch (Figma + asset download)
    ToolName.DOWNLOAD_ASSET,
    ...FIGMA_TOOLS,
  ],

  [JobType.PLAN]: [
    // Read / List / Search (codebase scope)
    ToolName.READ_FILE,
    ToolName.LIST_FILES,
    ToolName.SEARCH_CODE,
    // Search (web) + fetch a specific URL's page content
    ToolName.SEARCH_WEB,
    ToolName.FETCH_URL,
    // Write
    ToolName.EDIT_FILE,
    ToolName.CREATE_FILE,
    ToolName.MKDIR,
    // Delegate (async explore subagent)
    ToolName.EXPLORE,
    ToolName.SUBAGENT_REPORT,
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
    // Delegate (async explore subagent)
    ToolName.EXPLORE,
    ToolName.SUBAGENT_REPORT,
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

// Ant-source self-diagnosis tools — spread into every code/design work set so
// the LLM ALWAYS sees them (always-on, not presence-gated). Reads Ant's own
// in-image platform source + framework deps when a symptom can't be explained
// from the app alone. See jobs/shared/injections/shared-source-diagnosis.md.
const ANT_SOURCE_TOOLS: ToolName[] = [
  ToolName.READ_ANT_SOURCE,
  ToolName.LIST_ANT_FILES,
  ToolName.SEARCH_ANT_CODE,
];

export const TOOL_SETS = {
  fileOps: [ToolName.READ_FILE, ToolName.EDIT_FILE, ToolName.DELETE_FILE, ToolName.MKDIR] as ToolName[],
  fileBrowsing: [ToolName.LIST_FILES, ToolName.SEARCH_CODE] as ToolName[],
  shell: [ToolName.RUN_COMMAND] as ToolName[],
  reference: [
    ToolName.REGISTER_REFERENCE,
    ToolName.READ_REFERENCE_FILE,
    ToolName.LIST_REFERENCE_FILES,
    ToolName.SEARCH_REFERENCE,
  ] as ToolName[],

  // CREATE_FILE is advertised in the code execute set only — plan/design jobs
  // stream documents via the `<file>` tag and deliberately expose no create
  // tool. Even in code execute, the `<file>` tag stays the preferred path
  // (real-time streaming); create_file is the tool-loop fallback.
  // COPY_FILE sits beside the authoring tools here, not in planExplore: the
  // plan phase is read-only and expresses a placement declaratively via
  // `implementation.assets[]`; execute is what carries it out.
  codeBasic: [
    ToolName.READ_FILE, ToolName.READ_STATE, ToolName.EDIT_FILE, ToolName.CREATE_FILE,
    ToolName.COPY_FILE,
    ToolName.LIST_FILES,
    ToolName.SEARCH_CODE, ToolName.DELETE_FILE, ToolName.MKDIR, ToolName.RUN_COMMAND,
    ToolName.EXPLORE,
    ToolName.SUBAGENT_REPORT,
    ...ANT_SOURCE_TOOLS,
  ] as ToolName[],

  planExplore: [
    ToolName.READ_FILE, ToolName.READ_STATE, ToolName.LIST_FILES, ToolName.SEARCH_CODE,
    ToolName.SEARCH_WEB, ToolName.FETCH_URL, ToolName.RUN_COMMAND,
    ToolName.EXPLORE,
    ToolName.SUBAGENT_REPORT,
    ...ANT_SOURCE_TOOLS,
  ] as ToolName[],

  // Design plan-LLM read-only exploration. NO file-write tools and NO
  // download_asset — plan is for "deciding the solution" only; writing
  // (and asset download) is the execute node's responsibility. LIST_ASSETS
  // is a READ (directory survey of assets/{domain}/): the plan phase is
  // where attached/placed real assets must be discovered, or they never
  // reach the sealed plan (fierce-gaining-gully).
  designPlanExplore: [
    ToolName.READ_FILE, ToolName.LIST_FILES, ToolName.SEARCH_CODE,
    ToolName.READ_SOURCE_DOC, ToolName.SEARCH_WEB, ToolName.FETCH_URL,
    ToolName.LIST_ASSETS,
    ToolName.EXPLORE,
    ToolName.SUBAGENT_REPORT,
    ...ANT_SOURCE_TOOLS,
  ] as ToolName[],

  // Figma-augmented design plan exploration — adds Figma MCP read tools
  // for UI/spec tasks that need to consult Figma metadata before sealing
  // the plan. Still strictly read-only.
  designPlanFigma: [
    ToolName.READ_FILE, ToolName.LIST_FILES, ToolName.SEARCH_CODE,
    ToolName.READ_SOURCE_DOC, ToolName.SEARCH_WEB, ToolName.FETCH_URL,
    ToolName.LIST_ASSETS,
    ToolName.FIGMA_METADATA, ToolName.FIGMA_DESIGN_CTX, ToolName.FIGMA_SCREENSHOT,
    ToolName.EXPLORE,
    ToolName.SUBAGENT_REPORT,
    ...ANT_SOURCE_TOOLS,
  ] as ToolName[],

  designExplain: [ToolName.READ_FILE, ToolName.LIST_FILES, ToolName.SEARCH_CODE, ToolName.SEARCH_WEB, ToolName.FETCH_URL, ToolName.EXPLORE, ToolName.SUBAGENT_REPORT, ...ANT_SOURCE_TOOLS] as ToolName[],
  codeExplain: [ToolName.READ_FILE, ToolName.READ_STATE, ToolName.LIST_FILES, ToolName.SEARCH_CODE, ToolName.SEARCH_WEB, ToolName.FETCH_URL, ToolName.EXPLORE, ToolName.SUBAGENT_REPORT, ...ANT_SOURCE_TOOLS] as ToolName[],

  // Design execute default set — see JOB_TOOL_MATRIX[JobType.DESIGN]
  // rationale for why `RUN_COMMAND` is absent. `LIST_ASSETS` is included so the
  // game-art execute (which falls through to this set) and spec execute can
  // survey the real `assets/{domain}/` pool to ground `kind:'external'`
  // catalog entries — the prompt already instructs `list_assets`.
  design: [
    ToolName.READ_FILE, ToolName.EDIT_FILE, ToolName.LIST_FILES,
    ToolName.SEARCH_CODE, ToolName.DELETE_FILE, ToolName.MKDIR, ToolName.SEARCH_WEB, ToolName.FETCH_URL,
    ToolName.LIST_ASSETS, ToolName.EXPLORE, ToolName.SUBAGENT_REPORT,
    ...ANT_SOURCE_TOOLS,
  ] as ToolName[],

  // SEARCH_CODE included so existing-project workspaces can satisfy the
  // Codebase Channel SSOT "MUST inspect" directive even in UI design jobs.
  uiDesignBase: [
    ToolName.READ_FILE, ToolName.EDIT_FILE, ToolName.LIST_FILES,
    ToolName.SEARCH_CODE,
    ToolName.DELETE_FILE, ToolName.MKDIR, ToolName.LIST_ASSETS,
    ToolName.EXPLORE,
    ToolName.SUBAGENT_REPORT,
    ...ANT_SOURCE_TOOLS,
  ] as ToolName[],

  uiDesign: [
    ToolName.READ_FILE, ToolName.EDIT_FILE, ToolName.LIST_FILES,
    ToolName.SEARCH_CODE,
    ToolName.DELETE_FILE, ToolName.MKDIR, ToolName.LIST_ASSETS,
    ToolName.EXPLORE,
    ToolName.SUBAGENT_REPORT,
    ...ANT_SOURCE_TOOLS,
  ] as ToolName[],

  uiDesignFigma: [
    ToolName.READ_FILE, ToolName.EDIT_FILE, ToolName.LIST_FILES,
    ToolName.SEARCH_CODE,
    ToolName.DELETE_FILE, ToolName.MKDIR, ToolName.LIST_ASSETS,
    ToolName.DOWNLOAD_ASSET, ToolName.FIGMA_METADATA,
    ToolName.FIGMA_DESIGN_CTX, ToolName.FIGMA_SCREENSHOT, ToolName.FIGMA_VARIABLES,
    ToolName.EXPLORE,
    ToolName.SUBAGENT_REPORT,
    ...ANT_SOURCE_TOOLS,
  ] as ToolName[],

  // Spec-Figma design variant — see JOB_TOOL_MATRIX[JobType.DESIGN]
  // rationale for why `RUN_COMMAND` is absent.
  specFigma: [
    ToolName.READ_FILE, ToolName.EDIT_FILE, ToolName.LIST_FILES, ToolName.SEARCH_CODE,
    ToolName.DELETE_FILE, ToolName.MKDIR, ToolName.SEARCH_WEB, ToolName.FETCH_URL, ToolName.LIST_ASSETS,
    ToolName.DOWNLOAD_ASSET, ToolName.FIGMA_METADATA,
    ToolName.FIGMA_DESIGN_CTX, ToolName.FIGMA_SCREENSHOT, ToolName.FIGMA_VARIABLES,
    ToolName.EXPLORE,
    ToolName.SUBAGENT_REPORT,
    ...ANT_SOURCE_TOOLS,
  ] as ToolName[],

  figmaExplore: [
    ToolName.READ_FILE, ToolName.EDIT_FILE, ToolName.LIST_FILES, ToolName.MKDIR,
    ToolName.FIGMA_METADATA, ToolName.FIGMA_DESIGN_CTX,
    ToolName.FIGMA_SCREENSHOT, ToolName.FIGMA_VARIABLES,
  ] as ToolName[],

  // ── Explore-subagent child sets — strictly read-only, and NEVER contain
  // EXPLORE itself (depth-1: a child cannot launch children). Guarded by
  // tests/subagent/catalog-drift.test.ts.
  subagentCode: [
    ToolName.READ_FILE, ToolName.LIST_FILES, ToolName.SEARCH_CODE, ToolName.READ_STATE,
  ] as ToolName[],
  subagentDesign: [
    ToolName.READ_FILE, ToolName.LIST_FILES, ToolName.SEARCH_CODE, ToolName.READ_SOURCE_DOC,
  ] as ToolName[],
  subagentPlanner: [
    ToolName.READ_FILE, ToolName.LIST_FILES, ToolName.SEARCH_CODE,
  ] as ToolName[],
  subagentAsk: [
    ToolName.READ_ANT_SOURCE, ToolName.LIST_ANT_FILES, ToolName.SEARCH_ANT_CODE,
    ToolName.READ_WORKSPACE_FILE, ToolName.LIST_WORKSPACE_FILES,
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
  handleReadState,
  handleListFiles,
  handleSearchCode,
  handleDeleteFile,
  handleEditFile,
  handleCreateFile,
  handleCopyFile,
  handleMkdir,
  handleSearchWeb,
  handleFetchUrl,
  handleSearchReferenceCode,
  handleRegisterReference,
  handleReadReferenceFile,
  handleListReferenceFiles,
  handleReadAntSource,
  handleListAntFiles,
  handleSearchAntCode,
  handleRunCommand,
  handleHttpRequest,
  handleFigmaTool,
  handleExplore,
  handleSubagentReport,
} from './handlers';

export const TOOL_HANDLERS: ReadonlyMap<ToolName, ToolHandler> = new Map<ToolName, ToolHandler>(
  ([
    [ToolName.READ_FILE,        handleReadFile],
    [ToolName.READ_STATE,       handleReadState],
    [ToolName.LIST_FILES,       handleListFiles],
    [ToolName.SEARCH_CODE,      handleSearchCode],
    [ToolName.MKDIR,            handleMkdir],
    [ToolName.DELETE_FILE,      handleDeleteFile],
    [ToolName.EDIT_FILE,        handleEditFile],
    [ToolName.CREATE_FILE,      handleCreateFile],
    [ToolName.COPY_FILE,        handleCopyFile],
    [ToolName.RUN_COMMAND,      handleRunCommand],
    [ToolName.HTTP_REQUEST,     handleHttpRequest],
    // Delegate — ctx-dependent (requires ctx.subagent seam, like read_state's ctx.completedTasks)
    [ToolName.EXPLORE,          handleExplore],
    // Drill-down into a compacted explore report (ctx-free, process-local store)
    [ToolName.SUBAGENT_REPORT,  handleSubagentReport],
    [ToolName.SEARCH_WEB,       handleSearchWeb],
    [ToolName.FETCH_URL,        handleFetchUrl],
    [ToolName.SEARCH_REFERENCE, handleSearchReferenceCode],
    [ToolName.REGISTER_REFERENCE,   handleRegisterReference],
    [ToolName.READ_REFERENCE_FILE,  handleReadReferenceFile],
    [ToolName.LIST_REFERENCE_FILES, handleListReferenceFiles],
    // ant-source self-diagnosis (ctx-independent — reads Ant's own in-image source)
    [ToolName.READ_ANT_SOURCE,      handleReadAntSource],
    [ToolName.LIST_ANT_FILES,       handleListAntFiles],
    [ToolName.SEARCH_ANT_CODE,      handleSearchAntCode],
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
 * Returns undefined if the string is not a valid ToolName.
 */
export function resolveToolName(name: string): ToolName | undefined {
  const allValues = new Set(Object.values(ToolName) as string[]);
  return allValues.has(name) ? (name as ToolName) : undefined;
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
