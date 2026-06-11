'use client';

import { useTranslation } from 'react-i18next';
import { ArrowRight, Check, ChevronDown } from 'lucide-react';
import { PageHero } from '@/components/PageHero';
import { FaqList } from '@/components/FaqList';
import { PricingTable } from '@/components/PricingTable';
import { useAuthSession, getAppEntryUrl } from '@/lib/AuthSessionProvider';

interface FaqEntry {
  q: string;
  a: string;
}

export default function CloudContent() {
  const { t } = useTranslation('site');
  const { user } = useAuthSession();
  const appEntryUrl = getAppEntryUrl(user);

  const includes = t('cloud.includes', { returnObjects: true }) as string[];
  const faq = t('cloud.faq', { returnObjects: true }) as FaqEntry[];

  return (
    <>
      <PageHero
        title={t('cloud.heroTitle1')}
        highlight={t('cloud.heroTitle2')}
        description={t('cloud.heroDesc')}
        accent="teal"
      >
        <div className="flex flex-col items-center gap-3">
          <a
            href={appEntryUrl}
            className="group inline-flex items-center gap-2 px-6 py-3 text-base font-semibold text-white bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700 rounded-xl shadow-lg shadow-teal-500/25 transition-all"
          >
            {t('cloud.ctaTry')}
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </a>
          <p className="text-xs text-gray-500">{t('cloud.pricingNote')}</p>
          <a
            href="#pricing"
            className="inline-flex items-center gap-1 text-sm font-medium text-teal-300 hover:text-teal-200 transition-colors"
          >
            {t('cloud.seePlans')}
            <ChevronDown className="w-4 h-4" />
          </a>
        </div>
      </PageHero>

      {/* What ANT Cloud includes */}
      <section className="py-16 sm:py-24 bg-gradient-to-b from-transparent via-teal-950/5 to-transparent">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-display font-bold text-white text-center mb-10">
            {t('cloud.includesTitle')}
          </h2>
          <ul className="space-y-3">
            {includes.map((line, i) => (
              <li key={i} className="flex items-start gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/5">
                <Check className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
                <span className="text-sm text-gray-300 leading-relaxed">{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Plans & credits */}
      <section id="pricing" className="pt-16 sm:pt-20 scroll-mt-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl sm:text-3xl font-display font-bold text-white mb-3">
            {t('pricing.sectionTitle')}
          </h2>
          <p className="text-sm text-gray-400 max-w-2xl mx-auto">{t('pricing.sectionDesc')}</p>
        </div>
        <PricingTable />
      </section>

      <FaqList title={t('cloud.faqTitle')} items={faq} />
    </>
  );
}
