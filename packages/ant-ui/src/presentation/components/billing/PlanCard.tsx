/**
 * PlanCard — one subscription tier. CTA derives from the tier comparison
 * against the current plan: Current (disabled) / Upgrade / Downgrade /
 * Cancel to Free. Plan data is server-driven (catalog `PlanInfo`).
 */

import { useTranslation } from 'react-i18next';
import { compareTiers, type PlanInfo, type SubscriptionTier } from '@ant/shared';
import { formatCredits, formatUsd } from '@/shared/utils/tokenUtils';

interface PlanCardProps {
  plan: PlanInfo;
  currentTier: SubscriptionTier;
  onSelect: (plan: PlanInfo) => void;
}

export function PlanCard({ plan, currentTier, onSelect }: PlanCardProps) {
  const { t } = useTranslation('config');
  const cmp = compareTiers(plan.tier, currentTier);
  const isCurrent = cmp === 0;
  const isFree = plan.tier === 'free';

  // CTA: current → disabled badge; lower than current → downgrade/cancel-to-free;
  // higher → upgrade.
  let ctaLabel: string;
  if (isCurrent) ctaLabel = t('account.currentPlanBadge', 'Current');
  else if (cmp > 0) ctaLabel = t('account.upgrade', 'Upgrade');
  else if (isFree) ctaLabel = t('account.cancelToFree', 'Cancel to Free');
  else ctaLabel = t('account.downgrade', 'Downgrade');

  const accent = isCurrent ? 'var(--violet-500)' : 'var(--border-1)';

  return (
    <div
      className="flex flex-col gap-3 rounded-xl p-4"
      style={{
        background: 'var(--bg-surface)',
        border: `1px solid ${accent}`,
        boxShadow: isCurrent ? '0 0 0 1px var(--violet-500)' : 'none',
      }}
    >
      <div className="flex items-baseline justify-between">
        <div className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
          {t(`account.plan_${plan.tier}`, plan.tier)}
        </div>
        {isCurrent && (
          <span
            className="text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5"
            style={{ background: 'var(--violet-500)', color: 'white' }}
          >
            {t('account.currentPlanBadge', 'Current')}
          </span>
        )}
      </div>

      <div>
        <span className="text-2xl font-mono font-semibold" style={{ color: 'var(--text-1)' }}>
          {plan.monthlyPriceUsd === 0 ? formatUsd(0) : formatUsd(plan.monthlyPriceUsd)}
        </span>
        <span className="text-xs" style={{ color: 'var(--text-3)' }}>
          {' '}
          {t('account.perMonth', '/mo')}
        </span>
      </div>

      <div className="text-xs" style={{ color: 'var(--text-2)' }}>
        {t('account.planIncluded', '{{n}} credits / mo', { n: formatCredits(plan.includedCreditsMonthly) })}
      </div>

      <button
        onClick={() => !isCurrent && onSelect(plan)}
        disabled={isCurrent}
        className="mt-auto rounded px-3 py-1.5 text-xs font-medium transition-colors"
        style={{
          background: isCurrent ? 'var(--bg-surface-2)' : cmp > 0 ? 'var(--violet-500)' : 'var(--bg-surface-2)',
          color: isCurrent ? 'var(--text-3)' : cmp > 0 ? 'white' : 'var(--text-2)',
          border: '1px solid var(--border-1)',
          cursor: isCurrent ? 'default' : 'pointer',
        }}
      >
        {ctaLabel}
      </button>
    </div>
  );
}
