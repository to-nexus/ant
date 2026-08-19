/**
 * Action-hook value model for the hook editor — pure and React-free. An
 * action hook names a tool that must have been successfully called; the
 * editable projection splits the raw value into a source (builtin of this
 * job / MCP server / custom escape hatch) and the tool name, and mirrors the
 * loader's H7/H8 satisfiability judgements as non-blocking hints (the BE
 * loader stays the authority).
 */

import { ARTIFACT_WRITE_EVIDENCE_TOOLS, MCP_ACTION_PATTERN, MCP_TOOL_PREFIX } from '@ant/shared';

export type ActionSelection =
  | { source: 'builtin'; tool: string }
  | { source: 'mcp'; server: string; tool: string }
  | { source: 'custom'; value: string };

/** Reverse-project a raw action value (possibly hand-typed in the YAML view) into the picker state. */
export function parseActionValue(
  value: string,
  effectiveBuiltins: readonly string[],
  serverNames: readonly string[],
): ActionSelection {
  if (effectiveBuiltins.includes(value)) return { source: 'builtin', tool: value };
  if (value.startsWith(MCP_TOOL_PREFIX)) {
    const rest = value.slice(MCP_TOOL_PREFIX.length);
    const sep = rest.indexOf('__');
    if (sep > 0) {
      const server = rest.slice(0, sep);
      if (serverNames.includes(server)) return { source: 'mcp', server, tool: rest.slice(sep + 2) };
    }
  }
  return { source: 'custom', value };
}

export function composeMcpAction(server: string, tool: string): string {
  return `${MCP_TOOL_PREFIX}${server}__${tool}`;
}

export function isValidMcpAction(value: string): boolean {
  return MCP_ACTION_PATTERN.test(value);
}

export type ActionHint = 'not-in-builtin' | 'unknown-tool' | 'unknown-server' | null;

/**
 * H8 satisfiability mirror: a builtin action must be in THIS job's
 * tools.builtin; an mcp action's server must be declared on the job or agent.
 * Warnings only — never blocks a save.
 */
export function actionHint(
  value: string,
  effectiveBuiltins: readonly string[],
  presetBuiltins: readonly string[],
  serverNames: readonly string[],
): ActionHint {
  const v = value.trim();
  if (v.length === 0) return null;
  if (v.startsWith(MCP_TOOL_PREFIX)) {
    const server = v.slice(MCP_TOOL_PREFIX.length).split('__')[0];
    return server && serverNames.includes(server) ? null : 'unknown-server';
  }
  if (effectiveBuiltins.includes(v)) return null;
  return presetBuiltins.includes(v) ? 'not-in-builtin' : 'unknown-tool';
}

/**
 * H7 satisfiability mirror: an artifact hook can only ever be met when the
 * job's builtin list carries a write-evidence tool.
 */
export function jobLacksArtifactWriter(effectiveBuiltins: readonly string[]): boolean {
  return !effectiveBuiltins.some((t) => (ARTIFACT_WRITE_EVIDENCE_TOOLS as readonly string[]).includes(t));
}
