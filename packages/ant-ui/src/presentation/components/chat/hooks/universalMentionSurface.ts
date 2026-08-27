/**
 * Universal mention surface — pure vocabulary rules (no store imports, so
 * tests can exercise them without a DOM). The mention MECHANISM stays in
 * `useMentionAutocomplete`; only universal-specific data rules live here.
 */

import { UNIVERSAL_AGENTS_DIRNAME, parseUniversalAgentRef } from '@ant/shared';

/**
 * Universal exposes `@intent:` (the selected job's own catalog, MULTIPLE
 * accumulate), `@ctx:` (artifacts subtree, `context[]` accumulate), and
 * `@plan` (argument-less per-turn flag: this run produces a plan under
 * plan/, not the work — the runtime enforces the write confinement).
 * `@target:`/`@ref:` are RAC-only and `@explicit` is a triage-bypass flag —
 * neither exists on universal.
 */
export const UNIVERSAL_MENTION_PREFIXES = ['@intent:', '@ctx:', '@plan'] as const;

/**
 * What `@ctx:` may offer == what the agent plane can resolve.
 *
 * - `sessions/**` is grafted into the universal tree but sits OUTSIDE the agent
 *   sandbox — offering it would attach a file the tools cannot open.
 * - bare `_agents` is the picker's synthetic group row, not a directory; the
 *   paths UNDER it are peer definitions and are attachable.
 */
export function isUniversalCtxSuggestible(path: string): boolean {
  if (path === 'sessions' || path.startsWith('sessions/')) return false;
  if (path === UNIVERSAL_AGENTS_DIRNAME) return false;
  return true;
}

/** Peer-definition path (`_agents/{agentId}/…`) → its agent id, else null. */
export function ctxAgentIdOf(path: string): string | null {
  return parseUniversalAgentRef(path)?.agentId ?? null;
}
