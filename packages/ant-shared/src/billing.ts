/**
 * Billing & Credits — shared contract (BE ↔ FE)
 *
 * Two figures travel together everywhere:
 *   - USD cost   — the precise internal COGS at list price (computed from
 *                  per-model token usage via `pricing.ts`). Operator-facing;
 *                  role-gated on the customer surface.
 *   - credits    — the customer-facing abstraction. Revenue unit.
 *
 * Economic model (see plan `individual-splendid-dragon.md`):
 *   - 1 credit  := $0.01 of LIST cost at purchase (100 credits = $1.00 paid).
 *   - consumption applies `markup`: a job whose list cost is $C burns
 *     `C × markup` dollars-worth of credits. Revenue per job = credits × $0.01
 *     = C × markup; cost = C; margin = C × (markup − 1).
 *
 * Credits are stored as INTEGER micro-credits (credit × 1000) so atomic Redis
 * INCR/DECR never loses sub-credit precision on small jobs.
 */

/** Micro-credits per displayed credit. Balances are stored in micro-credits. */
export const MICRO_PER_CREDIT = 1000;

/** USD list cost represented by one displayed credit (at purchase). */
export const USD_PER_CREDIT = 0.01;

/**
 * Default consumption markup over list cost. The single knob that turns COGS
 * into revenue. Overridable per-account via {@link BillingAccount.markup}.
 */
export const MARKUP_DEFAULT = 1.75;

export type SubscriptionTier = 'free' | 'starter' | 'pro';

/**
 * Static per-tier definition: monthly price (USD) + monthly included credit
 * grant (displayed credits). Top-up purchases add credits beyond the grant.
 */
export interface TierDefinition {
  tier: SubscriptionTier;
  monthlyPriceUsd: number;
  /** Displayed credits granted each cycle. */
  includedCreditsMonthly: number;
}

export const TIER_DEFINITIONS: Readonly<Record<SubscriptionTier, TierDefinition>> = {
  free: { tier: 'free', monthlyPriceUsd: 0, includedCreditsMonthly: 200 },
  starter: { tier: 'starter', monthlyPriceUsd: 20, includedCreditsMonthly: 2_000 },
  pro: { tier: 'pro', monthlyPriceUsd: 100, includedCreditsMonthly: 12_000 },
};

/** Convert a USD list cost into micro-credits to debit, applying markup. */
export function usdToMicroCredits(usdListCost: number, markup: number = MARKUP_DEFAULT): number {
  if (!Number.isFinite(usdListCost) || usdListCost <= 0) return 0;
  return Math.ceil((usdListCost * markup) / USD_PER_CREDIT * MICRO_PER_CREDIT);
}

/** Displayed credits (may be fractional) from micro-credits. */
export function microCreditsToCredits(micro: number): number {
  return micro / MICRO_PER_CREDIT;
}

/** Displayed credits → micro-credits (e.g. for a top-up of N credits). */
export function creditsToMicroCredits(credits: number): number {
  return Math.round(credits * MICRO_PER_CREDIT);
}

export type CreditTransactionKind =
  | 'grant' // monthly included-credit grant
  | 'debit' // job consumption
  | 'topup' // purchased credits
  | 'refund'
  | 'adjustment';

/**
 * Append-only ledger entry. `microCredits` is signed (positive = credit added,
 * negative = consumed). `usdCost` / `modelBreakdown` are present on `debit`
 * rows and are role-gated on the customer surface (operator/admin only).
 */
export interface CreditTransaction {
  id: string;
  ts: string; // ISO-8601
  kind: CreditTransactionKind;
  /** Signed micro-credit delta. */
  microCredits: number;
  /** Precise internal USD list cost (debit rows). */
  usdCost?: number;
  /** Per-model USD breakdown (debit rows). */
  modelBreakdown?: Record<string, number>;
  jobId?: string;
  projectId?: string;
  featureName?: string;
  /** Free-text note (e.g. "unknown model fallback: <id>"). */
  note?: string;
}

/** Per-(org,user) billing account: subscription + grant cycle state. */
export interface BillingAccount {
  orgId: string;
  userId: string;
  tier: SubscriptionTier;
  /** Anchor of the current monthly grant cycle (ISO-8601). */
  grantCycleAnchor: string;
  /** Consumption markup; defaults to {@link MARKUP_DEFAULT}. */
  markup: number;
  createdAt: string;
}

/** Snapshot returned by `GET /billing/balance`. */
export interface BalanceSnapshot {
  tier: SubscriptionTier;
  /** Current balance in micro-credits. */
  microCredits: number;
  /** Displayed credit balance. */
  credits: number;
  /** Monthly included-credit allotment for the tier (displayed credits). */
  includedCreditsMonthly: number;
}

/** Server response wrapper for usage history. `canViewUsd` mirrors the role gate. */
export interface UsageHistoryResponse {
  transactions: CreditTransaction[];
  canViewUsd: boolean;
}
