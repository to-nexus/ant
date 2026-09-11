/**
 * Connection report — the single owner of the "which declared extension
 * connections actually came up this turn" fact and of EVERY rendering of it
 * (prompt band, chat warning, runtime failure note). The conversational floor
 * is a runtime property: on an attended turn a connect failure is a FACT the
 * agent sees and explains, never a fatal state that mutes it (doc 44). Do not
 * add a second renderer or a second shape for this data.
 *
 * BE-only by design: the FE never consumes the shape — the chat surface is a
 * plain markdown message, so no @ant/shared contract rides on this.
 */

import { isMcpConfigError } from './McpConfigError';

/** One connect attempt of one declared server (MCP or declared REST API). */
export interface ConnectionAttempt {
  server: string;
  channel: 'mcp' | 'api';
  status: 'connected' | 'failed';
  /** Connected only. */
  toolCount?: number;
  /** Failed only — bounded, secret-free by construction (resolution errors name key names). */
  error?: string;
  /** Failed only — `config` = deterministic definition/credential mistake (McpConfigError), `connect` = runtime/network. */
  errorKind?: 'config' | 'connect';
  /** Failed only — the same server also failed on the previous turn (fast-retry lane). */
  repeated?: boolean;
}

export type ConnectionReport = ConnectionAttempt[];

const ERROR_MAX_CHARS = 500;
const FAILURE_NOTE_MAX_CHARS = 1500;

export function boundErrorMessage(error: unknown, cap: number = ERROR_MAX_CHARS): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.length > cap ? `${raw.slice(0, cap)}…` : raw;
}

export function connectionErrorKindOf(error: unknown): 'config' | 'connect' {
  return isMcpConfigError(error) ? 'config' : 'connect';
}

export function hasConnectionFailures(report: ConnectionReport | undefined): boolean {
  return (report ?? []).some((a) => a.status === 'failed');
}

/** Names of the servers that failed — the next turn's `knownBad` fast-retry set. */
export function failedServerNamesOf(report: ConnectionReport | undefined): string[] {
  return (report ?? []).filter((a) => a.status === 'failed').map((a) => a.server);
}

/**
 * Prompt-band rows for the Capability Status section (failures only, with a
 * head line). Rendered into base.md under `{{#if capabilityStatus}}`.
 */
export function formatCapabilityStatusLines(report: ConnectionReport): string[] {
  const failed = report.filter((a) => a.status === 'failed');
  if (failed.length === 0) return [];
  const lines = [`${failed.length} of ${report.length} declared connection(s) failed this turn.`];
  for (const a of failed) {
    const kind = a.errorKind === 'config'
      ? '[config — definition or credential fix needed]'
      : '[connect — may be transient]';
    const again = a.repeated ? ' (failed again — same as the previous turn)' : '';
    lines.push(`\`${a.server}\` (${a.channel === 'api' ? 'API' : 'MCP'}) — unavailable: ${a.error ?? 'unknown error'} ${kind}${again}`);
  }
  return lines;
}

/**
 * Chat-visible warning, emitted once per turn right after the turn-context
 * card. Plain markdown — no FE card type, no @ant/shared change.
 */
export function formatConnectionWarningForChat(
  report: ConnectionReport | undefined,
  language: string | undefined,
): string | null {
  const failed = (report ?? []).filter((a) => a.status === 'failed');
  if (failed.length === 0) return null;
  const ko = language === 'ko';
  const head = ko
    ? `⚠️ 선언된 연결 ${failed.length}개가 이번 턴에 연결되지 않았습니다 — 해당 서버의 도구 없이 진행합니다.`
    : `⚠️ ${failed.length} declared connection(s) could not be established this turn — proceeding without their tools.`;
  const rows = failed.map((a) => {
    const again = a.repeated ? (ko ? ' · 지난 턴에도 실패' : ' · also failed last turn') : '';
    return `- \`${a.server}\` (${a.channel === 'api' ? 'API' : 'MCP'}): ${a.error ?? 'unknown error'}${again}`;
  });
  return [head, ...rows].join('\n');
}

/**
 * Session-memory note for a turn that died before the agent could reply
 * (fail-fast lane, wiring errors, graph crash). Persisted into session:main so
 * the NEXT turn's agent can answer "what happened?". User-role `[runtime]`
 * follows the truncation-nudge precedent.
 */
export function buildRuntimeFailureNote(error: unknown): { role: 'user'; content: string } {
  const message = boundErrorMessage(error, FAILURE_NOTE_MAX_CHARS);
  return {
    role: 'user',
    content:
      `[runtime] The previous turn failed before the agent could reply: ${message}\n` +
      `If the user asks what happened, explain from this note and name the concrete fix when one exists.`,
  };
}
