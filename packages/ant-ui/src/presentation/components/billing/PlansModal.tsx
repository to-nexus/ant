/**
 * PlansModal — server-driven plan comparison (free / pro / max).
 *
 * Renders catalog `PlanInfo`s as cards. Selecting a paid plan opens the
 * subscription checkout; selecting Free on a paid plan confirms a cycle-end
 * cancellation. Plan data + prices come from `GET /billing/catalog` — never
 * hardcoded — so the OSS FE bundle ships no pricing.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { Modal } from '../common/Modal';
import { Spinner } from '../common/async';
import { PlanCard } from './PlanCard';
import { PlanCheckoutModal } from './PlanCheckoutModal';
import type { PlanInfo, SubscriptionTier } from '@ant/shared';

interface PlansModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PlansModal({ isOpen, onClose }: PlansModalProps) {
  const { t } = useTranslation('config');
  const { showConfirm, showSuccess } = useAlertModalContext();
  const catalog = useStore((s) => s.billingCatalog);
  const refreshCatalog = useStore((s) => s.refreshCatalog);
  const balance = useStore((s) => s.billingBalance);
  const cancelSubscription = useStore((s) => s.cancelSubscription);

  const [checkoutPlan, setCheckoutPlan] = useState<PlanInfo | null>(null);

  useEffect(() => {
    if (isOpen) void refreshCatalog();
  }, [isOpen, refreshCatalog]);

  const currentTier: SubscriptionTier = balance.data?.tier ?? 'free';
  const plans = catalog.data?.plans ?? [];

  const handleSelect = (plan: PlanInfo) => {
    if (plan.tier === 'free') {
      // Downgrade to free = cancel at cycle end.
      showConfirm(
        t('account.cancelConfirm', 'Cancel your plan? You keep your current plan until the end of the billing cycle, then move to Free.'),
        {
          type: 'warning',
          title: t('account.cancelToFree', 'Cancel to Free'),
          onConfirm: async () => {
            const outcome = await cancelSubscription();
            if (outcome.ok) showSuccess(t('account.cancelSucceeded', 'Your plan will move to Free at the cycle end.'));
          },
        },
      );
      return;
    }
    setCheckoutPlan(plan);
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={t('account.plansTitle', 'Choose a plan')}
        eyebrow={t('account.managePlan', 'Plan')}
        accent="aurora"
        size="xl"
      >
        {catalog.status === 'loading' || (catalog.status === 'idle' && catalog.refreshing) ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : catalog.status === 'error' ? (
          <div className="text-xs py-6 text-center" style={{ color: 'var(--status-error-fg)' }}>
            {t('account.catalogError', 'Could not load plans. Please try again.')}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {plans.map((plan) => (
              <PlanCard key={plan.tier} plan={plan} currentTier={currentTier} onSelect={handleSelect} />
            ))}
          </div>
        )}
      </Modal>

      <PlanCheckoutModal plan={checkoutPlan} onClose={() => setCheckoutPlan(null)} />
    </>
  );
}
