'use client';

import { useTranslation } from 'react-i18next';
import { Monitor, Server, Layers, FolderGit2, BookOpen } from 'lucide-react';
import { PageHero } from '@/components/PageHero';
import { GlassCard } from '@/components/aurora/GlassCard';
import { SectionHeading } from '@/components/aurora/SectionHeading';
import { IconOrb } from '@/components/aurora/IconOrb';
import { Reveal } from '@/components/aurora/Reveal';
import type { IconOrbTone } from '@/components/aurora/IconOrb';

const LANGUAGES: { name: string; descKey: string; tier: 'supported' | 'planned' }[] = [
  { name: 'TypeScript / JavaScript', descKey: 'langTs', tier: 'supported' },
  { name: 'Go', descKey: 'langGo', tier: 'supported' },
  { name: 'Python', descKey: 'langPy', tier: 'planned' },
  { name: 'Java / Kotlin', descKey: 'langJava', tier: 'planned' },
  { name: 'Rust', descKey: 'langRust', tier: 'planned' },
];

const SUPPORTED_FRAMEWORKS: Record<string, string[]> = {
  Frontend: ['Next.js', 'Nuxt', 'SvelteKit', 'Angular', 'Vite + React/Vue'],
  Backend: ['Express', 'NestJS', 'Gin'],
  'CSS / UI': ['Tailwind CSS', 'CSS Modules', 'styled-components'],
};

const PLANNED_FRAMEWORKS: Record<string, string[]> = {
  Python: ['FastAPI', 'Django', 'Flask'],
  'Java / Kotlin': ['Spring Boot'],
  Rust: ['Axum', 'Actix'],
};

const PROJECT_TYPES: {
  Icon: typeof Monitor;
  title: string;
  descKey: 'frontendDesc' | 'backendDesc' | 'fullstackDesc' | 'monorepoDesc';
  tone: IconOrbTone;
}[] = [
  { Icon: Monitor, title: 'Frontend', descKey: 'frontendDesc', tone: 'violet' },
  { Icon: Server, title: 'Backend', descKey: 'backendDesc', tone: 'pink' },
  { Icon: Layers, title: 'Fullstack', descKey: 'fullstackDesc', tone: 'orange' },
  { Icon: FolderGit2, title: 'Monorepo', descKey: 'monorepoDesc', tone: 'teal' },
];

function Tag({ children, muted }: { children: string; muted?: boolean }) {
  return (
    <span
      style={{
        padding: '6px 12px',
        fontSize: 12,
        fontWeight: 500,
        color: muted ? 'var(--text-4)' : 'var(--text-2)',
        background: 'var(--bg-surface-2)',
        border: '1px solid var(--border-1)',
        borderRadius: 'var(--r-pill)',
      }}
    >
      {children}
    </span>
  );
}

export default function CapabilitiesContent() {
  const { t } = useTranslation('site');
  const supported = LANGUAGES.filter((l) => l.tier === 'supported');
  const planned = LANGUAGES.filter((l) => l.tier === 'planned');

  return (
    <>
      <PageHero
        title={t('capabilities.heroTitle1')}
        highlight={t('capabilities.heroTitle2')}
        description={t('capabilities.heroDesc')}
        accent="blue"
      />

      {/* Project Types */}
      <section className="py-16 sm:py-24">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="flex justify-center mb-12">
              <SectionHeading title={t('capabilities.projectTypesTitle')} />
            </div>
          </Reveal>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {PROJECT_TYPES.map((item, i) => (
              <Reveal key={item.title} delay={(i % 4) * 0.06}>
                <GlassCard hoverable padding="md" style={{ height: '100%' }}>
                  <IconOrb tone={item.tone} size={40} style={{ marginBottom: 14 }}>
                    <item.Icon className="w-5 h-5" />
                  </IconOrb>
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', marginBottom: 4 }}>{item.title}</h3>
                  <p style={{ fontSize: 12, color: 'var(--text-3)' }}>{t(`capabilities.${item.descKey}`)}</p>
                </GlassCard>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Languages */}
      <section className="py-16 sm:py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="flex justify-center mb-12">
              <SectionHeading title={t('capabilities.langTitle')} />
            </div>
          </Reveal>

          <h3 className="text-mono" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--violet-300)', marginBottom: 12 }}>
            {t('capabilities.supportedLabel')}
          </h3>
          <div className="space-y-3 mb-8">
            {supported.map((lang) => (
              <Reveal key={lang.name}>
                <GlassCard padding="md">
                  <div className="flex items-start gap-4">
                    <span aria-hidden className="shrink-0" style={{ marginTop: 6, width: 8, height: 8, borderRadius: '50%', background: 'var(--violet-400)' }} />
                    <div>
                      <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>{lang.name}</h4>
                      <p style={{ fontSize: 14, color: 'var(--text-3)', marginTop: 4 }}>{t(`capabilities.${lang.descKey}`)}</p>
                    </div>
                  </div>
                </GlassCard>
              </Reveal>
            ))}
          </div>

          <h3 className="text-mono" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-4)', marginBottom: 12 }}>
            {t('capabilities.plannedLabel')}
          </h3>
          <div className="space-y-3">
            {planned.map((lang) => (
              <Reveal key={lang.name}>
                <GlassCard padding="md" style={{ opacity: 0.85 }}>
                  <div className="flex items-start gap-4">
                    <span aria-hidden className="shrink-0" style={{ marginTop: 6, width: 8, height: 8, borderRadius: '50%', background: 'var(--border-3)' }} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)' }}>{lang.name}</h4>
                        <span className="text-mono" style={{ padding: '2px 8px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)', background: 'var(--bg-surface-2)', border: '1px solid var(--border-1)', borderRadius: 'var(--r-pill)' }}>
                          {t('capabilities.plannedLabel')}
                        </span>
                      </div>
                      <p style={{ fontSize: 14, color: 'var(--text-4)', marginTop: 4 }}>{t(`capabilities.${lang.descKey}`)}</p>
                    </div>
                  </div>
                </GlassCard>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Frameworks */}
      <section className="py-16 sm:py-24">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="flex justify-center mb-12">
              <SectionHeading title={t('capabilities.frameworkTitle')} />
            </div>
          </Reveal>

          <h3 className="text-mono" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--violet-300)', marginBottom: 16 }}>
            {t('capabilities.frameworkSupported')}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
            {Object.entries(SUPPORTED_FRAMEWORKS).map(([category, items]) => (
              <Reveal key={category}>
                <GlassCard padding="lg" style={{ height: '100%' }}>
                  <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)', marginBottom: 16 }}>{category}</h4>
                  <div className="flex flex-wrap gap-2">
                    {items.map((item) => (
                      <Tag key={item}>{item}</Tag>
                    ))}
                  </div>
                </GlassCard>
              </Reveal>
            ))}
          </div>

          <h3 className="text-mono" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-4)', marginBottom: 16 }}>
            {t('capabilities.frameworkPlanned')}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {Object.entries(PLANNED_FRAMEWORKS).map(([category, items]) => (
              <Reveal key={category}>
                <GlassCard padding="lg" style={{ height: '100%', opacity: 0.85 }}>
                  <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-3)', marginBottom: 16 }}>{category}</h4>
                  <div className="flex flex-wrap gap-2">
                    {items.map((item) => (
                      <Tag key={item} muted>{item}</Tag>
                    ))}
                  </div>
                </GlassCard>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 sm:py-24">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <Reveal>
            <div className="flex justify-center mb-5">
              <IconOrb tone="teal" size={52}>
                <BookOpen className="w-6 h-6" />
              </IconOrb>
            </div>
            <h2 className="text-display" style={{ fontSize: 26, color: 'var(--text-1)', marginBottom: 14 }}>{t('capabilities.howTitle')}</h2>
            <p style={{ color: 'var(--text-3)', lineHeight: 'var(--lh-relaxed)', marginBottom: 24 }}>{t('capabilities.howDesc')}</p>
            <div className="inline-flex items-center gap-3" style={{ fontSize: 14 }}>
              {['Learn', 'Design', 'Code'].map((s, i) => (
                <span key={s} className="flex items-center gap-3">
                  <span style={{ padding: '6px 12px', background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 'var(--r-md)', color: 'var(--text-2)' }}>{s}</span>
                  {i < 2 && <span style={{ color: 'var(--text-4)' }}>→</span>}
                </span>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* Honest Note */}
      <section className="py-12 sm:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <GlassCard padding="lg" style={{ borderColor: 'var(--border-brand)' }}>
              <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 'var(--lh-relaxed)' }}>
                <strong style={{ color: 'var(--violet-300)' }}>{t('capabilities.noteLabel')}</strong> {t('capabilities.note')}
              </p>
            </GlassCard>
          </Reveal>
        </div>
      </section>
    </>
  );
}
