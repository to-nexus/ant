'use client';

import { useTranslation } from 'react-i18next';
import { ArrowRight, Check, Server, Cloud, Boxes } from 'lucide-react';
import { PageHero } from '@/components/PageHero';
import { FaqList } from '@/components/FaqList';
import { useAuthSession, getAppEntryUrl } from '@/lib/AuthSessionProvider';
import { GITHUB_URL } from '@/lib/links';

const CLOUD_MODE_INSTALL_DOC = `${GITHUB_URL}/blob/main/docs/cloud-mode/install.md`;

interface TradeoffColumn {
  title: string;
  bullets: string[];
}

interface FaqEntry {
  q: string;
  a: string;
}

export default function CloudContent() {
  const { t } = useTranslation('site');
  const { user } = useAuthSession();
  const appEntryUrl = getAppEntryUrl(user);

  const selfHost = t('cloud.tradeoffSelfHost', { returnObjects: true }) as TradeoffColumn;
  const cloud = t('cloud.tradeoffCloud', { returnObjects: true }) as TradeoffColumn;
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
          <p className="text-xs text-gray-500">{t('cloud.earlyAccessNote')}</p>
        </div>
      </PageHero>

      {/* Trade-off */}
      <section className="py-16 sm:py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-display font-bold text-white mb-3">{t('cloud.tradeoffTitle')}</h2>
            <p className="text-sm text-gray-400">{t('cloud.tradeoffDesc')}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-7 rounded-2xl bg-white/[0.03] border border-white/10">
              <div className="w-11 h-11 rounded-xl bg-emerald-950/40 border border-emerald-800/40 text-emerald-300 flex items-center justify-center mb-4">
                <Server className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-3">{selfHost.title}</h3>
              <ul className="space-y-2 text-sm text-gray-400">
                {selfHost.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="shrink-0 mt-1.5 w-1 h-1 rounded-full bg-gray-600" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="p-7 rounded-2xl bg-gradient-to-br from-teal-950/20 to-cyan-950/20 border border-teal-800/30">
              <div className="w-11 h-11 rounded-xl bg-teal-950/40 border border-teal-800/40 text-teal-300 flex items-center justify-center mb-4">
                <Cloud className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-3">{cloud.title}</h3>
              <ul className="space-y-2 text-sm text-gray-300">
                {cloud.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="shrink-0 mt-1.5 w-1 h-1 rounded-full bg-teal-400" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Includes */}
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

      {/* Persona C — self-host the cloud build */}
      <section className="py-16 sm:py-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="p-7 rounded-2xl bg-white/[0.03] border border-white/5">
            <div className="flex items-center gap-3 mb-4">
              <Boxes className="w-5 h-5 text-purple-400" />
              <h2 className="text-xl font-display font-bold text-white">{t('cloud.selfHostCloudTitle')}</h2>
            </div>
            <p className="text-sm text-gray-400 leading-relaxed mb-5">{t('cloud.selfHostCloudDesc')}</p>
            <a
              href={CLOUD_MODE_INSTALL_DOC}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 hover:border-purple-500/50 rounded-xl transition-colors"
            >
              {t('cloud.selfHostCloudCta')}
              <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </section>

      <FaqList title={t('cloud.faqTitle')} items={faq} />
    </>
  );
}
