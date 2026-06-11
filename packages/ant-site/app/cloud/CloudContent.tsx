'use client';

import { useTranslation } from 'react-i18next';
import { ArrowRight, Check, ChevronDown } from 'lucide-react';
import { PageHero } from '@/components/PageHero';
import { FaqList } from '@/components/FaqList';
import { PricingTable } from '@/components/PricingTable';
import { GlassCard } from '@/components/aurora/GlassCard';
import { AuroraButton } from '@/components/aurora/AuroraButton';
import { SectionHeading } from '@/components/aurora/SectionHeading';
import { Reveal } from '@/components/aurora/Reveal';
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
        accent="purple"
      >
        <div className="flex flex-col items-center gap-4">
          <AuroraButton href={appEntryUrl} external size="lg">
            {t('cloud.ctaTry')}
            <ArrowRight className="w-4 h-4" />
          </AuroraButton>
          <p style={{ fontSize: 12, color: 'var(--text-4)' }}>{t('cloud.pricingNote')}</p>
          <a
            href="#pricing"
            className="inline-flex items-center gap-1 text-sm font-medium transition-colors"
            style={{ color: 'var(--violet-300)' }}
          >
            {t('cloud.seePlans')}
            <ChevronDown className="w-4 h-4" />
          </a>
        </div>
      </PageHero>

      {/* What ANT Cloud includes */}
      <section className="py-16 sm:py-24">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="flex justify-center mb-10">
              <SectionHeading title={t('cloud.includesTitle')} />
            </div>
          </Reveal>
          <ul className="space-y-3">
            {includes.map((line, i) => (
              <Reveal key={i} delay={i * 0.05}>
                <li className="flex items-start gap-3" style={{ padding: '16px 18px', borderRadius: 'var(--r-lg)', background: 'var(--bg-surface)', border: '1px solid var(--border-1)' }}>
                  <Check className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--violet-400)' }} />
                  <span style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 'var(--lh-relaxed)' }}>{line}</span>
                </li>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      {/* Plans & credits */}
      <section id="pricing" className="pt-12 sm:pt-16 scroll-mt-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="flex justify-center mb-12">
              <SectionHeading title={t('pricing.sectionTitle')} subtitle={t('pricing.sectionDesc')} />
            </div>
          </Reveal>
        </div>
        <PricingTable />
      </section>

      <FaqList title={t('cloud.faqTitle')} items={faq} />
    </>
  );
}
