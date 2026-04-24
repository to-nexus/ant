/**
 * Shared helpers for the `<executionTier>N</executionTier>` LLM contract.
 *
 * Every Tier Entry Node (code/design Decompose, plan/visual Detect)
 * asks the LLM to emit this tag. The helpers below keep parsing and the
 * safe-default policy consistent across nodes.
 *
 * - `parseExecutionTierTag`    — extract the tag value from a raw LLM
 *   response. Returns `undefined` when the tag is missing or malformed.
 * - `validateExecutionTier`    — strict contract check. Throws
 *   `ExecutionTierViolation` on missing tag OR on `tier === 0` for
 *   `generate`/`refactor` modes (where Tier 0 is forbidden — see the
 *   decompose rules.md matrix). Intended for Tier Entry Nodes that
 *   drive an inline retry loop on violation.
 * - `coerceExecutionTier`      — legacy lenient default (Reflex) used by
 *   nodes that do NOT implement retry (e.g. `SpecialTagTransformer`
 *   fallback rendering). New callers should prefer
 *   `validateExecutionTier` with retry.
 *
 * Prompt contract (Phase B):
 *   `<executionTier>0</executionTier>` | `<executionTier>1</executionTier>`
 *   | `<executionTier>2</executionTier>` | `<executionTier>3</executionTier>`
 *   | `<executionTier>4</executionTier>`
 *
 * Mode-specific minima (code job, Phase 1):
 *   - `explain`   → Tier 0 allowed.
 *   - `generate`  → Tier 1 minimum (Tier 0 forbidden — see rules.md §F).
 *   - `refactor`  → Tier 1 minimum (Tier 0 forbidden).
 */

import { ExecutionTierId } from './types';

export function parseExecutionTierTag(
  raw: string | undefined,
): ExecutionTierId | undefined {
  if (!raw) return undefined;
  const match = raw.match(/<executionTier>\s*([\s\S]*?)\s*<\/executionTier>/i);
  if (!match) return undefined;
  const value = (match[1] || '').trim();
  if (!value) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 4) return undefined;
  return n as ExecutionTierId;
}

export function coerceExecutionTier(
  parsed: ExecutionTierId | undefined,
  nodeLabel: string,
): ExecutionTierId {
  if (parsed === undefined) {
    console.warn(
      `⚠️  [${nodeLabel}] LLM output missing <executionTier> tag — defaulting to Tier 0 (Reflex).`,
    );
    return ExecutionTierId.Reflex;
  }
  return parsed;
}

/**
 * `ExecutionTierViolation` is thrown by {@link validateExecutionTier} when
 * the LLM response violates the prompt contract. Callers that drive an
 * inline retry loop should catch this (and only this) error type, append
 * a violation-specific framing note to the next prompt turn, and re-issue
 * the call. See `decompose/index.ts` for the canonical retry shape.
 *
 * Failure modes:
 *   - `MISSING_TAG`            — LLM omitted `<executionTier>` entirely
 *                                OR emitted a malformed body that
 *                                `parseExecutionTierTag` could not parse
 *                                (non-integer, out-of-range, or empty).
 *   - `FORBIDDEN_TIER_FOR_MODE` — LLM emitted a tier that is forbidden
 *                                for the current mode (today: Tier 0 for
 *                                `generate`/`refactor`). Silent
 *                                degradation to a lenient value would
 *                                mask the exact class of prompt drift
 *                                that caused metal-issuing-honor.
 */
export type ExecutionTierViolationCode =
  | 'MISSING_TAG'
  | 'FORBIDDEN_TIER_FOR_MODE';

export class ExecutionTierViolation extends Error {
  public readonly code: ExecutionTierViolationCode;
  public readonly nodeLabel: string;
  public readonly mode?: string;
  public readonly observedTier?: ExecutionTierId;

  constructor(
    code: ExecutionTierViolationCode,
    opts: {
      nodeLabel: string;
      mode?: string;
      observedTier?: ExecutionTierId;
    },
  ) {
    const message =
      code === 'MISSING_TAG'
        ? `[${opts.nodeLabel}] LLM output missing <executionTier> tag (mode=${opts.mode ?? 'unknown'})`
        : `[${opts.nodeLabel}] LLM emitted <executionTier>${opts.observedTier}</executionTier> which is forbidden for mode=${opts.mode}`;
    super(message);
    this.name = 'ExecutionTierViolation';
    this.code = code;
    this.nodeLabel = opts.nodeLabel;
    this.mode = opts.mode;
    this.observedTier = opts.observedTier;
  }
}

export interface ValidateExecutionTierOpts {
  mode?: string;
  nodeLabel: string;
}

/**
 * Strict counterpart to {@link coerceExecutionTier}. Throws
 * {@link ExecutionTierViolation} on missing tag or forbidden-for-mode.
 *
 * Caller contract: wrap in try/catch and retry with framing. Do NOT
 * swallow the violation silently — the whole point of this helper is to
 * make prompt drift loud. If retries are exhausted, re-throw so the
 * surrounding job fails with a clear error rather than running a no-op
 * "success" under the wrong tier.
 */
export function validateExecutionTier(
  parsed: ExecutionTierId | undefined,
  opts: ValidateExecutionTierOpts,
): ExecutionTierId {
  if (parsed === undefined) {
    throw new ExecutionTierViolation('MISSING_TAG', {
      nodeLabel: opts.nodeLabel,
      mode: opts.mode,
    });
  }
  if (
    parsed === ExecutionTierId.Reflex &&
    (opts.mode === 'generate' || opts.mode === 'refactor')
  ) {
    throw new ExecutionTierViolation('FORBIDDEN_TIER_FOR_MODE', {
      nodeLabel: opts.nodeLabel,
      mode: opts.mode,
      observedTier: parsed,
    });
  }
  return parsed;
}

/**
 * Build a short, assertive framing message to append to the user prompt
 * before a retry. Deliberately concrete — tells the LLM exactly what to
 * emit and why Tier 0 (for generate/refactor) is wrong.
 */
export function buildExecutionTierViolationFraming(
  violation: ExecutionTierViolation,
): string {
  const header = '\n\n---\n\n## Retry: previous response violated the execution-tier contract\n';
  if (violation.code === 'MISSING_TAG') {
    return (
      header +
      'Your previous response omitted the mandatory `<executionTier>N</executionTier>` tag. ' +
      'Emit EXACTLY ONE `<executionTier>` tag whose body is a single integer `0`, `1`, `2`, `3`, or `4` ' +
      '(no label, no JSON, no surrounding prose). Place it first in the output sequence per the Output Sequence section.'
    );
  }
  const modeLabel = violation.mode ?? 'generate/refactor';
  return (
    header +
    `Your previous response emitted \`<executionTier>0</executionTier>\` for \`${modeLabel}\` mode, ` +
    'which is FORBIDDEN. Tier 0 (Reflex) is reserved for `explain` mode only. ' +
    `For \`${modeLabel}\` the minimum executionTier is \`1\` (OneShot, single verification-unneeded write). ` +
    'A "no change required" outcome must be reached AFTER observing the code inside a Tier 1+ execution, ' +
    'never at classification time. Re-emit with `<executionTier>1</executionTier>` or higher.'
  );
}
