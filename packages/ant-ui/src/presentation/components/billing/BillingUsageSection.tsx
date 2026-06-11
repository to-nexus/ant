/**
 * BillingUsageSection — Account config "Plan & Billing" summary.
 *
 * Summary only: current membership, the CURRENT plan (single card — NOT a plan
 * picker), and the credit balance. Plan selection, credit top-up, and the full
 * ledger each live behind their own modal (Manage plan / Buy credits / View
 * activity), so this section's height stays fixed.
 *
 * Rendered only when the BE reports `billingEnabled` (cloud). OSS / local hides
 * the whole section — see AccountConfigEditor.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { SectionCard } from '../ConfigEditor/aurora';
import { Spinner } from '../common/async';
import { formatCredits } from '@/shared/utils/tokenUtils';
import { selectOrgDisplayLabel, selectActiveUserRole, selectUserOrgKind } from '@/domain/store/selectors/auth';
import { PlansModal } from './PlansModal';
import { TopUpModal } from './TopUpModal';
import { BillingActivityModal } from './BillingActivityModal';

export function BillingUsageSection() {
  const { t } = useTranslation('config');
  const balance = useStore((s) => s.billingBalance);
  const refreshBalance = useStore((s) => s.refreshBalance);
  const orgLabel = useStore(selectOrgDisplayLabel);
  const orgKind = useStore(selectUserOrgKind);
  const role = useStore(selectActiveUserRole);

  const [plansOpen, setPlansOpen] = useState(false);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);

  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);

  const snap = balance.data;
  const loading = balance.status === 'loading' || (balance.status === 'idle' && balance.refreshing);
  const canceledUntil = snap?.status === 'canceled' && snap.nextBillingDate
    ? new Date(snap.nextBillingDate).toLocaleDateString()
    : null;

  const btn = {
    base: 'text-xs rounded px-3 py-1.5 transition-colors',
    style: { background: 'var(--bg-surface)', border: '1px solid var(--border-1)', color: 'var(--text-2)' } as const,
  };

  return (
    <SectionCard
      id="c3a-billing"
      icon="CreditCard"
      title={t('account.billingTitle', 'Plan & Billing')}
      description={t(
        'account.billingDescription',
        'Your membership, plan, and credit balance. Credits are consumed as you run jobs.',
      )}
      accent="cool"
    >
      <div className="space-y-4">
        {/* Membership */}
        <div className="flex items-center justify-between rounded p-3" style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-1)' }}>
          <div>
            <div className="text-xs" style={{ color: 'var(--text-3)' }}>
              {t('account.membershipTitle', 'Account')}
            </div>
            <div className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>
              {orgLabel ?? '—'}
            </div>
          </div>
          <div className="text-right text-[11px]" style={{ color: 'var(--text-3)' }}>
            <div>{t(`account.orgKind_${orgKind ?? 'individual'}`, orgKind ?? 'individual')}</div>
            {role && <div>{t(`account.role_${role}`, role)}</div>}
          </div>
        </div>

        {/* Current plan + balance */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs" style={{ color: 'var(--text-3)' }}>
              {t('account.currentPlan', 'Current plan')}
            </div>
            <div className="text-lg font-semibold" style={{ color: 'var(--text-1)' }}>
              {loading ? <Spinner /> : snap ? t(`account.plan_${snap.tier}`, snap.tier) : '—'}
            </div>
            {snap && (
              <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                {t('account.includedMonthly', '{{n}}/mo included', {
                  n: formatCredits(snap.includedCreditsMonthly),
                })}
                {canceledUntil && (
                  <>
                    {' · '}
                    <span style={{ color: 'var(--status-warning-fg, var(--orange-600))' }}>
                      {t('account.canceledUntil', 'Reverts to Free on {{date}}', { date: canceledUntil })}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-xs" style={{ color: 'var(--text-3)' }}>
              {t('account.currentBalance', 'Current balance')}
            </div>
            <div className="text-2xl font-mono font-semibold" style={{ color: 'var(--text-1)' }}>
              {loading ? <Spinner /> : snap ? formatCredits(snap.credits) : '—'}
            </div>
            <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
              {t('account.creditsUnit', 'credits')}
            </div>
          </div>
        </div>

        {/* Entry points */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setPlansOpen(true)}
            className={btn.base}
            style={{ ...btn.style, background: 'var(--violet-500)', color: 'white' }}
          >
            {t('account.managePlan', 'Manage plan')}
          </button>
          <button onClick={() => setTopUpOpen(true)} className={btn.base} style={btn.style}>
            {t('account.buyCredits', 'Buy credits')}
          </button>
          <button onClick={() => setActivityOpen(true)} className={btn.base} style={btn.style}>
            {t('account.viewActivity', 'View activity →')}
          </button>
        </div>
      </div>

      <PlansModal isOpen={plansOpen} onClose={() => setPlansOpen(false)} />
      <TopUpModal isOpen={topUpOpen} onClose={() => setTopUpOpen(false)} />
      <BillingActivityModal isOpen={activityOpen} onClose={() => setActivityOpen(false)} />
    </SectionCard>
  );
}
