/**
 * Billing Capability — SSOT seam.
 *
 * Billing is a COMMERCIAL (cloud) surface: credit metering/debit, the credit
 * badge, the billing/payment center, and the plan catalog exist ONLY in cloud
 * mode. Local mode is FREE — no credits are metered or debited, and the factory
 * hands out the no-op ledger/payment adapters, so the entire surface is hidden.
 *
 * Gated on `ANT_SERVER_MODE` (cloud sets it to `cloud`; local leaves it unset or
 * `local`), NOT on the retired `ANT_BILLING_ENABLED` env. Cloud individual +
 * team both run with `ANT_SERVER_MODE=cloud`, so this does not reintroduce the
 * earlier regression where an unset env blanked cloud billing.
 *
 * This remains the single seam point for the FUTURE physical `@ant/cloud`
 * extraction (an OSS build without the package returns `false`); the mode gate
 * is the interim mechanism. Reading the env here is acceptable — this is the
 * config layer (cf. `periphery/.../helpers/userContext.ts::isLocalServerMode`,
 * the HTTP-side mirror of the same rule).
 */

/** Whether the billing surface is active. Cloud-only; local mode is free. */
export function isBillingEnabled(): boolean {
  return (process.env.ANT_SERVER_MODE || 'local') === 'cloud';
}
