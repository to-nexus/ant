/**
 * Context Lens projection (P2 — e2-humming-spindle).
 *
 * Pure render-time view over the uncapped `FeatureContext.exchanges` /
 * `digests` bands: applies a consumer node's `ContextProfile` caps and the
 * demotion rules. Cheap enough to run per prompt build — the expensive work
 * (disk reads, LLM digest) happened at hydrate/distill time.
 *
 * Demotion rules:
 *  - Band 1 keeps the trailing K exchanges; when trimming, ephemeral
 *    exchanges drop before non-ephemeral ones of any age.
 *  - Assistant prose is tail-capped per profile; cap 0 (lean) strips it.
 *  - Band 2 renders digests of exchanges NOT in band 1 (no double
 *    injection), most recent first, capped.
 */

import type { ContextProfile } from '../executionTier/contextProfile';
import type { FeatureContext, LensExchange, LensDigestEntry } from './featureContextBuilder';
import { capTail } from './chatTailBuilder';

export interface ProjectedLens {
  exchanges: LensExchange[];
  digests: LensDigestEntry[];
  /**
   * Band 3 (P3) — injection floor: the standing-constraint ledger renders
   * in EVERY profile, lean included. Never trimmed by profile caps.
   */
  constraintLedger?: string[];
}

export function projectLens(
  ctx: FeatureContext | undefined,
  profile: ContextProfile,
): ProjectedLens | undefined {
  if (!ctx?.exchanges?.length && !ctx?.digests?.length && !ctx?.constraintLedger?.length) {
    return undefined;
  }

  const all = ctx.exchanges ?? [];

  // Band 1 selection — drop ephemeral first, then oldest.
  const selected = [...all];
  while (selected.length > profile.band1K) {
    const ephemeralIdx = selected.findIndex((e) => e.ephemeral);
    selected.splice(ephemeralIdx >= 0 ? ephemeralIdx : 0, 1);
  }

  const exchanges = selected.map((e) => ({
    ...e,
    assistantFinalText:
      profile.band1AssistantCharCap > 0 && e.assistantFinalText
        ? capTail(e.assistantFinalText, profile.band1AssistantCharCap)
        : undefined,
  }));

  const band1Turns = new Set(exchanges.map((e) => e.turnId));
  const digests = (ctx.digests ?? [])
    .filter((d) => !band1Turns.has(d.turnId))
    .slice(-profile.band2MaxDigests);

  return {
    exchanges,
    digests,
    ...(ctx.constraintLedger?.length ? { constraintLedger: ctx.constraintLedger } : {}),
  };
}
