'use client';

import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { Layers, ArrowRight, FileCode2 } from 'lucide-react';

const ARCHITECTURE_FLOW = [
  'Figma Desktop',
  'MCP',
  'Ant Desktop',
  'WebSocket',
  'ANT Cloud',
  '→',
  '설계 문서',
] as const;

export default function FigmaContent() {
  const { t } = useTranslation('site');

  const reads = t('figma.reads', { returnObjects: true }) as string[];

  const setupSteps = [
    {
      step: 1,
      title: t('figma.step1Title'),
      desc: t('figma.step1Desc'),
      linkLabel: t('figma.step1Link'),
      href: 'https://www.figma.com/downloads/',
    },
    {
      step: 2,
      title: t('figma.step2Title'),
      desc: t('figma.step2Desc'),
      linkLabel: t('figma.step2Link'),
      href: '/download',
    },
    {
      step: 3,
      title: t('figma.step3Title'),
      desc: t('figma.step3Desc'),
      linkLabel: t('figma.step3Link'),
      href: '/app/',
    },
  ] as const;

  const faqItems = [
    { q: t('figma.faq1Q'), a: t('figma.faq1A') },
    { q: t('figma.faq2Q'), a: t('figma.faq2A') },
    { q: t('figma.faq3Q'), a: t('figma.faq3A') },
  ];

  return (
    <>
      <section className="relative pt-32 pb-16 sm:pt-40 sm:pb-24 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-purple-950/20 via-transparent to-transparent" />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="animate-fade-in-up">
            <h1 className="text-4xl sm:text-5xl font-display font-bold text-white leading-tight mb-6">
              {t('figma.heroTitle1')}{' '}
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-fuchsia-300">
                {t('figma.heroTitle2')}
              </span>
            </h1>
            <p className="text-lg text-gray-400 max-w-2xl mx-auto leading-relaxed">{t('figma.heroDesc')}</p>
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-24">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-display font-bold text-white text-center mb-12">
            {t('figma.archTitle')}
          </h2>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
            {ARCHITECTURE_FLOW.map((item, i) => (
              <div key={i} className="flex items-center gap-4">
                {item === '→' ? (
                  <ArrowRight className="w-5 h-5 text-gray-500 hidden sm:block" />
                ) : item === 'MCP' || item === 'WebSocket' ? (
                  <span className="text-xs text-gray-500 px-2 py-1 border border-white/10 rounded-full">{item}</span>
                ) : (
                  <span className="px-4 py-2 text-sm font-medium text-white bg-white/5 border border-white/10 rounded-lg">
                    {item}
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/5">
              <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
                <Layers className="w-4 h-4 text-purple-400" /> {t('figma.readsTitle')}
              </h3>
              <ul className="space-y-2 text-sm text-gray-400">
                {reads.map((line, idx) => (
                  <li key={idx}>• {line}</li>
                ))}
              </ul>
            </div>
            <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/5">
              <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
                <FileCode2 className="w-4 h-4 text-emerald-400" /> {t('figma.generatesTitle')}
              </h3>
              <ul className="space-y-3 text-sm text-gray-400">
                <li>
                  <strong className="text-gray-200">{t('figma.gen1Label')}</strong> — {t('figma.gen1Desc')}
                </li>
                <li>
                  <strong className="text-gray-200">{t('figma.gen2Label')}</strong> — {t('figma.gen2Desc')}
                </li>
                <li>
                  <strong className="text-gray-200">{t('figma.gen3Label')}</strong> — {t('figma.gen3Desc')}
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-24 bg-gradient-to-b from-transparent via-purple-950/5 to-transparent">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-display font-bold text-white text-center mb-12">
            {t('figma.setupTitle')}
          </h2>

          <div className="space-y-6">
            {setupSteps.map((item) => (
              <div key={item.step} className="flex gap-5 p-6 rounded-2xl bg-white/[0.03] border border-white/5">
                <div className="w-10 h-10 shrink-0 rounded-full bg-purple-600 flex items-center justify-center text-white font-bold text-sm">
                  {item.step}
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white mb-2">{item.title}</h3>
                  <p className="text-sm text-gray-400 mb-3">{item.desc}</p>
                  {item.href.startsWith('http') ? (
                    <a
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
                    >
                      {item.linkLabel}
                    </a>
                  ) : (
                    <Link href={item.href} className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors">
                      {item.linkLabel}
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-24">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-display font-bold text-white text-center mb-12">{t('figma.faqTitle')}</h2>
          <div className="space-y-4">
            {faqItems.map((item, i) => (
              <div key={i} className="p-5 rounded-xl bg-white/[0.03] border border-white/5">
                <h3 className="text-sm font-semibold text-white mb-2">
                  Q: {item.q}
                </h3>
                <p className="text-sm text-gray-400">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
