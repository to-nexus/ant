/**
 * Billing Capability — SSOT seam.
 *
 * Billing is a COMMERCIAL surface: credit metering/debit, the credit badge,
 * the billing/payment center, and the plan catalog exist ONLY when the
 * `@ant/cloud` overlay is loaded. It is NOT a server-mode proxy anymore:
 *
 *   - Local mode          → overlay never probed → billing off (free).
 *   - Self-hosted cloud   → `ANT_SERVER_MODE=cloud` without `@ant/cloud`
 *                           → billing off (unmetered) — a LEGITIMATE profile,
 *                           identity/org/auth all run from OSS core.
 *   - Managed cloud       → overlay present → billing on.
 *
 * `isBillingEnabled()` therefore reads the RESOLVED overlay (post
 * `initCloud()` / `loadCloudModule()`), not the mode env. Managed deployments
 * that must never silently degrade to free set `ANT_REQUIRE_BILLING=1`
 * (baked into ant-cloud scripts/images) — `initCloud()` fails loud when the
 * overlay is expected but not loadable.
 */

import { peekCloudModule } from '../cloud/cloudPlugin';

/**
 * Whether the billing surface is active — true iff the `@ant/cloud` overlay
 * has been loaded. Every process entry awaits `initCloud()` (job-runner
 * children resolve the ledger via `loadCloudModule()` directly), so this
 * synchronous read is settled by the time any route/service consults it.
 */
export function isBillingEnabled(): boolean {
  return peekCloudModule() !== null;
}

/**
 * Whether this deployment REQUIRES the billing overlay (managed cloud).
 * When set, a missing/unloadable `@ant/cloud` is a boot failure — never a
 * silent free tier. Self-hosted cloud and local leave this unset.
 */
export function isBillingRequired(): boolean {
  return process.env.ANT_REQUIRE_BILLING === '1';
}
