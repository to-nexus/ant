/**
 * Action-hook value model for the hook editor — pure and React-free. An
 * action hook names a tool that must have been successfully called; the
 * editable projection splits the raw value into a source (builtin of this
 * job / a capability-extension channel / custom escape hatch) and the tool
 * name, and mirrors the loader's H7/H8 satisfiability judgements as
 * non-blocking hints (the BE loader stays the authority).
 *
 * The extension channels are a TABLE, not a pair of hard-coded arms: every
 * channel's prefix and name pattern comes from `@ant/shared`, so a channel
 * added there reaches this editor without a second enumeration to remember.
 */

import {
  API_ACTION_PATTERN,
  API_TOOL_PREFIX,
  API_TOOL_VERBS,
  ARTIFACT_WRITE_EVIDENCE_TOOLS,
  MCP_ACTION_PATTERN,
  MCP_TOOL_PREFIX,
} from '@ant/shared';

/** A capability-extension plane: declaring the server IS the enablement — there is no per-job allowlist for these. */
export type ExtensionChannel = 'mcp' | 'api';

export interface ChannelSpec {
  channel: ExtensionChannel;
  prefix: string;
  pattern: RegExp;
  /** Closed tool vocabulary (a picker), or null when the server names its own tools (free text). */
  tools: readonly string[] | null;
}

/**
 * Server names declared for each channel — job ∪ agent, the same union the
 * loader's H8 arm resolves against.
 */
export type ExtensionServers = Record<ExtensionChannel, readonly string[]>;

export const EXTENSION_CHANNELS: readonly ChannelSpec[] = [
  { channel: 'mcp', prefix: MCP_TOOL_PREFIX, pattern: MCP_ACTION_PATTERN, tools: null },
  { channel: 'api', prefix: API_TOOL_PREFIX, pattern: API_ACTION_PATTERN, tools: API_TOOL_VERBS },
];

export function channelSpec(channel: ExtensionChannel): ChannelSpec {
  return EXTENSION_CHANNELS.find((c) => c.channel === channel)!;
}

export type ActionSelection =
  | { source: 'builtin'; tool: string }
  | { source: 'extension'; channel: ExtensionChannel; server: string; tool: string }
  | { source: 'custom'; value: string };

/**
 * Prefix split, independent of what is declared — the server segment ends at
 * the FIRST `__` because every channel's server charset excludes it, while an
 * MCP tool name may itself contain `__`. Returns an empty server for a bare
 * prefix (`mcp__`), which reads as "a channel was named but no server yet".
 */
export function splitExtensionAction(
  value: string,
): { channel: ExtensionChannel; server: string; tool: string } | null {
  for (const spec of EXTENSION_CHANNELS) {
    if (!value.startsWith(spec.prefix)) continue;
    const rest = value.slice(spec.prefix.length);
    const sep = rest.indexOf('__');
    if (sep < 0) return { channel: spec.channel, server: rest, tool: '' };
    return { channel: spec.channel, server: rest.slice(0, sep), tool: rest.slice(sep + 2) };
  }
  return null;
}

/** Reverse-project a raw action value (possibly hand-typed in the YAML view) into the picker state. */
export function parseActionValue(
  value: string,
  effectiveBuiltins: readonly string[],
  servers: ExtensionServers,
): ActionSelection {
  if (effectiveBuiltins.includes(value)) return { source: 'builtin', tool: value };
  const split = splitExtensionAction(value);
  if (split && split.server.length > 0 && servers[split.channel].includes(split.server)) {
    // A closed-vocabulary channel only adopts a tool it can actually offer;
    // anything else stays custom so a hand-typed value is never hidden behind
    // a picker with no matching option.
    const spec = channelSpec(split.channel);
    if (!spec.tools || split.tool === '' || spec.tools.includes(split.tool)) {
      return { source: 'extension', channel: split.channel, server: split.server, tool: split.tool };
    }
  }
  return { source: 'custom', value };
}

export function composeExtensionAction(channel: ExtensionChannel, server: string, tool: string): string {
  return `${channelSpec(channel).prefix}${server}__${tool}`;
}

export function isValidExtensionAction(channel: ExtensionChannel, value: string): boolean {
  return channelSpec(channel).pattern.test(value);
}

/** The tool this channel selects by default when the author picks a server — the read-only half. */
export function defaultToolFor(channel: ExtensionChannel): string {
  return channelSpec(channel).tools?.[0] ?? '';
}

export type ActionHint =
  | 'not-in-builtin'
  | 'unknown-tool'
  | 'unknown-mcp-server'
  | 'unknown-api-server'
  | null;

/**
 * H8 satisfiability mirror: a builtin action must be in THIS job's
 * tools.builtin; an extension action's server must be declared on the job or
 * agent. Warnings only — never blocks a save.
 */
export function actionHint(
  value: string,
  effectiveBuiltins: readonly string[],
  presetBuiltins: readonly string[],
  servers: ExtensionServers,
): ActionHint {
  const v = value.trim();
  if (v.length === 0) return null;
  const split = splitExtensionAction(v);
  if (split) {
    // Once a channel is named the builtin vocabulary no longer applies — the
    // only satisfiability question left is whether the server is declared.
    if (split.server.length > 0 && servers[split.channel].includes(split.server)) return null;
    return split.channel === 'mcp' ? 'unknown-mcp-server' : 'unknown-api-server';
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
