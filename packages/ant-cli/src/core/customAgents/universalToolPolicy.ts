/**
 * Universal-job tool policy — the SSOT allowlist and approval defaults.
 *
 * Lives in core (not agents/common/tool) so the loader can validate
 * `job ⊆ preset` without a core→agents dependency. The registry
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

/** Path-bearing args per artifact-write tool (mirrors the tool node's write collection). */
const WRITE_PATH_ARGS: Record<string, readonly string[]> = {
  create_file: ['path'],
  edit_file: ['path'],
  append_file: ['path'],
  delete_file: ['path'],
  mkdir: ['path'],
  copy_file: ['dest'],
};

function isUnderPlanDir(rawPath: string): boolean {
  const normalized = rawPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  return normalized === 'plan' || normalized.startsWith('plan/');
}

/**
 * Plan-turn write confinement — returns the rejection message when `toolName`
 * would write outside `plan/` during a plan turn, else null. Pure so the
 * gate is unit-testable without the graph.
 */
export function planTurnViolation(toolName: string, args: Record<string, unknown>): string | null {
  const pathArgs = WRITE_PATH_ARGS[toolName];
  if (!pathArgs) return null;
  for (const argName of pathArgs) {
    const value = args[argName];
    if (typeof value !== 'string' || value.length === 0) continue;
    if (!isUnderPlanDir(value)) {
      return (
        `"${toolName}" targeting "${value}" is blocked: this is a PLAN turn — file writes are confined to the plan/ directory. ` +
        `Write the plan document under plan/ or present the plan in chat; the actual work runs on a normal turn.`
      );
    }
  }
  return null;
}

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
