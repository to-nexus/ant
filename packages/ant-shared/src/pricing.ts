/**
 * Model Pricing — cost SSOT
 *
 * Single source of truth for converting token usage into a precise USD cost
 * at each model's PUBLIC list price. Imported by BOTH the backend billing
 * pipeline (debit on job completion) AND the frontend cost/credit display —
 * mirroring the {@link MODEL_CONTEXT_WINDOWS} SSOT in `task.ts` so the two
 * ends can never drift.
 *
 * This replaces the scattered `input*1.0 + cacheCreation*1.25 + cacheRead*0.1`
 * "billable input" approximation (tokenLogger.ts / ant-ui tokenUtils.ts) which
 * (a) had no per-model $ rate, (b) never weighted output at its true ~5x rate,
 * and (c) let the headline `totalTokens = input + output` ignore cache.
 *
 * Rates are in USD per 1M tokens (MTok), Anthropic public pricing (2026).
 */

import type { TaskTokenUsage } from './task';
import { MODEL_REGISTRY, type ModelRate } from './models';

// `ModelRate` now lives in the MODEL_REGISTRY SSOT (@ant/shared/models.ts) and
// is exported from there; the barrel (index.ts) surfaces it, so existing
// `import { ModelRate } from '@ant/shared'` call sites keep working. It is not
// re-exported here (that would collide with the models.ts star export).

/**
 * Rate card — DERIVED from the MODEL_REGISTRY SSOT (@ant/shared/models.ts):
 * every entry that declares a `rate`. Keyed by the exact model id carried on
 * `LLMClient.modelName`. Add a model's rate in the registry, not here.
 */
export const MODEL_RATE_CARD: Readonly<Record<string, ModelRate>> = Object.fromEntries(
  Object.values(MODEL_REGISTRY)
    .filter((m) => m.rate !== undefined)
    .map((m) => [m.id, m.rate as ModelRate]),
);

/**
 * The most-expensive known model. Used as the conservative fallback rate when
 * an unknown model id is encountered at settle time — we would rather slightly
 * over-attribute cost (and log an alert to add the model) than silently
 * under-charge with a cheap default. Callers that prefer hard-fail use
 * {@link computeCallCostUsd} directly (it throws on unknown ids).
 */
export const MOST_EXPENSIVE_MODEL_ID = 'claude-opus-4-8';

/** Minimal token shape a cost computation needs. */
export interface CallUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

export class UnknownModelRateError extends Error {
  constructor(public readonly modelId: string) {
    super(
      `[pricing] No rate for model "${modelId}". ` +
        `Add it to MODEL_RATE_CARD in @ant/shared/pricing.ts.`,
    );
    this.name = 'UnknownModelRateError';
  }
}

const PER_MTOK = 1_000_000;

/**
 * Precise USD cost for ONE model's aggregated usage. Pure. Throws
 * {@link UnknownModelRateError} for an unrecognised model id (no silent
 * fallback — callers decide whether to catch + use the conservative rate).
 *
 * Cache-creation is priced at the 5-minute write rate (Ant's default cache
 * TTL). Cache-read is priced at its true ~0.1x rate, so the historical
 * `0.1` multiplier becomes an emergent property of real prices rather than a
 * hardcoded constant.
 */
export function computeCallCostUsd(modelId: string, u: CallUsage): number {
  const rate = MODEL_RATE_CARD[modelId];
  if (!rate) throw new UnknownModelRateError(modelId);
  return (
    (u.inputTokens * rate.input +
      u.outputTokens * rate.output +
      (u.cacheCreationTokens ?? 0) * rate.cacheWrite5m +
      (u.cacheReadTokens ?? 0) * rate.cacheRead) /
    PER_MTOK
  );
}

/**
 * Like {@link computeCallCostUsd} but never throws: an unknown model id is
 * priced at the most-expensive known rate and the unknown id is returned so
 * the caller can log/alert. Use at settle time where under-charging is worse
 * than a hard failure.
 */
export function computeCallCostUsdSafe(
  modelId: string,
  u: CallUsage,
): { usd: number; unknownModelId?: string } {
  if (MODEL_RATE_CARD[modelId]) {
    return { usd: computeCallCostUsd(modelId, u) };
  }
  return { usd: computeCallCostUsd(MOST_EXPENSIVE_MODEL_ID, u), unknownModelId: modelId };
}

/**
 * Aggregate a per-model usage map into one total USD cost. Each entry is
 * priced at its own model's rate — this is the whole point of per-model
 * attribution (a job that ran plan=Opus + execute=Sonnet is costed correctly
 * instead of with a single blended rate).
 *
 * Returns the total plus the list of any unknown model ids encountered.
 */
export function computeJobCostUsd(byModel: Record<string, CallUsage>): {
  usd: number;
  unknownModelIds: string[];
} {
  let usd = 0;
  const unknownModelIds: string[] = [];
  for (const [modelId, usage] of Object.entries(byModel)) {
    const r = computeCallCostUsdSafe(modelId, usage);
    usd += r.usd;
    if (r.unknownModelId) unknownModelIds.push(r.unknownModelId);
  }
  return { usd, unknownModelIds };
}

/**
 * Per-model USD breakdown (for the role-gated cost display). Same input as
 * {@link computeJobCostUsd}; returns a `{ modelId: usd }` map.
 */
export function computeModelCostBreakdownUsd(
  byModel: Record<string, CallUsage>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [modelId, usage] of Object.entries(byModel)) {
    out[modelId] = computeCallCostUsdSafe(modelId, usage).usd;
  }
  return out;
}

/** Convenience: cost of a single {@link TaskTokenUsage} for a known model. */
export function costOfTaskUsage(modelId: string, usage: TaskTokenUsage): number {
  return computeCallCostUsdSafe(modelId, usage).usd;
}
