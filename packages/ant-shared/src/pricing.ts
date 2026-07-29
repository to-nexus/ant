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
import {
  MODEL_REGISTRY,
  PROVIDER_PRICING_URL,
  type ModelRate,
  type ModelProvider,
} from './models';

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
export const MOST_EXPENSIVE_MODEL_ID = 'claude-opus-5';

/**
 * One row of the per-model pricing matrix (the "가격정보" surface). A flat
 * projection of the registry's priced models — id + label + provider + the
 * USD/MTok {@link ModelRate} + the normalized provider pricing source. Consumed
 * by the {@link ModelPricingPort} adapter and serialized by `GET /models/pricing`.
 */
export interface ModelPricingEntry {
  modelId: string;
  displayName: string;
  provider: ModelProvider;
  /** USD per 1M tokens. This is the applied unit price at markup 1.0 (LLM is pass-through). */
  rate: ModelRate;
  /** Normalized provider pricing page (see {@link PROVIDER_PRICING_URL}). */
  source: string;
}

/**
 * Build the per-model pricing matrix. Rows are the entries of
 * {@link MODEL_RATE_CARD} — the SAME rate map `computeCallCostUsd` prices calls
 * with — joined to registry metadata (label / provider) and the normalized
 * provider source. This is deliberately NOT an independent walk of
 * `MODEL_REGISTRY`: the "가격정보" matrix and the actual charge/display therefore
 * cannot drift, since both read one rate SSOT. Pure; registry insertion order.
 */
export function buildModelPricingTable(): ModelPricingEntry[] {
  return Object.entries(MODEL_RATE_CARD).map(([modelId, rate]) => {
    const spec = MODEL_REGISTRY[modelId];
    return {
      modelId,
      displayName: spec?.displayName ?? modelId,
      provider: spec.provider,
      rate,
      source: PROVIDER_PRICING_URL[spec.provider],
    };
  });
}

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

/**
 * Total input-side tokens of one usage record = new input + cache-read +
 * cache-creation. This is the model-INDEPENDENT quantity that must be
 * conserved between the aggregate `tokenUsage` and the summed per-model map;
 * a drop between them is the signature of a per-model accounting bug. Used by
 * the broadcaster anti-shrink guard and the settle-time safety-net.
 */
export function inputSideTokens(u: CallUsage): number {
  return u.inputTokens + (u.cacheReadTokens ?? 0) + (u.cacheCreationTokens ?? 0);
}

/** Sum {@link inputSideTokens} across every model in a per-model usage map. */
export function sumInputSideTokens(byModel: Record<string, CallUsage>): number {
  let total = 0;
  for (const u of Object.values(byModel)) total += inputSideTokens(u);
  return total;
}

export interface ReconcileResult {
  /** The map to price — either the original (no drop) or an augmented copy. */
  byModel: Record<string, TaskTokenUsage>;
  /** True when the safety-net augmented the map (a drop was detected). */
  corrected: boolean;
  /** Input-side tokens that were missing from the per-model map. */
  shortfallInput: number;
  /** Output tokens that were missing from the per-model map. */
  shortfallOutput: number;
  /** Model the shortfall was attributed to (when corrected). */
  targetModelId?: string;
}

/**
 * Verify-before-settle safety-net. The per-model billing map MUST conserve the
 * job's authoritative aggregate token totals; a large shortfall is the
 * signature of a per-model accounting bug (e.g. a partial map that under-charges
 * ~55×). When the summed per-model input-side tokens fall below the aggregate by
 * more than `tolerance`, attribute the missing tokens to the most-expensive
 * model PRESENT in the map (the shortfall is almost always that model's dropped
 * usage; pricing it at full input rate is conservative — a regression
 * over-charges slightly rather than silently under-charging). Falls back to
 * {@link MOST_EXPENSIVE_MODEL_ID} when the map is empty/degenerate.
 *
 * Pure: caller supplies the authoritative aggregate totals (from
 * `snapshot.tokenUsage` / reconstructed from per-task usage). Never mutates the
 * input map.
 */
export function reconcilePerModelUsage(
  byModel: Record<string, TaskTokenUsage>,
  aggregateInputSide: number,
  aggregateOutput: number,
  opts: { tolerance?: number } = {},
): ReconcileResult {
  const tolerance = opts.tolerance ?? 0.02;
  const perModelInput = sumInputSideTokens(byModel);
  let perModelOutput = 0;
  for (const u of Object.values(byModel)) perModelOutput += u.outputTokens;

  const noop: ReconcileResult = {
    byModel,
    corrected: false,
    shortfallInput: 0,
    shortfallOutput: 0,
  };
  if (aggregateInputSide <= 0) return noop;
  if (perModelInput >= aggregateInputSide * (1 - tolerance)) return noop;

  const shortfallInput = aggregateInputSide - perModelInput;
  const shortfallOutput = Math.max(0, aggregateOutput - perModelOutput);

  // Most-expensive model present (by input rate); else the conservative default.
  let targetModelId = MOST_EXPENSIVE_MODEL_ID;
  let bestRate = -1;
  for (const id of Object.keys(byModel)) {
    const r = MODEL_RATE_CARD[id]?.input ?? -1;
    if (r > bestRate) {
      bestRate = r;
      targetModelId = id;
    }
  }

  const augmented: Record<string, TaskTokenUsage> = {};
  for (const [id, u] of Object.entries(byModel)) augmented[id] = { ...u };
  const entry = (augmented[targetModelId] ??= {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    callCount: 0,
  });
  // Attribute the whole shortfall to raw input (full rate) — conservative.
  entry.inputTokens += shortfallInput;
  entry.outputTokens += shortfallOutput;
  entry.totalTokens = entry.inputTokens + entry.outputTokens;

  return { byModel: augmented, corrected: true, shortfallInput, shortfallOutput, targetModelId };
}
