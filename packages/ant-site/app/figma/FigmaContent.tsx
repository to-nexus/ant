'use client';

import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { Layers, ArrowRight, FileCode2 } from 'lucide-react';
import { PageHero } from '@/components/PageHero';
import { FaqList } from '@/components/FaqList';
import { GlassCard } from '@/components/aurora/GlassCard';
import { SectionHeading } from '@/components/aurora/SectionHeading';
import { Reveal } from '@/components/aurora/Reveal';
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
          <Reveal>
            <div className="flex justify-center mb-12">
              <SectionHeading title={t('figma.archTitle')} />
            </div>
          </Reveal>

          <Reveal>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-12 flex-wrap">
              {ARCHITECTURE_FLOW.map((item, i) => (
                <div key={i} className="flex items-center gap-3">
                  {item === '→' ? (
                    <ArrowRight className="w-5 h-5 hidden sm:block" style={{ color: 'var(--text-4)' }} />
                  ) : item === 'MCP' || item === 'WebSocket' ? (
                    <span className="text-mono" style={{ fontSize: 11, color: 'var(--text-4)', padding: '4px 10px', border: '1px solid var(--border-1)', borderRadius: 'var(--r-pill)' }}>
                      {item}
                    </span>
                  ) : (
                    <span style={{ padding: '8px 16px', fontSize: 14, fontWeight: 600, color: 'var(--text-1)', background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 'var(--r-md)' }}>
                      {item}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Reveal>
              <GlassCard hoverable padding="lg" style={{ height: '100%' }}>
                <h3 className="flex items-center gap-2" style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-1)', marginBottom: 16 }}>
                  <Layers className="w-4 h-4" style={{ color: 'var(--violet-300)' }} /> {t('figma.readsTitle')}
                </h3>
                <ul className="space-y-2" style={{ fontSize: 14, color: 'var(--text-3)' }}>
                  {reads.map((line, idx) => (
                    <li key={idx}>• {line}</li>
                  ))}
                </ul>
              </GlassCard>
            </Reveal>
            <Reveal delay={0.08}>
              <GlassCard hoverable padding="lg" style={{ height: '100%' }}>
                <h3 className="flex items-center gap-2" style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-1)', marginBottom: 16 }}>
                  <FileCode2 className="w-4 h-4" style={{ color: 'var(--teal-400)' }} /> {t('figma.generatesTitle')}
                </h3>
                <ul className="space-y-3" style={{ fontSize: 14, color: 'var(--text-3)' }}>
                  {[1, 2, 3].map((n) => (
                    <li key={n}>
                      <strong className="text-mono" style={{ color: 'var(--text-2)', fontSize: 12 }}>{t(`figma.gen${n}Label`)}</strong>{' '}
                      — {t(`figma.gen${n}Desc`)}
                    </li>
                  ))}
                </ul>
              </GlassCard>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Setup */}
      <section className="py-16 sm:py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="flex justify-center mb-12">
              <SectionHeading title={t('figma.setupTitle')} />
            </div>
          </Reveal>

          <div className="space-y-5">
            {setupSteps.map((item, i) => (
              <Reveal key={item.step} delay={i * 0.08}>
                <GlassCard hoverable padding="lg">
                  <div className="flex gap-5">
                    <div
                      className="text-display gradient-flow shrink-0 flex items-center justify-center"
                      style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--gradient-aurora)', backgroundSize: '200% 200%', color: 'var(--text-on-brand)', fontWeight: 700, fontSize: 15 }}
                    >
                      {item.step}
                    </div>
                    <div>
                      <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-1)', marginBottom: 8 }}>{item.title}</h3>
                      <p style={{ fontSize: 14, color: 'var(--text-3)', marginBottom: 12, lineHeight: 'var(--lh-relaxed)' }}>{item.desc}</p>
                      {item.href.startsWith('http') ? (
                        <a href={item.href} target="_blank" rel="noopener noreferrer" className="text-sm transition-colors" style={{ color: 'var(--violet-300)' }}>
                          {item.linkLabel}
                        </a>
                      ) : (
                        <Link href={item.href} className="text-sm transition-colors" style={{ color: 'var(--violet-300)' }}>
                          {item.linkLabel}
                        </Link>
                      )}
                    </div>
                  </div>
                </GlassCard>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <FaqList title={t('figma.faqTitle')} items={faqItems} />
    </>
  );
}
