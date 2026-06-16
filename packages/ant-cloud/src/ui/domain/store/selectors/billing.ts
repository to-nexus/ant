/**
 * Billing selectors — token-driven LIVE credit consumption.
 *
 * Credit consumption is shown in real time as tokens accrue: the displayed
 * "effective" balance subtracts the CURRENT running job's in-flight cost
 * (computed from the live `kanban.tokenUsageByModel`) from the stored balance.
 * The authoritative Redis debit commits once at job end (settle); this selector
 * only drives the live visual decline so the NavBar/popover track the token
 * badge. When the job is not running, in-flight is 0 and effective == stored
 * (which `refreshBalance` reconciles post-settle).
 */

import type { StoreState } from '@/domain/store/types';
import { costUsdFromByModel, creditsFromUsd } from '@/shared/utils/tokenUtils';

/**
 * Credits the CURRENTLY running job has consumed so far (live, token-driven).
 * Returns 0 when no job is running so it can't double-subtract a completed
 * job's cost (which the stored balance has already absorbed via settle).
 */
export function selectLiveJobCreditsConsumed(state: StoreState): number {
  if (!state.isRunning) return 0;
  const byModel = state.kanban?.tokenUsageByModel;
  if (!byModel) return 0;
  const usd = costUsdFromByModel(byModel);
  if (usd === undefined || usd <= 0) return 0;
  // Markup is server-driven (per-account, from the balance snapshot). Default
  // to 1 (no markup) until the balance loads / when billing is disabled.
  return creditsFromUsd(usd, state.billingBalance?.data?.markup ?? 1);
}

/** BE capability flag — gates every commercial billing surface. */
export function selectBillingEnabled(state: StoreState): boolean {
  return state.billingEnabled === true;
}

/**
 * Effective (displayed) credit balance = stored balance − live in-flight
 * consumption. Floored at 0. Undefined until the balance has loaded.
 */
export function selectEffectiveCredits(state: StoreState): number | undefined {
  const stored = state.billingBalance?.data?.credits;
  if (stored === undefined || stored === null) return undefined;
  return Math.max(0, stored - selectLiveJobCreditsConsumed(state));
}
