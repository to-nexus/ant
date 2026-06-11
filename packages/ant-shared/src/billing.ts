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
 *   - 1 credit  := $0.01 of LIST cost at purchase (100 credits = $1.00 paid).
 *   - consumption applies a per-account `markup`: a job whose list cost is $C
 *     burns `C × markup` dollars-worth of credits.
 *
 * Credits are stored as INTEGER micro-credits (credit × 1000) so atomic Redis
 * INCR/DECR never loses sub-credit precision on small jobs.
 *
 * ── OSS / cloud seam ────────────────────────────────────────────────────
 * This file is OSS-resident and holds only NEUTRAL shapes + math. The
 * COMMERCIAL values (markup magnitude, plan prices, credit-package offering)
 * live BE-side in the cloud catalog module and reach the FE via the
 * server-driven `GET /billing/catalog` + `BalanceSnapshot`. Nothing here
 * encodes the resale offering, so the OSS bundle ships no pricing.
 */

/** Micro-credits per displayed credit. Balances are stored in micro-credits. */
export const MICRO_PER_CREDIT = 1000;

/** USD list cost represented by one displayed credit (at purchase). */
export const USD_PER_CREDIT = 0.01;

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

/** Current billing-account schema version (bumped at the tier rename). */
export const BILLING_SCHEMA_VERSION = 2;

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
 * FACE VALUE (`priceUsd === credits × USD_PER_CREDIT`); margin lives in the
 * consumption markup, not the sale.
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
