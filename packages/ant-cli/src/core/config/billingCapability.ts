/**
 * Billing Capability — SSOT seam.
 *
 * Billing is ALWAYS-ON at this stage. The payment path is a temporary mock and
 * real PG integration comes later; there is no reason to toggle billing per
 * environment, so this is not env-controlled.
 *
 * This function is retained as the single seam point for the FUTURE physical
 * `@ant/cloud` extraction: at that point it will gate on the cloud package's
 * presence (so an OSS build without the package returns `false` and the
 * factory hands out the no-op adapters), NOT on a runtime env var. Keeping the
 * single seam here keeps that extraction mechanical.
 */

/** Whether the billing surface is active. Always true at this stage. */
export function isBillingEnabled(): boolean {
  return true;
}
