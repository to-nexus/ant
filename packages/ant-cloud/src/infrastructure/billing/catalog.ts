/**
 * Billing catalog — COMMERCIAL SSOT (cloud-designated).
 *
 * The single place the resale offering lives: consumption markup, subscription
 * plan prices/allotments, and purchasable credit packages. This module is part
 * of the cloud surface — when billing is extracted to `@ant/cloud` (follow-up),
 * it moves with the adapters and leaves the OSS repo. The FE never imports it;
 * it receives this data via the server-driven `GET /billing/catalog`.
 *
 * `@ant/shared` holds only the neutral SHAPES (`PlanInfo`, `CreditPackageInfo`,
 * `SubscriptionTier`); the magnitudes are here.
 */

import type {
  BillingCatalog,
  CreditPackageInfo,
  PlanInfo,
  SubscriptionTier,
} from '@ant/shared';

/**
 * Default consumption markup over list cost — the single knob that turns COGS
 * into revenue. Seeded onto each account's `markup`; overridable per-account.
 */
export const MARKUP_DEFAULT = 1.75;

/**
 * Minimum credit balance required to START (or resume) a job — a small floor
 * (~one planning LLM call's worth) so the pre-flight gate blocks genuinely
 * empty accounts without rejecting users who can still afford meaningful work.
 * The free tier's 200/mo grant clears this comfortably.
 */
export const MIN_START_CREDITS = 10;

/** Per-tier definition: monthly price (USD) + monthly included credit grant. */
export const TIER_DEFINITIONS: Readonly<Record<SubscriptionTier, PlanInfo>> = {
  free: { tier: 'free', monthlyPriceUsd: 0, includedCreditsMonthly: 200 },
  pro: { tier: 'pro', monthlyPriceUsd: 20, includedCreditsMonthly: 2_000 },
  max: { tier: 'max', monthlyPriceUsd: 100, includedCreditsMonthly: 12_000 },
};

/** Purchasable credit packages (top-up). Ids are NON-tier words by design. */
export const CREDIT_PACKAGES: readonly CreditPackageInfo[] = [
  { id: 'small', credits: 1_000, priceUsd: 10 },
  { id: 'medium', credits: 5_000, priceUsd: 50 },
  { id: 'large', credits: 20_000, priceUsd: 200 },
];

export function getCreditPackage(id: string): CreditPackageInfo | undefined {
  return CREDIT_PACKAGES.find((p) => p.id === id);
}

export function getPlan(tier: SubscriptionTier): PlanInfo {
  return TIER_DEFINITIONS[tier];
}

/** Included monthly credits for a tier (convenience for the ledger grant). */
export function includedCreditsFor(tier: SubscriptionTier): number {
  return TIER_DEFINITIONS[tier].includedCreditsMonthly;
}

/** Assemble the server-driven catalog payload. */
export function buildCatalog(): BillingCatalog {
  return {
    plans: Object.values(TIER_DEFINITIONS),
    creditPackages: [...CREDIT_PACKAGES],
    currency: 'usd',
  };
}
