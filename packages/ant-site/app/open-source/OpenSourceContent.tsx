'use client';

import { useTranslation } from 'react-i18next';
import { ArrowRight, Scale, Shield, Heart, Github } from 'lucide-react';
import { PageHero } from '@/components/PageHero';
import { ContributorsWall } from '@/components/ContributorsWall';
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
        accent="emerald"
      />

      {/* License */}
      <section className="py-12 sm:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="p-7 rounded-2xl bg-gradient-to-br from-emerald-950/20 to-teal-950/20 border border-emerald-800/30">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-emerald-950/60 border border-emerald-800/40 text-emerald-300 flex items-center justify-center">
                <Scale className="w-5 h-5" />
              </div>
              <h2 className="text-xl font-display font-bold text-white">{t('openSource.license.title')}</h2>
              <span className="ml-auto px-2 py-0.5 text-[10px] font-mono font-medium text-emerald-300 bg-emerald-950/40 border border-emerald-800/40 rounded">
                {LICENSE_NAME}
              </span>
            </div>
            <p className="text-sm text-gray-300 leading-relaxed mb-5">{t('openSource.license.desc')}</p>
            <a
              href={GITHUB_LICENSE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 hover:border-emerald-500/50 rounded-lg transition-colors"
            >
              {t('openSource.license.viewLicense')}
              <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </section>

      {/* Contribute */}
      <section className="py-16 sm:py-24 bg-gradient-to-b from-transparent via-emerald-950/5 to-transparent">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-display font-bold text-white mb-3">
              {t('openSource.contribute.title')}
            </h2>
            <p className="text-sm text-gray-400">{t('openSource.contribute.desc')}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {STEPS.map((step) => (
              <div key={step.titleKey} className="flex flex-col p-6 rounded-2xl bg-white/[0.03] border border-white/5">
                <h3 className="text-base font-semibold text-white mb-2">{t(`openSource.contribute.${step.titleKey}`)}</h3>
                <p className="text-sm text-gray-400 leading-relaxed mb-5 flex-1">{t(`openSource.contribute.${step.descKey}`)}</p>
                <a
                  href={step.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
                >
                  {t(`openSource.contribute.${step.ctaKey}`)}
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Project policies */}
      <section className="py-16 sm:py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-display font-bold text-white text-center mb-10">
            {t('openSource.policy.title')}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <a
              href={GITHUB_CODE_OF_CONDUCT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group p-6 rounded-2xl bg-white/[0.03] border border-white/5 hover:border-white/15 transition-colors"
            >
              <div className="flex items-center gap-3 mb-3">
                <Heart className="w-5 h-5 text-pink-400" />
                <h3 className="text-base font-semibold text-white">{t('openSource.policy.codeOfConductTitle')}</h3>
              </div>
              <p className="text-sm text-gray-400 leading-relaxed">{t('openSource.policy.codeOfConductDesc')}</p>
              <div className="mt-4 text-sm text-emerald-400 group-hover:text-emerald-300 transition-colors flex items-center gap-1">
                CODE_OF_CONDUCT.md <ArrowRight className="w-3.5 h-3.5" />
              </div>
            </a>
            <a
              href={GITHUB_SECURITY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group p-6 rounded-2xl bg-white/[0.03] border border-white/5 hover:border-white/15 transition-colors"
            >
              <div className="flex items-center gap-3 mb-3">
                <Shield className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-semibold text-white">{t('openSource.policy.securityTitle')}</h3>
              </div>
              <p className="text-sm text-gray-400 leading-relaxed">{t('openSource.policy.securityDesc')}</p>
              <div className="mt-4 text-sm text-emerald-400 group-hover:text-emerald-300 transition-colors flex items-center gap-1">
                SECURITY.md <ArrowRight className="w-3.5 h-3.5" />
              </div>
            </a>
          </div>
        </div>
      </section>

      {/* Contributors */}
      <section className="py-16 sm:py-24 bg-gradient-to-b from-transparent via-emerald-950/5 to-transparent">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-display font-bold text-white text-center mb-10">
            {t('openSource.contributorsTitle')}
          </h2>
          <ContributorsWall
            title="GitHub"
            emptyLabel={t('openSource.contributorsEmpty')}
            limit={60}
          />
        </div>
      </section>

      {/* Sponsors */}
      <section className="py-16 sm:py-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl font-display font-bold text-white mb-4">{t('openSource.sponsorsTitle')}</h2>
          <p className="text-sm text-gray-400 leading-relaxed mb-6">{t('openSource.sponsorsDesc')}</p>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-gray-300 hover:text-white border border-white/10 hover:border-white/20 hover:bg-white/5 rounded-xl transition-all"
          >
            <Github className="w-4 h-4" />
            {GITHUB_URL.replace('https://', '')}
          </a>
        </div>
      </section>
    </>
  );
}
