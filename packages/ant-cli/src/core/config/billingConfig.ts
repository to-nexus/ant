/**
 * Billing configuration SSOT.
 *
 * Two independent switches:
 *   - RECORDING is always on: the settle hook computes precise USD cost and
 *     debits credits so usage/cost is observable from day one.
 *   - ENFORCEMENT (the hard 402 reserve gate at enqueue) is opt-in via
 *     `ANT_BILLING_ENABLED=true` so rollout cannot surprise-block existing
 *     flows. Never read `process.env.ANT_BILLING_ENABLED` elsewhere.
 */
export function isBillingEnforced(): boolean {
  return process.env.ANT_BILLING_ENABLED === 'true';
}
