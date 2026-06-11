'use client';

import { useTranslation } from 'react-i18next';
import { ArrowRight, Check } from 'lucide-react';
import type { PlanInfo, CreditPackageInfo } from '@ant/shared';
import { usePricingCatalog } from '@/lib/usePricingCatalog';
import { useAuthSession, getAppEntryUrl } from '@/lib/AuthSessionProvider';
import { GlassCard } from '@/components/aurora/GlassCard';
import { AuroraButton } from '@/components/aurora/AuroraButton';

// Presentation-only: which card carries the "Most popular" ribbon. This is
// marketing chrome, not pricing — the prices/credits/tiers themselves come
// from the server-driven catalog.
const POPULAR_TIER = 'pro';

function PlanCard({ plan, ctaHref }: { plan: PlanInfo; ctaHref: string }) {
  const { t } = useTranslation('site');
  const tier = plan.tier;
  const popular = tier === POPULAR_TIER;

  const name = t(`pricing.plans.${tier}.name`, { defaultValue: tier });
  const tagline = t(`pricing.plans.${tier}.tagline`, { defaultValue: '' });
  const bullets = t(`pricing.plans.${tier}.bullets`, {
    returnObjects: true,
    defaultValue: [],
  }) as string[];

  // Prices/credits are server-sourced fields — never hardcoded.
  const priceLabel = plan.monthlyPriceUsd === 0 ? t('pricing.freePrice') : `$${plan.monthlyPriceUsd}`;
  const creditsLabel = t('pricing.creditsPerMonth', {
    credits: plan.includedCreditsMonthly.toLocaleString(),
  });

  return (
    <GlassCard
      glow={popular}
      hoverable
      padding="lg"
      style={
        popular
          ? { border: '1px solid var(--border-brand)' }
          : undefined
      }
    >
      {popular && (
        <span
          className="text-display gradient-flow"
          style={{
            position: 'absolute',
            top: -13,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '4px 14px',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--text-on-brand)',
            background: 'var(--gradient-violet-pink)',
            backgroundSize: '200% 200%',
            borderRadius: 'var(--r-pill)',
            boxShadow: 'var(--shadow-glow-aurora)',
          }}
        >
          {t('pricing.popular')}
        </span>
      )}
      <div className="flex flex-col h-full">
        <h3 className="text-display" style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', marginBottom: 4 }}>
          {name}
        </h3>
        {tagline && <p style={{ fontSize: 14, color: 'var(--text-3)', marginBottom: 20 }}>{tagline}</p>}
        <div className="flex items-baseline gap-1.5" style={{ marginBottom: 4 }}>
          <span className="text-display" style={{ fontSize: 36, fontWeight: 800, color: 'var(--text-1)' }}>
            {priceLabel}
          </span>
          {plan.monthlyPriceUsd > 0 && (
            <span style={{ fontSize: 14, color: 'var(--text-4)' }}>{t('pricing.perMonth')}</span>
          )}
        </div>
        <p style={{ fontSize: 14, color: 'var(--violet-300)', marginBottom: 24 }}>{creditsLabel}</p>
        <ul className="space-y-2.5 grow" style={{ marginBottom: 28 }}>
          {bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2.5" style={{ fontSize: 14, color: 'var(--text-2)' }}>
              <Check className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--violet-400)' }} />
              <span>{b}</span>
            </li>
          ))}
        </ul>
        <AuroraButton href={ctaHref} external variant={popular ? 'primary' : 'secondary'} fullWidth>
          {t('pricing.cta')}
          <ArrowRight className="w-4 h-4" />
        </AuroraButton>
      </div>
    </GlassCard>
  );
}

function TopUpStrip({ packages }: { packages: CreditPackageInfo[] }) {
  const { t } = useTranslation('site');
  if (packages.length === 0) return null;
  return (
    <div className="mt-14">
      <div className="text-center mb-6">
        <h3 className="text-display" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>
          {t('pricing.topUpTitle')}
        </h3>
        <p style={{ fontSize: 14, color: 'var(--text-3)' }}>{t('pricing.topUpDesc')}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto">
        {packages.map((pkg) => (
          <GlassCard key={pkg.id} padding="none">
            <div className="flex items-center justify-between" style={{ padding: '16px 18px' }}>
              <span style={{ fontSize: 14, color: 'var(--text-2)' }}>
                {t('pricing.packageCredits', { credits: pkg.credits.toLocaleString() })}
              </span>
              {/* pkg.priceUsd: server-sourced */}
              <span className="text-display" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)' }}>
                ${pkg.priceUsd}
              </span>
            </div>
          </GlassCard>
        ))}
      </div>
    </div>
  );
}

// Self-host is mentioned only as a brief one-line note — cloud pricing is the
// primary content. No card, no link-out.
function SelfHostNote() {
  const { t } = useTranslation('site');
  return (
    <p className="text-center mt-10" style={{ fontSize: 13, color: 'var(--text-4)' }}>
      {t('pricing.selfHostNote')}
    </p>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            height: 440,
            borderRadius: 'var(--r-2xl)',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-1)',
            animation: 'pulse-soft 1.6s ease-in-out infinite',
          }}
        />
      ))}
    </div>
  );
}

export function PricingTable() {
  const { t } = useTranslation('site');
  const { user } = useAuthSession();
  const state = usePricingCatalog();
  const ctaHref = getAppEntryUrl(user);

  return (
    <div className="py-4">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        {state.status === 'loading' && <SkeletonGrid />}

        {state.status === 'cloud' && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {state.catalog.plans.map((plan) => (
                <PlanCard key={plan.tier} plan={plan} ctaHref={ctaHref} />
              ))}
            </div>
            <TopUpStrip packages={state.catalog.creditPackages} />
            <SelfHostNote />
          </>
        )}

        {state.status === 'unavailable' && (
          <div className="max-w-md mx-auto text-center">
            <p style={{ fontSize: 14, color: 'var(--text-3)', marginBottom: 16 }}>{t('pricing.error')}</p>
            <AuroraButton onClick={state.retry} variant="secondary">
              {t('pricing.retry')}
            </AuroraButton>
            <SelfHostNote />
          </div>
        )}
      </div>
    </div>
  );
}
