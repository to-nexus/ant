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
 *   `ExecutionTierViolation` on missing tag, on `tier === 0` for
 *   `generate`/`refactor` modes, OR on tier ≠ 4 for `generate`/`refactor`
 *   modes when the artifact pool carries a design reference document
 *   (`pool.hasAnyDesignRef() === true`). Design refs structurally imply
 *   multi-boundary work grounded in an external document — Tier 4 is the
 *   only valid classification. Intended for Tier Entry Nodes that drive
 *   an inline retry loop on violation.
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
 *
 * Structural maxima (Phase 2 — design-ref grounding):
 *   - `generate`/`refactor` mode + design ref present in the pool
 *     ⇒ Tier 4 is REQUIRED. Lower tiers collapse the document's
 *     enumerated work units into a single task — bitter-blazing-cloak
 *     regression. The intent matrix is the SSOT for "what counts as a
 *     design ref" (see `@ant/shared/action-config-matrix.ts`).
 */

import { ExecutionTierId } from './types';
import type { ArtifactPoolView } from '../artifact/ArtifactPipeline';

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
 *   - `MISSING_TAG`              — LLM omitted `<executionTier>` entirely
 *                                  OR emitted a malformed body that
 *                                  `parseExecutionTierTag` could not parse
 *                                  (non-integer, out-of-range, or empty).
 *   - `FORBIDDEN_TIER_FOR_MODE`  — LLM emitted a tier that is forbidden
 *                                  for the current mode (today: Tier 0 for
 *                                  `generate`/`refactor`). Silent
 *                                  degradation to a lenient value would
 *                                  mask the exact class of prompt drift
 *                                  that caused metal-issuing-honor.
 *   - `DESIGN_REF_REQUIRES_TIER4` — Pool carries a design ref
 *                                  (`pool.hasAnyDesignRef() === true`)
 *                                  for `generate`/`refactor` mode but the
 *                                  LLM emitted a tier other than 4. The
 *                                  document grounds multi-boundary work;
 *                                  collapsing it into Tier 1/2/3 is the
 *                                  bitter-blazing-cloak regression
 *                                  shape — five enumerated tasks become
 *                                  a single one. Caught and retried with
 *                                  framing that quotes the intent
 *                                  matrix's role assignment.
 */
export type ExecutionTierViolationCode =
  | 'MISSING_TAG'
  | 'FORBIDDEN_TIER_FOR_MODE'
  | 'DESIGN_REF_REQUIRES_TIER4'
  | 'RUNTIME_ERROR_REQUIRES_TIER2_PLUS';

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
    let message: string;
    if (code === 'MISSING_TAG') {
      message = `[${opts.nodeLabel}] LLM output missing <executionTier> tag (mode=${opts.mode ?? 'unknown'})`;
    } else if (code === 'FORBIDDEN_TIER_FOR_MODE') {
      message = `[${opts.nodeLabel}] LLM emitted <executionTier>${opts.observedTier}</executionTier> which is forbidden for mode=${opts.mode}`;
    } else if (code === 'DESIGN_REF_REQUIRES_TIER4') {
      message = `[${opts.nodeLabel}] LLM emitted <executionTier>${opts.observedTier}</executionTier> but pool carries a design ref — Tier 4 is required for mode=${opts.mode}`;
    } else {
      message = `[${opts.nodeLabel}] LLM emitted <executionTier>${opts.observedTier}</executionTier> but the directive describes a runtime error scenario — Tier 2 or higher is required (mode=${opts.mode})`;
    }
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
  /**
   * Post-RAC artifact pool. When supplied, the validator enforces the
   * structural rule "design ref present + write mode ⇒ Tier 4". Pass
   * `undefined` only for legacy call sites that have no access to the
   * pool (e.g. design-job decompose where the artifact pool is shaped
   * differently); the additional check is silently skipped in that
   * case. The two existing failure modes (`MISSING_TAG`,
   * `FORBIDDEN_TIER_FOR_MODE`) are unaffected.
   */
  pool?: ArtifactPoolView;
  /**
   * `true` when the directive describes a runtime error scenario (stack
   * trace, exception message, "module not found", etc.) per the SSOT
   * helper `core/utils/runtimeErrorPattern.containsRuntimeErrorPattern`.
   * When set, Tier 1 (OneShot — verification-unneeded trivial edit) is
   * forbidden because the fix could plausibly break typecheck/build/test
   * AND the user's reproducer scenario must run as part of verification.
   * Tier 2+ owns either inline self-verify (Tier 2 selfVerifyOnDone) or
   * a dedicated verification task (Tier 3/4).
   */
  hasErrorInDirective?: boolean;
}

/**
 * Strict counterpart to {@link coerceExecutionTier}. Throws
 * {@link ExecutionTierViolation} on missing tag, forbidden-for-mode, or
 * design-ref-but-not-Tier-4.
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
  const isWriteMode = opts.mode === 'generate' || opts.mode === 'refactor';
  if (parsed === ExecutionTierId.Reflex && isWriteMode) {
    throw new ExecutionTierViolation('FORBIDDEN_TIER_FOR_MODE', {
      nodeLabel: opts.nodeLabel,
      mode: opts.mode,
      observedTier: parsed,
    });
  }
  // Runtime-error directives mandate Tier 2+ so the fix carries either inline
  // self-verify or a dedicated verification task. Tier 1 OneShot (no
  // verification) collapses behavioral fixes into "trivial edits" and
  // bypasses the reproducer check the verification cycle requires.
  if (
    isWriteMode &&
    opts.hasErrorInDirective === true &&
    parsed < ExecutionTierId.Exploratory
  ) {
    throw new ExecutionTierViolation('RUNTIME_ERROR_REQUIRES_TIER2_PLUS', {
      nodeLabel: opts.nodeLabel,
      mode: opts.mode,
      observedTier: parsed,
    });
  }
  if (
    isWriteMode &&
    opts.pool?.hasAnyDesignRef() &&
    parsed !== ExecutionTierId.RefsGrounded
  ) {
    throw new ExecutionTierViolation('DESIGN_REF_REQUIRES_TIER4', {
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
 * emit and why the previous classification was wrong.
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
  if (violation.code === 'FORBIDDEN_TIER_FOR_MODE') {
    return (
      header +
      `Your previous response emitted \`<executionTier>0</executionTier>\` for \`${modeLabel}\` mode, ` +
      'which is FORBIDDEN. Tier 0 (Reflex) is reserved for `explain` mode only. ' +
      `For \`${modeLabel}\` the minimum executionTier is \`1\` (OneShot, single verification-unneeded write). ` +
      'A "no change required" outcome must be reached AFTER observing the code inside a Tier 1+ execution, ' +
      'never at classification time. Re-emit with `<executionTier>1</executionTier>` or higher.'
    );
  }
  if (violation.code === 'RUNTIME_ERROR_REQUIRES_TIER2_PLUS') {
    return (
      header +
      `Your previous response emitted \`<executionTier>${violation.observedTier}</executionTier>\` for \`${modeLabel}\` mode, ` +
      'but the directive describes a runtime error scenario (stack trace, `Error:` / exception message, ' +
      '`Cannot find module`, "module not found", or similar failure pattern). ' +
      'Tier 1 (OneShot) is reserved for verification-unneeded edits — comment-only / typo / safe text-literal swaps — ' +
      'and is FORBIDDEN here because a behavioral fix could plausibly break typecheck/build/test AND must reproduce the ' +
      "user's failing scenario as part of verification. Re-emit with `<executionTier>2</executionTier>` (Exploratory, " +
      'single unit of work with `selfVerifyOnDone: true`) or higher (Tier 3/4 with a dedicated verification task) ' +
      'so the install/typecheck/build/test gates AND the reproducer step run before <done>.'
    );
  }
  // DESIGN_REF_REQUIRES_TIER4
  return (
    header +
    `Your previous response emitted \`<executionTier>${violation.observedTier}</executionTier>\` for \`${modeLabel}\` mode, ` +
    'but the artifact pool carries a design reference document (spec / system-design / ui / game-art with `role=ref`). ' +
    'Per the intent matrix (`@ant/shared/action-config-matrix.ts`), a design ref is the **Development Source** of this turn — ' +
    'it enumerates multi-boundary work and MUST be faithfully decomposed against. ' +
    'Tier 4 (RefsGrounded) is the ONLY valid classification: emit one task per work unit the document enumerates ' +
    '(plus a final `verification` task), never collapse them into a single Tier 1/2/3 unit. ' +
    'Re-emit with `<executionTier>4</executionTier>`.'
  );
}
