/**
 * BillingCenterPanel — the billing surface rendered as a main-panel tab.
 *
 * One panel, clearly-separated sections: a hero balance band, Subscription
 * (recurring plans), Pay-as-you-go credits (one-time top-up), Payment method,
 * and Usage activity. Entry is the navbar credit badge / credit-recharge CTAs
 * (all via `openMainPanelTab('billing')`); the `/app/billing` deep-link
 * redirects into this tab. Aurora design system — tokens only (see
 * styles/aurora-tokens.css).
 *
 * Reuses the existing checkout flows (PlanCheckoutModal / CreditPurchaseModal →
 * PaymentModal) so the card form stays a single source of truth; the custom
 * top-up uses the dev (mock) ledger path directly.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { AsyncBoundary } from '@/presentation/components/common/async';
import { useAsyncResource } from '@/presentation/components/common/async/hooks/useAsyncResource';
import { formatCredits, formatUsd } from '@/shared/utils/tokenUtils';
import { selectEffectiveCredits, selectLiveJobCreditsConsumed } from '@cloud/domain/store/selectors/billing';
import type { CreditPackageInfo, CreditTransaction, PlanInfo } from '@ant/shared';
import { PlanCard } from '@cloud/presentation/components/billing/PlanCard';
import { PlanCheckoutModal } from '@cloud/presentation/components/billing/PlanCheckoutModal';
import { CreditPurchaseModal } from '@cloud/presentation/components/billing/CreditPurchaseModal';
import { CreditIcon } from '@cloud/presentation/components/billing/CreditIcon';
import { SectionCard } from '@/presentation/components/ConfigEditor/aurora';

/** USD list price of one credit (purchase price; mirrors @ant/shared billing). */
const USD_PER_CREDIT = 0.01;

export function BillingCenterPanel() {
  const { t } = useTranslation('config');

  const balance = useStore((s) => s.billingBalance);
  const catalog = useAsyncResource<import('@ant/shared').BillingCatalog>((s) => s.billingCatalog);
  const refreshBalance = useStore((s) => s.refreshBalance);
  const refreshCatalog = useStore((s) => s.refreshCatalog);
  const refreshUsage = useStore((s) => s.refreshUsage);
  const liveJobCredits = useStore(selectLiveJobCreditsConsumed);
  const effectiveCredits = useStore(selectEffectiveCredits);

  const [selectedPlan, setSelectedPlan] = useState<PlanInfo | null>(null);
  const [selectedPkg, setSelectedPkg] = useState<CreditPackageInfo | null>(null);

  useEffect(() => {
    void refreshBalance();
    void refreshCatalog();
    void refreshUsage(100);
  }, [refreshBalance, refreshCatalog, refreshUsage]);

  const snap = balance.data;
  const currentTier = snap?.tier ?? 'free';
  const canceledUntil =
    snap?.status === 'canceled' && snap.nextBillingDate
      ? new Date(snap.nextBillingDate).toLocaleDateString()
      : null;

  return (
    <div
      className="flex flex-col min-h-0 overflow-hidden"
      style={{ height: '100%', background: 'var(--bg-canvas)' }}
    >
      {/* Scroller — flex:1 + minHeight:0 is what lets it shrink below content
          height and actually scroll (mirrors ConfigEditor / AccountConfigEditor). */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="w-full" style={{ padding: '0 24px' }}>
          <div className="spring-in mx-auto" style={{ minWidth: 0, maxWidth: 880 }}>
            <div className="flex flex-col" style={{ gap: 18, padding: '20px 0 40px' }}>
              {/* Hero balance band — the de-facto page header. */}
              <HeroBand
                credits={effectiveCredits ?? snap?.credits}
                tier={t(`account.plan_${currentTier}`, currentTier)}
                includedMonthly={snap ? formatCredits(snap.includedCreditsMonthly) : undefined}
                liveJobCredits={liveJobCredits}
                canceledUntil={canceledUntil}
                loading={balance.status === 'loading'}
                onBuy={() => document.getElementById('pc-credits')?.scrollIntoView({ behavior: 'smooth' })}
                onManagePlan={() => document.getElementById('pc-plans')?.scrollIntoView({ behavior: 'smooth' })}
              />

              {/* Subscription (plans) */}
              <SectionCard
                id="pc-plans"
                icon="Sparkles"
                title={t('billing.subscription', 'Subscription')}
                accent="violet-pink"
              >
                <AsyncBoundary resource={catalog} surface="region">
                  {(data) => (
                    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                      {data.plans.map((plan) => (
                        <PlanCard key={plan.tier} plan={plan} currentTier={currentTier} onSelect={setSelectedPlan} />
                      ))}
                    </div>
                  )}
                </AsyncBoundary>
              </SectionCard>

              {/* Pay-as-you-go credits */}
              <SectionCard
                id="pc-credits"
                icon="Coins"
                title={t('billing.payAsYouGo', 'Pay-as-you-go credits')}
                accent="cool"
              >
                <AsyncBoundary resource={catalog} surface="region">
                  {(data) => (
                    <BuyCreditsSection packages={data.creditPackages} onSelectPackage={setSelectedPkg} />
                  )}
                </AsyncBoundary>
              </SectionCard>

              {/* Payment method (mock) */}
              <SectionCard
                id="pc-payment"
                icon="CreditCard"
                title={t('billing.paymentMethod', 'Payment method')}
                accent="sunset"
              >
                <div
                  className="rounded-lg p-4 text-sm"
                  style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-1)', color: 'var(--text-2)' }}
                >
                  <div className="mb-1 font-medium" style={{ color: 'var(--text-1)' }}>
                    {t('billing.testModeTitle', 'Test mode')}
                  </div>
                  {t(
                    'billing.testModeBody',
                    'Payments are simulated. Use card 4242 4242 4242 4242 to approve, or 4000 0000 0000 0002 to decline. No real charge is made.',
                  )}
                </div>
              </SectionCard>

              {/* Activity */}
              <SectionCard
                id="pc-activity"
                icon="Receipt"
                title={t('billing.activity', 'Usage & activity')}
                accent="aurora"
              >
                <ActivityList />
              </SectionCard>
            </div>
          </div>
        </div>
      </div>

      <PlanCheckoutModal plan={selectedPlan} onClose={() => setSelectedPlan(null)} />
      <CreditPurchaseModal pkg={selectedPkg} onClose={() => setSelectedPkg(null)} />
    </div>
  );
}

// ── hero ──────────────────────────────────────────────────────────────────

function HeroBand({
  credits,
  tier,
  includedMonthly,
  liveJobCredits,
  canceledUntil,
  loading,
  onBuy,
  onManagePlan,
}: {
  credits?: number;
  tier: string;
  includedMonthly?: string;
  liveJobCredits: number;
  canceledUntil: string | null;
  loading: boolean;
  onBuy: () => void;
  onManagePlan: () => void;
}) {
  const { t } = useTranslation('config');
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-6 p-6"
      style={{
        background: 'oklch(from var(--bg-surface) l c h / 0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid var(--border-1)',
        borderRadius: 'var(--r-xl)',
        boxShadow: 'var(--shadow-glow-aurora)',
      }}
    >
      <div className="flex items-center gap-4">
        <CreditIcon size={22} gradient />
        <div>
          <div className="flex items-baseline gap-2">
            <span
              className="text-5xl font-semibold leading-none"
              style={{ color: 'var(--text-1)', fontFamily: 'var(--font-mono)' }}
            >
              {loading ? '—' : formatCredits(credits ?? 0)}
            </span>
            <span className="text-sm" style={{ color: 'var(--text-3)' }}>
              {t('account.creditsUnit', 'credits')}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--text-3)' }}>
            <span
              className="rounded-full px-2 py-0.5 font-medium"
              style={{ background: 'var(--violet-500)', color: 'white' }}
            >
              {tier}
            </span>
            {includedMonthly && <span>{t('account.includedMonthly', '{{n}}/mo included', { n: includedMonthly })}</span>}
            {liveJobCredits > 0 && (
              <span style={{ color: 'var(--violet-500)' }}>
                · {t('billing.thisJob', 'this job')} −{formatCredits(liveJobCredits)}
              </span>
            )}
            {canceledUntil && (
              <span style={{ color: 'var(--orange-600)' }}>
                · {t('account.canceledUntil', 'Reverts to Free on {{date}}', { date: canceledUntil })}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onBuy}
          className="rounded-lg px-4 py-2 text-sm font-semibold transition-transform hover:scale-[1.02]"
          style={{ background: 'var(--gradient-violet-pink)', color: 'white' }}
        >
          {t('account.buyCredits', 'Buy credits')}
        </button>
        <button
          onClick={onManagePlan}
          className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-1)', color: 'var(--text-2)' }}
        >
          {t('account.managePlan', 'Manage plan')}
        </button>
      </div>
    </div>
  );
}

// ── buy credits (packages + custom amount) ──────────────────────────────────

function BuyCreditsSection({
  packages,
  onSelectPackage,
}: {
  packages: readonly CreditPackageInfo[];
  onSelectPackage: (pkg: CreditPackageInfo) => void;
}) {
  const { t } = useTranslation('config');
  const topUpCustomCredits = useStore((s) => s.topUpCustomCredits);
  const [amount, setAmount] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const credits = Math.floor(Number(amount));
  const valid = Number.isFinite(credits) && credits > 0;
  const usd = valid ? credits * USD_PER_CREDIT : 0;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setMsg(null);
    const outcome = await topUpCustomCredits(credits);
    setBusy(false);
    if (outcome.ok) {
      setMsg({ ok: true, text: t('billing.customAdded', 'Added {{n}} credits', { n: formatCredits(credits) }) });
      setAmount('');
    } else {
      setMsg({ ok: false, text: outcome.reason ?? t('billing.customFailed', 'Top-up failed') });
    }
  };

  return (
    <div className="space-y-4">
      {/* Preset packages */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        {packages.map((pkg) => (
          <button
            key={pkg.id}
            onClick={() => onSelectPackage(pkg)}
            className="flex flex-col items-start gap-1 rounded-xl p-4 text-left transition-transform hover:scale-[1.02]"
            style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-1)' }}
          >
            <span className="text-lg font-mono font-semibold" style={{ color: 'var(--text-1)' }}>
              {formatCredits(pkg.credits)}
            </span>
            <span className="text-xs" style={{ color: 'var(--text-3)' }}>
              {t('account.creditsUnit', 'credits')} · {formatUsd(pkg.priceUsd)}
            </span>
          </button>
        ))}
      </div>

      {/* Custom amount (dev / mock) */}
      <div
        className="rounded-xl p-4"
        style={{ background: 'var(--bg-surface-2)', border: '1px dashed var(--border-2)' }}
      >
        <div className="mb-2 text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
          {t('billing.customAmount', 'Custom amount')}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={t('billing.customPlaceholder', 'Credits')}
            className="w-36 rounded-lg px-3 py-2 text-sm font-mono outline-none"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', color: 'var(--text-1)' }}
          />
          {/* Preset quick-picks — accumulate onto the current amount */}
          {[1000, 5000, 20000].map((n) => (
            <button
              key={n}
              onClick={() => {
                const cur = Math.floor(Number(amount));
                const base = Number.isFinite(cur) && cur > 0 ? cur : 0;
                setAmount(String(base + n));
              }}
              className="rounded-full px-3 py-1 text-xs transition-colors"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', color: 'var(--text-2)' }}
            >
              +{formatCredits(n)}
            </button>
          ))}
          <button
            onClick={() => {
              setAmount('');
              setMsg(null);
            }}
            disabled={amount === ''}
            className="rounded-full px-3 py-1 text-xs transition-colors enabled:hover:opacity-80 disabled:opacity-40"
            style={{ background: 'transparent', border: '1px solid var(--border-1)', color: 'var(--text-3)' }}
          >
            {t('billing.reset', 'Reset')}
          </button>
          <span className="text-sm" style={{ color: 'var(--text-3)' }}>
            {valid ? `≈ ${formatUsd(usd)}` : ''}
          </span>
          <button
            onClick={submit}
            disabled={!valid || busy}
            className="ml-auto rounded-lg px-4 py-2 text-sm font-semibold transition-transform enabled:hover:scale-[1.02]"
            style={{
              background: valid ? 'var(--gradient-violet-pink)' : 'var(--bg-surface)',
              color: valid ? 'white' : 'var(--text-3)',
              border: valid ? 'none' : '1px solid var(--border-1)',
              cursor: valid && !busy ? 'pointer' : 'default',
            }}
          >
            {busy ? t('billing.adding', 'Adding…') : t('billing.addCredits', 'Add')}
          </button>
        </div>
        {msg && (
          <div className="mt-2 text-xs" style={{ color: msg.ok ? 'var(--status-done-fg)' : 'var(--status-error-fg)' }}>
            {msg.text}
          </div>
        )}
      </div>
    </div>
  );
}

// ── activity ─────────────────────────────────────────────────────────────────

type ActivityFilter = 'all' | 'usage' | 'charges';

function ActivityList() {
  const { t } = useTranslation('config');
  const usageData = useStore((s) => s.billingUsage.data);
  const usageRes = useAsyncResource<CreditTransaction[]>((s) => s.billingUsage);
  const canViewUsd = useStore((s) => s.billingCanViewUsd);
  const [filter, setFilter] = useState<ActivityFilter>('all');

  const filtered = useMemo(() => {
    const txs = usageData ?? [];
    if (filter === 'usage') return txs.filter((x) => x.kind === 'debit');
    if (filter === 'charges') return txs.filter((x) => x.kind !== 'debit');
    return txs;
  }, [usageData, filter]);

  const tabs: { id: ActivityFilter; label: string }[] = [
    { id: 'all', label: t('billing.filterAll', 'All') },
    { id: 'usage', label: t('billing.filterUsage', 'Usage') },
    { id: 'charges', label: t('billing.filterCharges', 'Charges') },
  ];

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id)}
            className="rounded-full px-3 py-1 text-xs transition-colors"
            style={{
              background: filter === tab.id ? 'var(--violet-500)' : 'var(--bg-surface-2)',
              color: filter === tab.id ? 'white' : 'var(--text-3)',
              border: '1px solid var(--border-1)',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <AsyncBoundary resource={usageRes} surface="region">
        {() =>
          filtered.length === 0 ? (
            <div className="py-8 text-center text-sm" style={{ color: 'var(--text-3)' }}>
              {t('billing.noActivity', 'No activity yet')}
            </div>
          ) : (
            <div className="max-h-[420px] overflow-y-auto rounded-lg" style={{ border: '1px solid var(--border-1)' }}>
              {filtered.map((tx) => (
                <ActivityRow key={tx.id} tx={tx} canViewUsd={canViewUsd} />
              ))}
            </div>
          )
        }
      </AsyncBoundary>
    </div>
  );
}

function ActivityRow({ tx, canViewUsd }: { tx: CreditTransaction; canViewUsd: boolean }) {
  const { t } = useTranslation('config');
  const credits = tx.microCredits / 1000;
  const positive = credits >= 0;
  const ts = new Date(tx.ts).toLocaleString();
  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
      style={{ borderBottom: '1px solid var(--border-1)' }}
    >
      <div className="min-w-0">
        <div className="truncate" style={{ color: 'var(--text-1)' }}>
          {t(`billing.kind_${tx.kind}`, tx.kind)}
          {tx.featureName ? <span style={{ color: 'var(--text-3)' }}> · {tx.featureName}</span> : null}
        </div>
        <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>{ts}</div>
      </div>
      <div className="shrink-0 text-right">
        <div
          className="font-mono font-medium"
          style={{ color: positive ? 'var(--status-done-fg)' : 'var(--text-2)' }}
        >
          {positive ? '+' : ''}
          {formatCredits(Math.abs(credits))}
        </div>
        {canViewUsd && tx.usdCost != null && (
          <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>{formatUsd(tx.usdCost)}</div>
        )}
      </div>
    </div>
  );
}
