'use client';

import { useTranslation } from 'react-i18next';
import { ArrowRight, Check, Server } from 'lucide-react';
import type { PlanInfo, CreditPackageInfo } from '@ant/shared';
import { usePricingCatalog } from '@/lib/usePricingCatalog';
import { useAuthSession, getAppEntryUrl } from '@/lib/AuthSessionProvider';
import { CLOUD_SITE_URL } from '@/lib/links';

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

  const priceLabel =
    plan.monthlyPriceUsd === 0
      ? t('pricing.freePrice')
      : `$${plan.monthlyPriceUsd}`;
  const creditsLabel = t('pricing.creditsPerMonth', {
    credits: plan.includedCreditsMonthly.toLocaleString(),
  });

  return (
    <div
      className={`relative flex flex-col p-7 rounded-2xl border ${
        popular
          ? 'bg-gradient-to-br from-teal-950/30 to-cyan-950/20 border-teal-700/40'
          : 'bg-white/[0.03] border-white/10'
      }`}
    >
      {popular && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-teal-200 bg-teal-900/70 border border-teal-700/50 rounded-full">
          {t('pricing.popular')}
        </span>
      )}
      <h3 className="text-lg font-semibold text-white mb-1">{name}</h3>
      {tagline && <p className="text-sm text-gray-400 mb-5">{tagline}</p>}
      <div className="flex items-baseline gap-1.5 mb-1">
        <span className="text-3xl font-display font-bold text-white">{priceLabel}</span>
        {plan.monthlyPriceUsd > 0 && (
          <span className="text-sm text-gray-500">{t('pricing.perMonth')}</span>
        )}
      </div>
      <p className="text-sm text-teal-300/90 mb-6">{creditsLabel}</p>
      <ul className="space-y-2.5 text-sm text-gray-300 mb-7 grow">
        {bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <Check className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <a
        href={ctaHref}
        className={`group inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-xl transition-all ${
          popular
            ? 'text-white bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700 shadow-lg shadow-teal-500/25'
            : 'text-white bg-white/10 hover:bg-white/15 border border-white/10'
        }`}
      >
        {t('pricing.cta')}
        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
      </a>
    </div>
  );
}

function TopUpStrip({ packages }: { packages: CreditPackageInfo[] }) {
  const { t } = useTranslation('site');
  if (packages.length === 0) return null;
  return (
    <div className="mt-12">
      <div className="text-center mb-6">
        <h3 className="text-lg font-semibold text-white">{t('pricing.topUpTitle')}</h3>
        <p className="text-sm text-gray-400">{t('pricing.topUpDesc')}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto">
        {packages.map((pkg) => (
          <div
            key={pkg.id}
            className="flex items-center justify-between p-4 rounded-xl bg-white/[0.03] border border-white/10"
          >
            <span className="text-sm text-gray-300">
              {t('pricing.packageCredits', { credits: pkg.credits.toLocaleString() })}
            </span>
            <span className="text-base font-semibold text-white">${pkg.priceUsd}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SelfHostFallback() {
  const { t } = useTranslation('site');
  return (
    <div className="max-w-xl mx-auto p-8 rounded-2xl bg-white/[0.03] border border-white/10 text-center">
      <div className="w-11 h-11 mx-auto rounded-xl bg-emerald-950/40 border border-emerald-800/40 text-emerald-300 flex items-center justify-center mb-4">
        <Server className="w-5 h-5" />
      </div>
      <h3 className="text-lg font-semibold text-white mb-2">{t('pricing.selfHost.title')}</h3>
      <p className="text-sm text-gray-400 leading-relaxed mb-6">{t('pricing.selfHost.desc')}</p>
      <a
        href={`${CLOUD_SITE_URL}/cloud#pricing`}
        className="group inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-teal-300 bg-teal-500/10 hover:bg-teal-500/20 border border-teal-500/30 rounded-xl transition-colors"
      >
        {t('pricing.selfHost.cloudLinkLabel')}
        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
      </a>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-[420px] rounded-2xl bg-white/[0.03] border border-white/10 animate-pulse"
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
    <section className="py-12 sm:py-16">
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
          </>
        )}

        {state.status === 'self-host' && <SelfHostFallback />}

        {state.status === 'error' && (
          <div className="max-w-md mx-auto text-center">
            <p className="text-sm text-gray-400 mb-4">{t('pricing.error')}</p>
            <button
              onClick={state.retry}
              className="px-5 py-2.5 text-sm font-semibold text-white bg-white/10 hover:bg-white/15 border border-white/10 rounded-xl transition-colors"
            >
              {t('pricing.retry')}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
