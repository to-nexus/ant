/**
 * Universal-job tool policy — approval defaults and runtime confinement.
 *
 * Lives in core (not agents/common/tool) so the loader can validate
 * `job ⊆ preset` without a core→agents dependency. The registry
 * factory in `agents/common/tool/presets.ts` builds the runtime registry
 * from this list; a unit test reconciles the two.
 *
 * The tool NAME inventory (preset list, mutating/write subsets, mcp prefix)
 * is the BE↔FE contract and lives in `@ant/shared/universal-tools` — the FE
 * action picker and satisfiability hints consume the same lists. This module
 * re-exports it and keeps the runtime-behaviour policy (approval, plan-turn
 * confinement, clarify) BE-only.
 */

import { MUTATING_BUILTIN_TOOLS, isExtensionToolName } from '@ant/shared';

export {
  UNIVERSAL_BUILTIN_TOOLS,
  isUniversalBuiltinTool,
  MUTATING_BUILTIN_TOOLS,
  MCP_TOOL_PREFIX,
  isMcpToolName,
  API_TOOL_PREFIX,
  isApiToolName,
  isExtensionToolName,
  ARTIFACT_WRITE_TOOLS,
  ARTIFACT_WRITE_EVIDENCE_TOOLS,
} from '@ant/shared';
export type { UniversalBuiltinTool } from '@ant/shared';

/** Path-bearing args per artifact-write tool (mirrors the tool node's write collection). */
const WRITE_PATH_ARGS: Record<string, readonly string[]> = {
  create_file: ['path'],
  edit_file: ['path'],
  append_file: ['path'],
  delete_file: ['path'],
  mkdir: ['path'],
  copy_file: ['dest'],
};

/**
 * SSOT for "inside the plan/ directory" — shared by the plan-turn write
 * confinement below and respond's plan-complete CTA gate.
 */
export function isUnderPlanDir(rawPath: string): boolean {
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
 * Clarify-tool session budget — pauses per (agent, job) session. Once spent,
 * the tool disappears from the advertised list (enforcement-by-absence).
 */
export const UNIVERSAL_CLARIFY_BUDGET = 3;

/**
 * Effective clarify availability for one turn. The `clarify` tool is a
 * runtime-advertised control tool OUTSIDE the builtin preset planes —
 * this predicate (plus the session budget) is its ONLY availability owner.
 *
 * Precedence: active intents that declare the knob → AND over them
 * (disabled wins on conflict); none declare → the definition default
 * (`job.clarify ?? agent.clarify ?? true`). `['general']` matches no
 * declared intent, so it falls through to the default.
 */
export function isClarifyEnabled(
  def: Pick<import('./types').ResolvedCustomJob, 'clarifyDefault' | 'intents'>,
  activeIntents: readonly string[],
): boolean {
  const declaring = def.intents.filter(
    (intent) => activeIntents.includes(intent.id) && intent.clarify !== undefined,
  );
  if (declaring.length > 0) {
    return declaring.every((intent) => intent.clarify === true);
  }
  return def.clarifyDefault;
}

/**
 * Effective approval decision for one tool call.
 *
 * Order: explicit declaration → mutating-builtin default (`always`) →
 * extension-tool default (`always` unless annotated read-only — MCP servers
 * annotate via readOnlyHint; declared-API `get` tools carry it structurally,
 * `request` tools never do, so writes stay fail-closed).
 */
export function requiresApproval(
  toolName: string,
  declared: Record<string, 'always' | 'never'>,
  opts?: { mcpReadOnlyHint?: boolean },
): boolean {
  const explicit = declared[toolName];
  if (explicit) return explicit === 'always';
  if ((MUTATING_BUILTIN_TOOLS as readonly string[]).includes(toolName)) return true;
  if (isExtensionToolName(toolName)) return opts?.mcpReadOnlyHint !== true;
  return false;
}
