/**
 * Universal-job builtin tool inventory — the SSOT name lists shared by the
 * BE tool policy (allowlist validation, approval defaults, stop-hook
 * satisfiability H7/H8) and the FE agent-settings editors (action picker,
 * artifact-hook satisfiability hints). Runtime behaviour (approval decisions,
 * plan-turn confinement, clarify budget) stays BE-only in
 * `ant-cli/core/customAgents/universalToolPolicy.ts`, which re-exports these.
 *
 * Domain-bound tools (search_code, read_workspace_file, list_assets,
 * figma_*, …) are deliberately absent: universal has no canonical codebase,
 * no RAC, no design asset pool. Extra capability comes from MCP.
 *
 * The ant-source family (read_ant_source / list_ant_files / search_ant_code)
 * is IN the preset despite that stance: it is domain-free (reads Ant's own
 * shipped docs/source, no workspace or RAC involved), read-only, and it is
 * what lets any universal agent answer questions about the Ant platform
 * itself from the actual code instead of hedging or web-guessing
 * (steady-caring-depth RCA).
 */

export const UNIVERSAL_BUILTIN_TOOLS = [
  // read / explore (artifact tree)
  'read_file',
  'list_files',
  'search_files',
  // write (artifact tree)
  'create_file',
  'edit_file',
  'append_file',
  'delete_file',
  'mkdir',
  'copy_file',
  // web
  'fetch_url',
  'search_web',
  // external calls
  'http_request',
  // command execution
  'run_command',
  // subagent
  'explore',
  'subagent_report',
  // state
  'read_state',
  // Ant platform self-source (read-only, domain-free)
  'read_ant_source',
  'list_ant_files',
  'search_ant_code',
] as const;

export type UniversalBuiltinTool = typeof UNIVERSAL_BUILTIN_TOOLS[number];

export function isUniversalBuiltinTool(name: string): name is UniversalBuiltinTool {
  return (UNIVERSAL_BUILTIN_TOOLS as readonly string[]).includes(name);
}

/**
 * Builtin tools that mutate systems outside the artifact sandbox — these
 * default to `approval: always` when the definition doesn't declare a policy.
 * Artifact-tree writes stay approval-free: the sandbox is the boundary.
 */
export const MUTATING_BUILTIN_TOOLS: readonly UniversalBuiltinTool[] = [
  'http_request',
  'run_command',
];

export const MCP_TOOL_PREFIX = 'mcp__';

export function isMcpToolName(name: string): boolean {
  return name.startsWith(MCP_TOOL_PREFIX);
}

/**
 * Builtin tools that mutate the artifact tree — during a plan turn (`@plan`)
 * these are confined to the `plan/` directory.
 */
export const ARTIFACT_WRITE_TOOLS: readonly UniversalBuiltinTool[] = [
  'create_file',
  'edit_file',
  'append_file',
  'delete_file',
  'mkdir',
  'copy_file',
];

/**
 * Artifact-write tools whose SUCCESS yields write evidence (a path folded
 * into `_turnToolWrites`) — the satisfiability floor for artifact stop hooks
 * (delete_file / mkdir mutate the tree but never evidence a written file).
 */
export const ARTIFACT_WRITE_EVIDENCE_TOOLS: readonly UniversalBuiltinTool[] = [
  'create_file',
  'edit_file',
  'append_file',
  'copy_file',
];
