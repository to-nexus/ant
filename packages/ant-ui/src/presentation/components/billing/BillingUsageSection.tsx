/**
 * BillingUsageSection — Account config "Billing & Usage" section.
 *
 * Customer surface: shows the credit balance + tier + a "Buy credits" flow.
 * The full charge/usage ledger is intentionally NOT inlined here — it grows
 * with every purchase and job, so it lives behind a "View activity" button
 * that opens <BillingActivityModal>. The section height stays fixed regardless
 * of how many transactions accumulate.
 *
 * Rendered only for individual / team tenants — `local` has no billing.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { SectionCard } from '../ConfigEditor/aurora';
import { Spinner } from '../common/async';
import { formatUsd, formatCredits } from '@/shared/utils/tokenUtils';
import { CREDIT_PACKAGES, type CreditPackage } from '@ant/shared';
import { CreditPurchaseModal } from './CreditPurchaseModal';
import { BillingActivityModal } from './BillingActivityModal';

export function BillingUsageSection() {
  const { t } = useTranslation('config');
  const balance = useStore((s) => s.billingBalance);
  const refreshBalance = useStore((s) => s.refreshBalance);
  const [selectedPkg, setSelectedPkg] = useState<CreditPackage | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);

  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);

  const snap = balance.data;

  return (
    <SectionCard
      id="c3a-billing"
      icon="CreditCard"
      title={t('account.billingTitle', 'Billing & Usage')}
      description={t(
        'account.billingDescription',
        'Your credit balance and recent usage. Credits are consumed as you run jobs.',
      )}
      accent="cool"
    >
      <div className="space-y-4">
        {/* Balance + tier */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs" style={{ color: 'var(--text-3)' }}>
              {t('account.currentBalance', 'Current balance')}
            </div>
            <div className="text-2xl font-mono font-semibold" style={{ color: 'var(--text-1)' }}>
              {balance.status === 'loading' || (balance.status === 'idle' && balance.refreshing) ? (
                <Spinner />
              ) : snap ? (
                `${formatCredits(snap.credits)} ${t('account.creditsUnit', 'credits')}`
              ) : (
                '—'
              )}
            </div>
            {snap && (
              <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                {t('account.tier', 'Plan')}: {snap.tier} ·{' '}
                {t('account.includedMonthly', '{{n}}/mo included', {
                  n: formatCredits(snap.includedCreditsMonthly),
                })}
              </div>
            )}
          </div>
        </div>

        {/* Buy credits — package cards open the checkout modal */}
        <div>
          <div className="text-xs mb-1.5" style={{ color: 'var(--text-3)' }}>
            {t('account.buyCredits', 'Buy credits')}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {CREDIT_PACKAGES.map((pkg) => (
              <button
                key={pkg.id}
                onClick={() => setSelectedPkg(pkg)}
                className="flex flex-col items-start gap-0.5 rounded p-2.5 text-left transition-colors"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-surface)')}
              >
                <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                  {t(`account.package_${pkg.id}`, pkg.id)}
                </span>
                <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
                  {formatCredits(pkg.credits)}
                </span>
                <span className="text-xs font-mono" style={{ color: 'var(--text-2)' }}>
                  {formatUsd(pkg.priceUsd)}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Full ledger lives behind the detail modal */}
        <div>
          <button
            onClick={() => setActivityOpen(true)}
            className="text-xs rounded px-3 py-1.5 transition-colors"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', color: 'var(--text-2)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-surface)')}
          >
            {t('account.viewActivity', 'View activity →')}
          </button>
        </div>
      </div>

      <CreditPurchaseModal pkg={selectedPkg} onClose={() => setSelectedPkg(null)} />
      <BillingActivityModal isOpen={activityOpen} onClose={() => setActivityOpen(false)} />
    </SectionCard>
  );
}
