import { mergeTechTierConfigs, type TechTierConfig } from "@ant/shared";

/**
 * Merge the user's explicit tech-tier preset back into the LLM/profile-inferred
 * basis so `framework` + `gameEngine` survive into `resolvedAction.basis`,
 * matching what the per-task path already does via `applyExplicitTechTierOverrides`.
 *
 * The design decompose sub-handlers rebuild `basis.techTier` from `buildTechTier`
 * / the LLM `<techTier>` emit, which structurally drops `gameEngine` and only
 * keeps `framework` when the LLM re-emitted it — stripping the explicit preset.
 * This is the single reconciliation point (called once at the decompose funnel).
 *
 * Inferred `stack` stays authoritative: intent pins it (`gen-sys-fe` → frontend)
 * and fullstack detection must not be overridden by the preset's stack.
 */
export function reconcileBasisTechTier(
  explicitPreset: TechTierConfig | undefined,
  inferred: TechTierConfig | undefined,
): TechTierConfig | undefined {
  if (!explicitPreset && !inferred) return inferred;
  const merged = mergeTechTierConfigs(explicitPreset, inferred);
  const stack = inferred?.stack ?? explicitPreset?.stack;
  return stack ? { ...merged, stack } : merged;
}
