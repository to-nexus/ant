'use client';

import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { Layers, ArrowRight, FileCode2 } from 'lucide-react';
import { PageHero } from '@/components/PageHero';
import { FaqList } from '@/components/FaqList';
import { DOCS_URL } from '@/lib/links';

const ARCHITECTURE_FLOW = [
  'Figma Desktop',
  'MCP',
  'Ant Desktop',
  'WebSocket',
  'ANT',
  '→',
  'Design Docs',
] as const;

interface FaqEntry {
  q: string;
  a: string;
}

export default function FigmaContent() {
  const { t } = useTranslation('site');
  const reads = t('figma.reads', { returnObjects: true }) as string[];
  const faqItems = t('figma.faqItems', { returnObjects: true }) as FaqEntry[];

  const setupSteps = [
    { step: 1, title: t('figma.step1Title'), desc: t('figma.step1Desc'), linkLabel: t('figma.step1Link'), href: 'https://www.figma.com/downloads/' },
    { step: 2, title: t('figma.step2Title'), desc: t('figma.step2Desc'), linkLabel: t('figma.step2Link'), href: '/download' },
    { step: 3, title: t('figma.step3Title'), desc: t('figma.step3Desc'), linkLabel: t('figma.step3Link'), href: DOCS_URL },
  ] as const;

  return (
    <>
      <PageHero
        title={t('figma.heroTitle1')}
        highlight={t('figma.heroTitle2')}
        description={t('figma.heroDesc')}
        accent="purple"
      />

      {/* How it works */}
      <section className="py-16 sm:py-24">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-display font-bold text-white text-center mb-12">
            {t('figma.archTitle')}
          </h2>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-12 flex-wrap">
            {ARCHITECTURE_FLOW.map((item, i) => (
              <div key={i} className="flex items-center gap-3">
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                  <strong className="text-gray-200 font-mono text-xs">{t('figma.gen1Label')}</strong> — {t('figma.gen1Desc')}
                </li>
                <li>
                  <strong className="text-gray-200 font-mono text-xs">{t('figma.gen2Label')}</strong> — {t('figma.gen2Desc')}
                </li>
                <li>
                  <strong className="text-gray-200 font-mono text-xs">{t('figma.gen3Label')}</strong> — {t('figma.gen3Desc')}
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Setup */}
      <section className="py-16 sm:py-24 bg-gradient-to-b from-transparent via-purple-950/5 to-transparent">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-display font-bold text-white text-center mb-12">
            {t('figma.setupTitle')}
          </h2>

          <div className="space-y-5">
            {setupSteps.map((item) => (
              <div key={item.step} className="flex gap-5 p-6 rounded-2xl bg-white/[0.03] border border-white/5">
                <div className="w-10 h-10 shrink-0 rounded-full bg-purple-600 flex items-center justify-center text-white font-bold text-sm">
                  {item.step}
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white mb-2">{item.title}</h3>
                  <p className="text-sm text-gray-400 mb-3 leading-relaxed">{item.desc}</p>
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

      <FaqList title={t('figma.faqTitle')} items={faqItems} />
    </>
  );
}
