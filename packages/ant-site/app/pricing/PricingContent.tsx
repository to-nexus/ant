'use client';

import { useTranslation } from 'react-i18next';
import { Check, Minus, ArrowRight, Mail } from 'lucide-react';

type PlanFeatureKey =
  | 'agents'
  | 'projects'
  | 'figma'
  | 'ide'
  | 'support'
  | 'onprem'
  | 'sso'
  | 'dedicated';

type CellValue = boolean | 'monthlyLimit' | 'unlimited' | 'limited';

const PLAN_ROWS: { featureKey: PlanFeatureKey; free: CellValue; pro: CellValue; enterprise: CellValue }[] = [
  { featureKey: 'agents', free: 'monthlyLimit', pro: 'unlimited', enterprise: 'unlimited' },
  { featureKey: 'projects', free: 'limited', pro: 'unlimited', enterprise: 'unlimited' },
  { featureKey: 'figma', free: true, pro: true, enterprise: true },
  { featureKey: 'ide', free: 'limited', pro: true, enterprise: true },
  { featureKey: 'support', free: false, pro: true, enterprise: true },
  { featureKey: 'onprem', free: false, pro: false, enterprise: true },
  { featureKey: 'sso', free: false, pro: false, enterprise: true },
  { featureKey: 'dedicated', free: false, pro: false, enterprise: true },
];

function FeatureCell({ value }: { value: boolean | string }) {
  if (typeof value === 'string') return <span className="text-sm text-gray-400">{value}</span>;
  return value ? <Check className="w-4 h-4 text-emerald-400" /> : <Minus className="w-4 h-4 text-gray-600" />;
}

function resolveCell(t: (key: string) => string, cell: CellValue): boolean | string {
  if (typeof cell === 'boolean') return cell;
  return t(`pricing.${cell}`);
}

export default function PricingContent() {
  const { t } = useTranslation();
  const betaFeatures = t('pricing.betaFeatures', { returnObjects: true }) as string[];

  const faqItems = [
    { q: t('pricing.faq1Q'), a: t('pricing.faq1A') },
    { q: t('pricing.faq2Q'), a: t('pricing.faq2A') },
    { q: t('pricing.faq3Q'), a: t('pricing.faq3A') },
  ];

  return (
    <>
      {/* Hero */}
      <section className="relative pt-32 pb-16 sm:pt-40 sm:pb-24 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-950/20 via-transparent to-transparent" />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="animate-fade-in-up">
            <h1 className="text-4xl sm:text-5xl font-display font-bold text-white leading-tight mb-6">
              {t('pricing.heroTitle1')}{' '}
              <span className="text-gradient">{t('pricing.heroTitle2')}</span>
              {t('pricing.heroTitle3')}
            </h1>
            <p className="text-lg text-gray-400 max-w-2xl mx-auto leading-relaxed">{t('pricing.heroDesc')}</p>
          </div>
        </div>
      </section>

      {/* Beta Features */}
      <section className="py-16 sm:py-24">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="p-8 rounded-2xl bg-gradient-to-br from-emerald-950/20 to-teal-950/20 border border-emerald-800/20">
            <h2 className="text-xl font-display font-bold text-white mb-6">{t('pricing.betaTitle')}</h2>
            <ul className="space-y-3">
              {Array.isArray(betaFeatures) &&
                betaFeatures.map((feature) => (
                  <li key={feature} className="flex items-center gap-3 text-sm text-gray-300">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    {feature}
                  </li>
                ))}
            </ul>
            <div className="mt-8">
              <a
                href="/app/"
                className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 rounded-xl shadow-lg shadow-emerald-500/25 transition-all"
              >
                {t('pricing.betaCta')}
                <ArrowRight className="w-4 h-4" />
              </a>
              <p className="mt-3 text-xs text-gray-500">{t('pricing.betaNote')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Future Plans */}
      <section className="py-16 sm:py-24 bg-gradient-to-b from-transparent via-emerald-950/5 to-transparent">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-display font-bold text-white mb-4">{t('pricing.futurePlansTitle')}</h2>
            <p className="text-sm text-gray-500">{t('pricing.futurePlansNote')}</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="pb-4 pr-4 text-sm font-semibold text-gray-400 w-1/4" />
                  <th className="pb-4 px-4 text-sm font-semibold text-gray-300 text-center">Free</th>
                  <th className="pb-4 px-4 text-sm font-semibold text-emerald-400 text-center">Pro</th>
                  <th className="pb-4 pl-4 text-sm font-semibold text-gray-300 text-center">Enterprise</th>
                </tr>
              </thead>
              <tbody>
                {PLAN_ROWS.map((row) => (
                  <tr key={row.featureKey} className="border-b border-white/5">
                    <td className="py-3.5 pr-4 text-sm text-gray-300">{t(`pricing.planFeatures.${row.featureKey}`)}</td>
                    <td className="py-3.5 px-4 text-center">
                      <FeatureCell value={resolveCell(t, row.free)} />
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <FeatureCell value={resolveCell(t, row.pro)} />
                    </td>
                    <td className="py-3.5 pl-4 text-center">
                      <FeatureCell value={resolveCell(t, row.enterprise)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Enterprise CTA */}
      <section className="py-16 sm:py-24">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl font-display font-bold text-white mb-4">{t('pricing.enterpriseTitle')}</h2>
          <p className="text-gray-400 mb-8 leading-relaxed">{t('pricing.enterpriseDesc')}</p>
          <a
            href="mailto:probe@to.nexus"
            className="inline-flex items-center gap-2 px-6 py-3 text-sm font-medium text-white border border-white/20 hover:bg-white/5 rounded-xl transition-colors"
          >
            <Mail className="w-4 h-4" />
            {t('pricing.enterpriseCta')}
          </a>
          <p className="mt-4 text-xs text-gray-500">probe@to.nexus</p>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 sm:py-24 bg-gradient-to-b from-transparent via-emerald-950/5 to-transparent">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-display font-bold text-white text-center mb-12">{t('pricing.faqTitle')}</h2>
          <div className="space-y-4">
            {faqItems.map((item, i) => (
              <div key={i} className="p-5 rounded-xl bg-white/[0.03] border border-white/5">
                <h3 className="text-sm font-semibold text-white mb-2">Q: {item.q}</h3>
                <p className="text-sm text-gray-400">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
