/**
 * Universal-job tool policy — the SSOT allowlist and approval defaults.
 *
 * Lives in core (not agents/common/tool) so the loader can validate
 * `job ⊆ agent ⊆ preset` without a core→agents dependency. The registry
 * factory in `agents/common/tool/presets.ts` builds the runtime registry
 * from this list; a unit test reconciles the two.
 *
 * Domain-bound tools (search_code, read_workspace_file, list_assets, figma_*,
 * read_ant_source, …) are deliberately absent: universal has no canonical
 * codebase, no RAC, no design asset pool. Extra capability comes from MCP.
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

/** Write tools — outputs.mode 'contract'/'free' requires at least one of these. */
export const WRITE_TOOLS: readonly UniversalBuiltinTool[] = [
  'create_file',
  'edit_file',
  'append_file',
];

/**
 * Effective approval decision for one tool call.
 *
 * Order: explicit declaration → mutating-builtin default (`always`) →
 * MCP default (`always` unless the server annotated the tool read-only —
 * annotations are hints, but the workspace trust model already treats MCP
 * servers as run_command-equivalent).
 */
export function requiresApproval(
  toolName: string,
  declared: Record<string, 'always' | 'never'>,
  opts?: { mcpReadOnlyHint?: boolean },
): boolean {
  const explicit = declared[toolName];
  if (explicit) return explicit === 'always';
  if ((MUTATING_BUILTIN_TOOLS as readonly string[]).includes(toolName)) return true;
  if (isMcpToolName(toolName)) return opts?.mcpReadOnlyHint !== true;
  return false;
}
