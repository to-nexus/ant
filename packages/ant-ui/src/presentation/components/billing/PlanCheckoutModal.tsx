/**
 * PlanCheckoutModal — subscription checkout (thin wrapper over PaymentModal).
 *
 * Charges for a plan tier change. Shares the card form with credit top-up; this
 * wrapper supplies the plan order summary and drives `subscribePlan`.
 */

import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { PaymentModal } from './PaymentModal';
import { formatUsd, formatCredits } from '@/shared/utils/tokenUtils';
import type { PlanInfo } from '@ant/shared';

interface PlanCheckoutModalProps {
  /** Selected plan, or null when closed. */
  plan: PlanInfo | null;
  onClose: () => void;
}

export function PlanCheckoutModal({ plan, onClose }: PlanCheckoutModalProps) {
  const { t } = useTranslation('config');
  const subscribePlan = useStore((s) => s.subscribePlan);

  if (!plan) return null;

  const planName = t(`account.plan_${plan.tier}`, plan.tier);

  return (
    <PaymentModal
      isOpen={!!plan}
      onClose={onClose}
      title={t('account.subscribeTitle', 'Subscribe')}
      eyebrow={t('account.managePlan', 'Plan')}
      accent="aurora"
      amountUsd={plan.monthlyPriceUsd}
      onPay={(pm) => subscribePlan(plan.tier, pm)}
      successMessage={t('account.subscribeSucceeded', { plan: planName })}
      summary={
        <div
          className="flex items-center justify-between rounded p-3"
          style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-1)' }}
        >
          <div>
            <div className="text-xs" style={{ color: 'var(--text-3)' }}>
              {t('account.orderSummary', 'Order')}
            </div>
            <div className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>
              {planName} ·{' '}
              {t('account.planIncluded', '{{n}} credits / mo', {
                n: formatCredits(plan.includedCreditsMonthly),
              })}
            </div>
          </div>
          <div className="text-lg font-mono font-semibold" style={{ color: 'var(--text-1)' }}>
            {t('account.planPriceMonthly', '{{amount}}/mo', { amount: formatUsd(plan.monthlyPriceUsd) })}
          </div>
        </div>
      }
    />
  );
}
