'use client';

import { useTranslation } from 'react-i18next';
import { ArrowRight, Scale, Shield, Heart, Github } from 'lucide-react';
import { PageHero } from '@/components/PageHero';
import { ContributorsWall } from '@/components/ContributorsWall';
import { GlassCard } from '@/components/aurora/GlassCard';
import { AuroraButton } from '@/components/aurora/AuroraButton';
import { SectionHeading } from '@/components/aurora/SectionHeading';
import { IconOrb } from '@/components/aurora/IconOrb';
import { Reveal } from '@/components/aurora/Reveal';
import {
  GITHUB_LICENSE_URL,
  GITHUB_CONTRIBUTING_URL,
  GITHUB_CODE_OF_CONDUCT_URL,
  GITHUB_SECURITY_URL,
  GITHUB_GOOD_FIRST_ISSUES_URL,
  GITHUB_URL,
  LICENSE_NAME,
} from '@/lib/links';

interface ContribStep {
  titleKey: string;
  descKey: string;
  ctaKey: string;
  href: string;
}

const STEPS: ContribStep[] = [
  { titleKey: 'step1Title', descKey: 'step1Desc', ctaKey: 'step1Cta', href: GITHUB_GOOD_FIRST_ISSUES_URL },
  { titleKey: 'step2Title', descKey: 'step2Desc', ctaKey: 'step2Cta', href: GITHUB_CONTRIBUTING_URL },
  { titleKey: 'step3Title', descKey: 'step3Desc', ctaKey: 'step3Cta', href: `${GITHUB_URL}/pulls` },
];

export default function OpenSourceContent() {
  const { t } = useTranslation('site');

  return (
    <>
      <PageHero
        title={t('openSource.heroTitle')}
        highlight={t('openSource.heroHighlight')}
        description={t('openSource.heroDesc')}
        accent="purple"
      />

      {/* License */}
      <section className="py-12 sm:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <GlassCard glow padding="lg" gradient="none" style={{ border: '1px solid var(--border-brand)' }}>
              <div className="flex items-center gap-3 mb-4">
                <IconOrb tone="violet" size={40}>
                  <Scale className="w-5 h-5" />
                </IconOrb>
                <h2 className="text-display" style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)' }}>{t('openSource.license.title')}</h2>
                <span className="text-mono ml-auto" style={{ padding: '2px 8px', fontSize: 10, color: 'var(--violet-300)', background: 'oklch(26% 0.09 290)', border: '1px solid oklch(40% 0.10 290 / 0.6)', borderRadius: 'var(--r-sm)' }}>
                  {LICENSE_NAME}
                </span>
              </div>
              <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 'var(--lh-relaxed)', marginBottom: 20 }}>{t('openSource.license.desc')}</p>
              <AuroraButton href={GITHUB_LICENSE_URL} external variant="secondary" size="sm">
                {t('openSource.license.viewLicense')}
                <ArrowRight className="w-4 h-4" />
              </AuroraButton>
            </GlassCard>
          </Reveal>
        </div>
      </section>

      {/* Contribute */}
      <section className="py-16 sm:py-24">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="flex justify-center mb-12">
              <SectionHeading title={t('openSource.contribute.title')} subtitle={t('openSource.contribute.desc')} />
            </div>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {STEPS.map((step, i) => (
              <Reveal key={step.titleKey} delay={i * 0.08}>
                <GlassCard hoverable padding="lg" style={{ height: '100%' }}>
                  <div className="flex flex-col h-full">
                    <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-1)', marginBottom: 8 }}>
                      {t(`openSource.contribute.${step.titleKey}`)}
                    </h3>
                    <p style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 'var(--lh-relaxed)', marginBottom: 20, flex: 1 }}>
                      {t(`openSource.contribute.${step.descKey}`)}
                    </p>
                    <a href={step.href} target="_blank" rel="noopener noreferrer" className="transition-colors" style={{ fontSize: 14, color: 'var(--violet-300)' }}>
                      {t(`openSource.contribute.${step.ctaKey}`)}
                    </a>
                  </div>
                </GlassCard>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Project policies */}
      <section className="py-16 sm:py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="flex justify-center mb-10">
              <SectionHeading title={t('openSource.policy.title')} />
            </div>
          </Reveal>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Reveal>
              <a href={GITHUB_CODE_OF_CONDUCT_URL} target="_blank" rel="noopener noreferrer" className="block group" style={{ height: '100%' }}>
                <GlassCard hoverable padding="lg" style={{ height: '100%' }}>
                  <div className="flex items-center gap-3 mb-3">
                    <Heart className="w-5 h-5" style={{ color: 'var(--pink-400)' }} />
                    <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-1)' }}>{t('openSource.policy.codeOfConductTitle')}</h3>
                  </div>
                  <p style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 'var(--lh-relaxed)' }}>{t('openSource.policy.codeOfConductDesc')}</p>
                  <div className="text-mono mt-4 flex items-center gap-1" style={{ fontSize: 13, color: 'var(--violet-300)' }}>
                    CODE_OF_CONDUCT.md <ArrowRight className="w-3.5 h-3.5" />
                  </div>
                </GlassCard>
              </a>
            </Reveal>
            <Reveal delay={0.08}>
              <a href={GITHUB_SECURITY_URL} target="_blank" rel="noopener noreferrer" className="block group" style={{ height: '100%' }}>
                <GlassCard hoverable padding="lg" style={{ height: '100%' }}>
                  <div className="flex items-center gap-3 mb-3">
                    <Shield className="w-5 h-5" style={{ color: 'var(--amber-500)' }} />
                    <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-1)' }}>{t('openSource.policy.securityTitle')}</h3>
                  </div>
                  <p style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 'var(--lh-relaxed)' }}>{t('openSource.policy.securityDesc')}</p>
                  <div className="text-mono mt-4 flex items-center gap-1" style={{ fontSize: 13, color: 'var(--violet-300)' }}>
                    SECURITY.md <ArrowRight className="w-3.5 h-3.5" />
                  </div>
                </GlassCard>
              </a>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Contributors */}
      <section className="py-16 sm:py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="flex justify-center mb-10">
              <SectionHeading title={t('openSource.contributorsTitle')} />
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <GlassCard padding="lg">
              <ContributorsWall title="GitHub" emptyLabel={t('openSource.contributorsEmpty')} limit={60} />
            </GlassCard>
          </Reveal>
        </div>
      </section>

      {/* Sponsors */}
      <section className="py-16 sm:py-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <Reveal>
            <h2 className="text-display" style={{ fontSize: 26, color: 'var(--text-1)', marginBottom: 14 }}>{t('openSource.sponsorsTitle')}</h2>
            <p style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 'var(--lh-relaxed)', marginBottom: 24 }}>{t('openSource.sponsorsDesc')}</p>
            <AuroraButton href={GITHUB_URL} external variant="secondary">
              <Github className="w-4 h-4" />
              {GITHUB_URL.replace('https://', '')}
            </AuroraButton>
          </Reveal>
        </div>
      </section>
    </>
  );
}
