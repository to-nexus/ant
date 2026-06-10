/**
 * BillingUsageSection — Account config "Billing & Usage" section.
 *
 * Customer surface: shows the credit balance + tier + recent usage in credits.
 * USD cost columns appear only when the BE marks the caller an operator
 * (`billingCanViewUsd`). Top-up goes through the (stub) payment provider.
 *
 * Rendered only for individual / team tenants — `local` has no billing.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { SectionCard } from '../ConfigEditor/aurora';
import { Spinner } from '../common/async';
import { formatUsd, formatCredits } from '@/shared/utils/tokenUtils';
import { microCreditsToCredits, CREDIT_PACKAGES, type CreditPackage } from '@ant/shared';
import { CreditPurchaseModal } from './CreditPurchaseModal';

export function BillingUsageSection() {
  const { t } = useTranslation('config');
  const balance = useStore((s) => s.billingBalance);
  const usage = useStore((s) => s.billingUsage);
  const refreshBalance = useStore((s) => s.refreshBalance);
  const refreshUsage = useStore((s) => s.refreshUsage);
  const [selectedPkg, setSelectedPkg] = useState<CreditPackage | null>(null);

  useEffect(() => {
    void refreshBalance();
    void refreshUsage();
  }, [refreshBalance, refreshUsage]);

  const snap = balance.data;
  const txs = usage.data ?? [];

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

        {/* Usage history */}
        <div>
          <div className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>
            {t('account.recentUsage', 'Recent usage')}
          </div>
          {usage.status === 'loading' ? (
            <Spinner />
          ) : txs.length === 0 ? (
            <div className="text-xs italic" style={{ color: 'var(--text-3)' }}>
              {t('account.noUsage', 'No usage yet')}
            </div>
          ) : (
            <div className="space-y-0.5 max-h-64 overflow-y-auto">
              {txs.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between text-[11px] tabular-nums py-0.5"
                  style={{ color: 'var(--text-2)' }}
                >
                  <span className="truncate mr-2" style={{ color: 'var(--text-3)' }}>
                    {tx.kind}
                    {tx.featureName ? ` · ${tx.featureName}` : ''}
                  </span>
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    <span style={{ color: tx.microCredits < 0 ? 'var(--text-2)' : 'var(--status-done-fg)' }}>
                      {tx.microCredits < 0 ? '−' : '+'}
                      {formatCredits(Math.abs(microCreditsToCredits(tx.microCredits)))}
                    </span>
                    {tx.usdCost !== undefined && (
                      <span style={{ color: 'var(--text-3)' }}>{formatUsd(tx.usdCost)}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <CreditPurchaseModal pkg={selectedPkg} onClose={() => setSelectedPkg(null)} />
    </SectionCard>
  );
}
