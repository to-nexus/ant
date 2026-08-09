/**
 * Universal mention surface — pure vocabulary rules (no store imports, so
 * tests can exercise them without a DOM). The mention MECHANISM stays in
 * `useMentionAutocomplete`; only universal-specific data rules live here.
 */

/**
 * Universal exposes `@intent:` (the selected job's own catalog, MULTIPLE
 * accumulate), `@ctx:` (artifacts subtree, `context[]` accumulate), and
 * `@plan` (argument-less per-turn flag: this run produces a plan under
 * plan/, not the work — the runtime enforces the write confinement).
 * `@target:`/`@ref:` are RAC-only and `@explicit` is a triage-bypass flag —
 * neither exists on universal.
 */
export const UNIVERSAL_MENTION_PREFIXES = ['@intent:', '@ctx:', '@plan'] as const;

/** `sessions/` is grafted into the universal tree but sits OUTSIDE the agent
 * sandbox (artifacts + definition mount only) — never suggest it as `@ctx:`. */
export function isUniversalCtxSuggestible(path: string): boolean {
  return path !== 'sessions' && !path.startsWith('sessions/');
}
