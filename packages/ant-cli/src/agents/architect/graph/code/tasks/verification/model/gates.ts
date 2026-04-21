/**
 * Verification gates — the atomic "what has to pass" vocabulary.
 *
 * A verification task is complete iff every required gate has passed in the
 * current diagnostic cycle. Gates replace the former flat boolean pairs
 * (`buildPassed`/`buildAttempted`, `testPassed`/`testAttempted`, etc.) with
 * a structural Set so "passed ⊆ required" is a constructor-enforced invariant.
 *
 * This module is phase-blind (R2): it never imports from `nodes/`,
 * `routers/`, or `parallel/`. Consumers are:
 *   - `tasks/verification/model/Session.ts` (primary)
 *   - `tasks/verification/model/snapshot.ts` (persisted form)
 *   - `tasks/verification/hooks/*.ts` (adapter layer, added in T5)
 */

export type Gate = 'typecheck' | 'build' | 'test';

/**
 * Ordered canonical gate list. Observation order matters for the plan
 * prompt's "cached passed steps" rendering and the "first missing gate"
 * violation message, so the model exposes the order explicitly rather
 * than relying on `Set` iteration order.
 */
export const GATE_ORDER: readonly Gate[] = Object.freeze(['typecheck', 'build', 'test']);

/**
 * Human-readable guidance attached to the `verification_incomplete`
 * violation so the downstream plan prompt and UI surface the same text.
 */
export interface MissingStepDetail {
  message: string;
  fix: string;
}

const MISSING_STEP_DETAILS: Record<Gate, MissingStepDetail> = {
  typecheck: {
    message:
      'Type check (tsc --noEmit) has not succeeded. Resolve type errors before proceeding to build.',
    fix: 'Fix type errors found by tsc --noEmit, then re-run type check.',
  },
  build: {
    message:
      'Build has not succeeded. A build command must exit 0 with no file modifications after it.',
    fix: 'Run the build command and ensure it passes. If you edited files after the last build, re-run the build.',
  },
  test: {
    message:
      'Tests have not passed. Test files exist in this project — run tests and ensure they pass.',
    fix: 'Run the test command and ensure all tests pass before marking done.',
  },
};

export function getMissingStepDetail(gate: Gate): MissingStepDetail {
  return MISSING_STEP_DETAILS[gate];
}

// ────────────────────────────────────────────────────────────────────────────
// Diagnostic inspect allow-list
// ────────────────────────────────────────────────────────────────────────────
//
// Read-only inspection commands bypass the loop-guard and the attempt counter
// regardless of deep-diagnostic mode. Mirrors the historical list from
// `utils/deepDiagnosticMode.ts` so behaviour is preserved across migration.

const DIAGNOSTIC_INSPECT_PATTERNS: readonly RegExp[] = [
  /^\s*cat\s+/,
  /^\s*ls\b/,
  /^\s*head\s+/,
  /^\s*tail\s+/,
  /^\s*find\s+/,
  /^\s*grep\b/,
  /^\s*rg\b/,
  /^\s*wc\s+/,
  /^\s*stat\s+/,
  /^\s*which\s+/,
  /^\s*file\s+/,
  /^\s*echo\s+\$/,
  /^\s*env\b/,
  /^\s*printenv\b/,
  /^\s*npm\s+(why|ls|list|view|config|prefix|root|bin)\b/,
  /^\s*pnpm\s+(why|list|ls|view|config|store|root|bin)\b/,
  /^\s*yarn\s+(why|list|info|config)\b/,
  /^\s*bun\s+(pm\s+ls|pm\s+view|info)\b/,
  /^\s*go\s+(list|env|version|version\s+-m)\b/,
  /^\s*node\s+-v\b/,
  /^\s*node\s+--version\b/,
  /^\s*npx\s+(tsc\s+--version|tsc\s+-v)\b/,
  /^\s*tsc\s+--version\b/,
  /^\s*tsc\s+-v\b/,
  /^\s*git\s+(status|log|diff|show)\b/,
];

/**
 * Pure inspection commands (cat/ls/pnpm why/tsc --version/etc.) bypass the
 * loop guard and the attempt counter. The list lives here because it is a
 * property of the gate vocabulary — it defines which commands are
 * non-mutating observations of the verification surface.
 */
export function isDiagnosticInspectCommand(command: string): boolean {
  if (!command) return false;
  return DIAGNOSTIC_INSPECT_PATTERNS.some(p => p.test(command));
}

// ────────────────────────────────────────────────────────────────────────────
// Gate inference helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Infer which gate a command exercises. Returns `undefined` when the command
 * is not a recognised verification gate command — callers should treat that
 * as "command is unrelated to gate completion" (neither pass nor fail flips
 * a gate).
 */
export function gateForCommand(command: string): Gate | undefined {
  if (!command) return undefined;
  const c = command.trim();
  if (/\btsc\b/.test(c) && /(--noEmit|-p\s|\s-p\b)/.test(c)) return 'typecheck';
  if (/\btypecheck\b/.test(c)) return 'typecheck';
  if (/\btest\b/.test(c) && !/\btsc\b/.test(c)) return 'test';
  if (/\bbuild\b/.test(c)) return 'build';
  return undefined;
}
