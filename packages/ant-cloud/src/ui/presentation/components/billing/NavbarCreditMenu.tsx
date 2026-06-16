import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CreditIcon } from '@cloud/presentation/components/billing/CreditIcon';
import { useStore } from '@/domain/store';
import { selectServerMode } from '@/domain/store/selectors/auth';
import { selectEffectiveCredits, selectLiveJobCreditsConsumed } from '@cloud/domain/store/selectors/billing';
import { formatCredits, formatUsd } from '@/shared/utils/tokenUtils';
import { microCreditsToCredits } from '@ant/shared';

/**
 * NavbarCreditMenu — the cloud credit badge + balance/usage popover in the
 * navbar. Self-contained (reads the store directly, owns its menu state) so it
 * can be rendered through the `navbar.credit` slot without any props. Returns
 * null until billing is enabled and a balance has loaded, so the navbar shows
 * nothing in local mode even when the cloud bundle is present.
 */
export function NavbarCreditMenu() {
  const { t } = useTranslation('nav');
  const billingEnabled = useStore((state) => state.billingEnabled);
  const billingBalance = useStore((state) => state.billingBalance);
  const billingUsage = useStore((state) => state.billingUsage);
  const refreshBalance = useStore((state) => state.refreshBalance);
  const refreshUsage = useStore((state) => state.refreshUsage);
  const effectiveCredits = useStore(selectEffectiveCredits);
  const liveJobCredits = useStore(selectLiveJobCreditsConsumed);
  const userEmail = useStore((state) => state.userEmail);
  const serverMode = useStore((state) => selectServerMode(state));
  const openMainPanelTab = useStore((state) => state.openMainPanelTab);

  const [showCreditMenu, setShowCreditMenu] = useState(false);
  const creditMenuRef = useRef<HTMLDivElement>(null);

  // Refresh credit balance whenever the identity/mode resolves. Billing is
  // cloud-only (local mode is free); `billingEnabled` comes from /system/config.
  useEffect(() => {
    if (billingEnabled) void refreshBalance();
  }, [userEmail, serverMode, billingEnabled, refreshBalance]);

  // Close credit menu on outside click + refresh usage when opened.
  useEffect(() => {
    if (!showCreditMenu) return;
    void refreshUsage();
    const handleClick = (e: MouseEvent) => {
      if (creditMenuRef.current && !creditMenuRef.current.contains(e.target as Node)) {
        setShowCreditMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showCreditMenu, refreshUsage]);

  if (!billingEnabled || !billingBalance.data || effectiveCredits === undefined) return null;

  return (
    <div className="relative hidden sm:block mr-1" ref={creditMenuRef}>
      <button
        onClick={() => setShowCreditMenu((v) => !v)}
        className="inline-flex items-center text-xs font-mono font-medium px-2 py-1"
        title={t('billing.creditBalance', 'Credit balance')}
        style={{
          background: 'var(--bg-surface-2)',
          borderRadius: 'var(--r-md)',
          color: liveJobCredits > 0 ? 'var(--violet-500)' : 'var(--text-2)',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-surface-2)'; }}
      >
        <CreditIcon size={13} className="mr-1" />
        {formatCredits(effectiveCredits)}
      </button>

      {showCreditMenu && (
        <div
          className="absolute top-full right-0 mt-2 w-72 py-2 z-50"
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-2)',
            borderRadius: 'var(--r-md)',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          <div className="px-4 pb-2">
            <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-4)' }}>
              {t('billing.creditBalance', 'Credit balance')}
            </div>
            <div className="flex items-center gap-1.5 text-xl font-mono font-semibold" style={{ color: 'var(--text-1)' }}>
              <CreditIcon size={18} gradient />
              {formatCredits(effectiveCredits)}
              <span className="text-xs font-sans font-medium tracking-wide" style={{ color: 'var(--text-3)' }}>CREDIT</span>
            </div>
            <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
              {billingBalance.data.tier} · {t('billing.includedMonthly', '{{n}}/mo', { n: formatCredits(billingBalance.data.includedCreditsMonthly) })}
              {liveJobCredits > 0 && (
                <> · <span style={{ color: 'var(--violet-500)' }}>{t('billing.thisJob', 'this job')} −{formatCredits(liveJobCredits)}</span></>
              )}
            </div>
          </div>
          <div className="my-1" style={{ height: 1, background: 'var(--border-1)' }} />
          <div className="px-4 py-1 max-h-48 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-4)' }}>
              {t('billing.recentUsage', 'Recent usage')}
            </div>
            {(billingUsage.data ?? []).length === 0 ? (
              <div className="text-[11px] italic" style={{ color: 'var(--text-3)' }}>
                {t('billing.noUsage', 'No usage yet')}
              </div>
            ) : (
              (billingUsage.data ?? []).slice(0, 6).map((tx) => (
                <div key={tx.id} className="flex items-center justify-between text-[11px] tabular-nums py-0.5" style={{ color: 'var(--text-2)' }}>
                  <span className="truncate mr-2" style={{ color: 'var(--text-3)' }}>
                    {tx.kind}{tx.featureName ? ` · ${tx.featureName}` : ''}
                  </span>
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    <span style={{ color: tx.microCredits < 0 ? 'var(--text-2)' : 'var(--status-done-fg)' }}>
                      {tx.microCredits < 0 ? '−' : '+'}{formatCredits(Math.abs(microCreditsToCredits(tx.microCredits)))}
                    </span>
                    {tx.usdCost !== undefined && (
                      <span style={{ color: 'var(--text-3)' }}>{formatUsd(tx.usdCost)}</span>
                    )}
                  </span>
                </div>
              ))
            )}
          </div>
          <div className="my-1" style={{ height: 1, background: 'var(--border-1)' }} />
          <button
            onClick={() => {
              setShowCreditMenu(false);
              openMainPanelTab('billing');
            }}
            className="w-full px-4 py-1.5 text-left text-xs"
            style={{ color: 'var(--text-2)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            {t('billing.openCenter', 'Open billing & credits →')}
          </button>
        </div>
      )}
    </div>
  );
}
