/**
 * Billing Capability — SSOT
 *
 * Single source of truth for the `ANT_BILLING_ENABLED` toggle (mirrors
 * `vectorDbCapability.ts`). All callers MUST go through `isBillingEnabled()`
 * instead of reading `process.env.ANT_BILLING_ENABLED` directly.
 *
 * Default: `false` (opt-in). Billing is the COMMERCIAL cloud surface (credit
 * ledger, plans, payment). OSS / local runs with it OFF.
 *
 * When disabled:
 *   - `InfrastructureFactory.getCreditLedger()/getPaymentProvider()` return
 *     no-op adapters (`getBalance → free/0`, `settle/topUp/changeTier → no-op`).
 *   - The billing routes (`/billing/*`) are NOT registered (404).
 *   - `GET /system/config` reports `capabilities.billing = false`; the FE hides
 *     every commercial billing surface (account plan/credit section, nav badge).
 *   - Job settle in `finalizeTerminalJob` flows through the no-op ledger — no
 *     special-case branch in the lifecycle; the gate lives in the factory.
 */

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

/**
 * Whether the commercial billing surface is enabled for this process.
 *
 * Reads `process.env.ANT_BILLING_ENABLED` lazily on every call so tests can
 * flip the flag at runtime without re-importing modules.
 */
export function isBillingEnabled(): boolean {
  const raw = process.env.ANT_BILLING_ENABLED;
  if (raw === undefined) return false;
  return TRUTHY.has(raw.trim().toLowerCase());
}
