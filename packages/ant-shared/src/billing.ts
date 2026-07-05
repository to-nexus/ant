/**
 * Billing & Credits — shared contract (BE ↔ FE), NEUTRAL surface only.
 *
 * Two figures travel together everywhere:
 *   - USD cost   — the precise internal COGS at list price (computed from
 *                  per-model token usage via `pricing.ts`). Operator-facing;
 *                  role-gated on the customer surface.
 *   - credits    — the customer-facing abstraction. Revenue unit.
 *
 * Economic model:
 *   - 1 credit  := $1 (par). A credit reads like a dollar — bought at par and
 *     consumed at par for LLM cost (pass-through).
 *   - LLM cost is PASS-THROUGH: `markup = 1.0`, ANT takes no margin on Anthropic
 *     calls. A job whose list cost is $C burns exactly C credits of LLM cost.
 *   - REVENUE = a per-job platform fee (base matrix by job kind × execution tier,
 *     plus a per-user-facing-task increment) charged in credits at run time. This
 *     fee is ANT's margin; its magnitude lives in the cloud catalog. The `markup`
 *     field is retained (default 1.0) for future per-account promos only.
 *
 * Credits are stored as INTEGER micro-credits (credit × 100_000, i.e. atomic
 * unit $0.00001) so atomic Redis INCR/DECR never loses sub-cent precision on
 * small jobs. Display rounds to $0.01; the ledger stays exact.
 *
 * ── OSS / cloud seam ────────────────────────────────────────────────────
 * This file is OSS-resident and holds only NEUTRAL shapes + math. The
 * COMMERCIAL values (platform-fee matrix, plan prices, credit-package offering)
 * live BE-side in the cloud catalog module and reach the FE via the
 * server-driven `GET /billing/catalog` + `BalanceSnapshot`. Nothing here
 * encodes the resale offering, so the OSS bundle ships no pricing.
 */

/**
 * Micro-credits per displayed credit. Balances are stored in micro-credits.
 * At `1 credit = $1`, the atomic unit is $0.00001 — fine enough that per-job
 * debits stay exact and no cent-level truncation margin accrues.
 */
export const MICRO_PER_CREDIT = 100_000;

/** USD represented by one displayed credit. Par: 1 credit = $1. */
export const USD_PER_CREDIT = 1.0;

/** Subscription tier identity. Prices/allotments are server-driven (catalog). */
export type SubscriptionTier = 'free' | 'pro' | 'max';

/** Ascending tier order (free → max). Drives upgrade/downgrade/current CTAs. */
export const TIER_ORDER: readonly SubscriptionTier[] = ['free', 'pro', 'max'];

/**
 * Compare two tiers by rank. `> 0` ⇒ `a` is higher (b→a is an upgrade),
 * `< 0` ⇒ lower (downgrade), `0` ⇒ same. Unknown tiers sort as lowest.
 */
export function compareTiers(a: SubscriptionTier, b: SubscriptionTier): number {
  return TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b);
}

/**
 * Canonicalize a tier string read from storage. Records written before the
 * `free/starter/pro → free/pro/max` rename map by the legacy table; callers
 * gate this on {@link BillingAccount.schemaVersion} `< 2`.
 */
export const LEGACY_TIER_MAP: Readonly<Record<string, SubscriptionTier>> = {
  starter: 'pro',
  pro: 'max',
};

/**
 * Current billing-account schema version.
 *   v2 — tier rename (free/starter/pro → free/pro/max).
 *   v3 — pricing cutover (1 credit = $0.01 → $1). Accounts below v3 are re-seeded
 *        (balance/ledger cleared, re-granted at the new unit). The tier-vocabulary
 *        migration stays keyed on `< 2` so a v2 account's tier is NOT re-mapped.
 */
export const BILLING_SCHEMA_VERSION = 3;

/** Schema boundary below which the legacy tier VOCABULARY map applies. */
export const TIER_VOCAB_SCHEMA_VERSION = 2;

/**
 * Normalize a raw tier value. With `legacy = true` (schemaVersion `< 2`) the
 * legacy vocabulary is mapped forward; otherwise current values pass through
 * and anything unknown falls back to `free`.
 */
export function normalizeTier(raw: string | undefined, legacy: boolean): SubscriptionTier {
  if (legacy && raw && raw in LEGACY_TIER_MAP) return LEGACY_TIER_MAP[raw];
  if (raw === 'free' || raw === 'pro' || raw === 'max') return raw;
  return 'free';
}

/** Convert a USD list cost into micro-credits to debit, applying markup. */
export function usdToMicroCredits(usdListCost: number, markup: number = 1): number {
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

// ── Catalog contract (server-driven; values live BE-side) ────────────────

/**
 * Subscription plan as exposed by `GET /billing/catalog`. Shape only — the
 * concrete prices/allotments come from the cloud catalog module, never from
 * this OSS file.
 */
export interface PlanInfo {
  tier: SubscriptionTier;
  monthlyPriceUsd: number;
  /** Displayed credits granted each cycle. */
  includedCreditsMonthly: number;
  /** Optional marketing feature bullets (i18n keys or literals). */
  features?: string[];
}

/**
 * Purchasable credit package as exposed by `GET /billing/catalog`. Price is at
 * FACE VALUE (`priceUsd === credits × USD_PER_CREDIT`, i.e. par); margin lives
 * in the per-job platform fee, not the sale.
 */
export interface CreditPackageInfo {
  id: string;
  credits: number;
  priceUsd: number;
}

/** Response of `GET /billing/catalog`. */
export interface BillingCatalog {
  plans: PlanInfo[];
  creditPackages: CreditPackageInfo[];
  currency: 'usd';
}

// ── Payment + purchase ───────────────────────────────────────────────────

/**
 * Payment-method input collected at checkout. For the mock provider this is
 * raw card data; for a real PG (Stripe/Toss) this becomes a tokenized handle /
 * client secret and the card never touches our server.
 */
export interface PaymentMethodInput {
  cardNumber: string;
  expMonth: number;
  expYear: number;
  cvc: string;
}

/** Outcome of a credit purchase or subscription charge. */
export interface PurchaseOutcome {
  ok: boolean;
  status: 'succeeded' | 'declined' | 'error';
  transactionId?: string;
  creditsAdded?: number;
  amountChargedUsd?: number;
  declineCode?: string;
  reason?: string;
}

/** Body of `POST /billing/subscribe`. Price resolved server-side from catalog. */
export interface SubscribeRequest {
  tier: SubscriptionTier;
  paymentMethod?: PaymentMethodInput;
  idempotencyKey: string;
}

/**
 * Stripe-style test cards so the decline path is exercisable end-to-end.
 * Any other well-formed card number succeeds in the mock provider.
 */
export const MOCK_SUCCESS_CARD = '4242424242424242';
export const MOCK_DECLINE_CARD = '4000000000000002';

/**
 * Hard cap on retained ledger entries per (org,user). The Redis ledger is
 * `LTRIM`-bounded to this size, so it is also the ceiling for a usage fetch.
 * Single source for both the trim cap (BE) and the fetch ceiling (route + FE).
 */
export const CREDIT_LEDGER_MAX_ENTRIES = 1000;

export type CreditTransactionKind =
  | 'grant' // monthly included-credit grant
  | 'subscription' // immediate grant on plan start/change
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
  /** Precise internal USD list cost — LLM pass-through portion (debit rows). */
  usdCost?: number;
  /** Per-model USD breakdown (debit rows). */
  modelBreakdown?: Record<string, number>;
  /**
   * Platform-fee portion of a debit, in micro-credits (base + per-task). Lets
   * the customer surface itemize "run fee" vs "AI (pass-through)". Present on
   * `debit` rows once a platform fee applied.
   */
  platformFeeMicroCredits?: number;
  jobId?: string;
  projectId?: string;
  featureName?: string;
  /** Free-text note (e.g. "unknown model fallback: <id>"). */
  note?: string;
}

/** Subscription lifecycle status. `none` = free / never subscribed. */
export type SubscriptionStatus = 'active' | 'canceled' | 'none';

/** Per-(org,user) billing account: subscription + grant cycle state. */
export interface BillingAccount {
  orgId: string;
  userId: string;
  tier: SubscriptionTier;
  /** Anchor of the current monthly grant cycle (ISO-8601). */
  grantCycleAnchor: string;
  /** Consumption markup; the seed magnitude lives in the cloud catalog. */
  markup: number;
  createdAt: string;
  /** Schema marker; `< 2` (or absent) ⇒ legacy tier vocabulary, normalize. */
  schemaVersion?: number;
  /** Subscription state mirror (cloud). */
  status?: SubscriptionStatus;
  currentPlanId?: SubscriptionTier;
  subscribedAt?: string;
  /** Set when a cycle-end cancellation is pending (tier stays until anchor+cycle). */
  canceledAt?: string;
  /** Provider subscription reference (mock: synthetic). */
  providerRef?: string;
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
  /** Subscription state mirror (absent/`none` on free). */
  status?: SubscriptionStatus;
  currentPlanId?: SubscriptionTier;
  /** Cycle renewal / cancellation-effective date (ISO-8601). */
  nextBillingDate?: string;
  /** Per-account consumption markup (drives FE live-consumption display). */
  markup?: number;
}

/** Server response wrapper for usage history. `canViewUsd` mirrors the role gate. */
export interface UsageHistoryResponse {
  transactions: CreditTransaction[];
  canViewUsd: boolean;
}
