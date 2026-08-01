'use client';

import { useTranslation } from 'react-i18next';
import { ArrowRight, Check } from 'lucide-react';
import { TIER_ORDER, type PlanInfo, type SubscriptionTier } from '@ant/shared';
import { usePricingCatalog } from '@/lib/usePricingCatalog';
import { getCloudBillingUrl } from '@/lib/AuthSessionProvider';
import { useCloudGate } from '@/lib/CloudGateProvider';
import { GlassCard } from '@/components/aurora/GlassCard';
import { AuroraButton } from '@/components/aurora/AuroraButton';

// Presentation-only: which card carries the "Most popular" ribbon. This is
// marketing chrome, not pricing — the prices/credits/tiers themselves come
// from the server-driven catalog.
const POPULAR_TIER = 'pro';

/**
 * One plan card. `plan` carries the three server-sourced numbers (price,
 * included credits, tier); everything else — name, tagline, bullets, the
 * "popular" ribbon, the tier set itself — is local. So when the catalog can't
 * be reached the card still renders in full and only the price block degrades:
 * a partial page beats an error page, and the plan lineup is not a secret.
 */
function PlanCard({
  tier,
  plan,
  ctaHref,
}: {
  tier: SubscriptionTier;
  plan?: PlanInfo;
  ctaHref: string;
}) {
  const { t } = useTranslation('site');
  const { cloudBlocked, requestCloud } = useCloudGate();
  const popular = tier === POPULAR_TIER;

  const name = t(`pricing.plans.${tier}.name`, { defaultValue: tier });
  const tagline = t(`pricing.plans.${tier}.tagline`, { defaultValue: '' });
  const bullets = t(`pricing.plans.${tier}.bullets`, {
    returnObjects: true,
    defaultValue: [],
  }) as string[];

  // Prices/credits are server-sourced fields — never hardcoded. Absent catalog
  // ⇒ an em-dash placeholder holding the same slot, so the grid keeps its
  // rhythm instead of collapsing.
  const priceLabel = !plan
    ? '—'
    : plan.monthlyPriceUsd === 0
      ? t('pricing.freePrice')
      : `$${plan.monthlyPriceUsd}`;
  const creditsLabel = plan
    ? t('pricing.creditsPerMonth', { credits: plan.includedCreditsMonthly.toLocaleString() })
    : t('pricing.creditsUnknown');

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
          <span
            className="text-display"
            style={{ fontSize: 36, fontWeight: 800, color: plan ? 'var(--text-1)' : 'var(--text-4)' }}
          >
            {priceLabel}
          </span>
          {plan && plan.monthlyPriceUsd > 0 && (
            <span style={{ fontSize: 14, color: 'var(--text-4)' }}>{t('pricing.perMonth')}</span>
          )}
        </div>
        <p style={{ fontSize: 14, color: plan ? 'var(--violet-300)' : 'var(--text-4)', marginBottom: 24 }}>
          {creditsLabel}
        </p>
        <ul className="space-y-2.5 grow" style={{ marginBottom: 28 }}>
          {bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2.5" style={{ fontSize: 14, color: 'var(--text-2)' }}>
              <Check className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--violet-400)' }} />
              <span>{b}</span>
            </li>
          ))}
        </ul>
        {/* Prices stay visible in local mode (your LLM spend is real either
            way); only the checkout deep-link is gated. */}
        {cloudBlocked ? (
          <AuroraButton onClick={requestCloud} variant={popular ? 'primary' : 'secondary'} fullWidth>
            {t('pricing.cta')}
            <ArrowRight className="w-4 h-4" />
          </AuroraButton>
        ) : (
          <AuroraButton href={ctaHref} external variant={popular ? 'primary' : 'secondary'} fullWidth>
            {t('pricing.cta')}
            <ArrowRight className="w-4 h-4" />
          </AuroraButton>
        )}
      </div>
    </GlassCard>
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
  const state = usePricingCatalog();
  // Plan CTAs deep-link into the managed cloud's Payment Center. Pay-as-you-go
  // credits are a payment-center-only concept — the site shows plans only.
  const ctaHref = getCloudBillingUrl();

  return (
    <div className="py-4">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        {state.status === 'loading' && <SkeletonGrid />}

        {state.status === 'cloud' && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {state.catalog.plans.map((plan) => (
                <PlanCard key={plan.tier} tier={plan.tier} plan={plan} ctaHref={ctaHref} />
              ))}
            </div>
            <SelfHostNote />
          </>
        )}

        {/* Catalog unreachable: only the three numbers per plan are missing, so
            the lineup still renders from the local TIER_ORDER with its price
            block blanked — degrade the field, not the page. */}
        {state.status === 'unavailable' && (
          <>
            <div className="text-center" style={{ marginBottom: 24 }}>
              <p style={{ fontSize: 13, color: 'var(--text-4)' }}>{t('pricing.error')}</p>
              <button
                onClick={state.retry}
                className="mt-1.5"
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'var(--violet-300)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {t('pricing.retry')}
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {TIER_ORDER.map((tier) => (
                <PlanCard key={tier} tier={tier} ctaHref={ctaHref} />
              ))}
            </div>
            <SelfHostNote />
          </>
        )}
      </div>
    </div>
  );
}
