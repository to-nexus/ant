'use client';

import { useTranslation } from 'react-i18next';
import { Database, Cpu, Radio, Eye, Server, KeyRound, Monitor, ArrowRight } from 'lucide-react';
import { PageHero } from '@/components/PageHero';
import { QuickstartTabs } from '@/components/QuickstartTabs';
import { GlassCard } from '@/components/aurora/GlassCard';
import { AuroraButton } from '@/components/aurora/AuroraButton';
import { SectionHeading } from '@/components/aurora/SectionHeading';
import { IconOrb } from '@/components/aurora/IconOrb';
import { Reveal } from '@/components/aurora/Reveal';
import type { IconOrbTone } from '@/components/aurora/IconOrb';
import { GITHUB_URL } from '@/lib/links';

interface EnvVar {
  name: string;
  default: string;
  desc: string;
}

const PROCESS_ICONS: { key: string; Icon: typeof Server; tone: IconOrbTone }[] = [
  { key: 'api', Icon: Server, tone: 'violet' },
  { key: 'worker', Icon: Cpu, tone: 'pink' },
  { key: 'realtime', Icon: Radio, tone: 'orange' },
  { key: 'preview', Icon: Eye, tone: 'teal' },
];

const LOCAL_MODE_INSTALL_DOC = `${GITHUB_URL}/blob/main/docs/local-mode/install.md`;

export default function SelfHostContent() {
  const { t } = useTranslation('site');

  const envVars = t('selfHost.env', { returnObjects: true }) as EnvVar[];
  const llmKeys = t('selfHost.llmKeys', { returnObjects: true }) as string[];

  return (
    <>
      <PageHero
        title={t('selfHost.heroTitle')}
        highlight={t('selfHost.heroHighlight')}
        description={t('selfHost.heroDesc')}
        accent="purple"
      />

      <section className="pb-4">
        <Reveal>
          <QuickstartTabs title="" />
        </Reveal>
      </section>

      {/* Processes */}
      <section className="py-16 sm:py-24">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="flex justify-center mb-10">
              <SectionHeading title={t('selfHost.infraTitle')} subtitle={t('selfHost.infraDesc')} />
            </div>
          </Reveal>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            {PROCESS_ICONS.map(({ key, Icon, tone }, i) => (
              <Reveal key={key} delay={(i % 2) * 0.08}>
                <GlassCard hoverable padding="md">
                  <div className="flex items-start gap-4">
                    <IconOrb tone={tone} size={40}>
                      <Icon className="w-5 h-5" />
                    </IconOrb>
                    <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 'var(--lh-relaxed)', paddingTop: 6 }}>
                      {t(`selfHost.process.${key}`)}
                    </p>
                  </div>
                </GlassCard>
              </Reveal>
            ))}
          </div>

          <Reveal>
            <GlassCard padding="lg">
              <h3 className="flex items-center gap-2" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)', marginBottom: 16 }}>
                <Database className="w-4 h-4" style={{ color: 'var(--teal-400)' }} />
                {t('selfHost.infraDeps.title')}
              </h3>
              <ul className="space-y-2" style={{ fontSize: 14, color: 'var(--text-3)' }}>
                <li>• {t('selfHost.infraDeps.redis')}</li>
                <li>• {t('selfHost.infraDeps.chroma')}</li>
              </ul>
            </GlassCard>
          </Reveal>
        </div>
      </section>

      {/* Env vars */}
      <section className="py-16 sm:py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="flex justify-center mb-10">
              <SectionHeading title={t('selfHost.envTitle')} subtitle={t('selfHost.envDesc')} />
            </div>
          </Reveal>

          <Reveal>
            <div style={{ overflowX: 'auto', borderRadius: 'var(--r-2xl)', border: '1px solid var(--border-1)' }}>
              <table className="w-full text-left" style={{ fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-1)' }}>
                    {['name', 'default', 'desc'].map((h) => (
                      <th
                        key={h}
                        className="text-mono"
                        style={{ padding: '12px 16px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-4)' }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {envVars.map((v) => (
                    <tr key={v.name} style={{ borderBottom: '1px solid var(--border-1)' }}>
                      <td className="text-mono" style={{ padding: '12px 16px', fontSize: 12, color: 'var(--violet-300)' }}>{v.name}</td>
                      <td className="text-mono" style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-3)' }}>{v.default}</td>
                      <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-3)' }}>{v.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Reveal>
        </div>
      </section>

      {/* LLM key */}
      <section className="py-12 sm:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <GlassCard padding="lg">
              <div className="flex items-center gap-3 mb-4">
                <KeyRound className="w-5 h-5" style={{ color: 'var(--amber-500)' }} />
                <h2 className="text-display" style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)' }}>{t('selfHost.llmTitle')}</h2>
              </div>
              <p style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 'var(--lh-relaxed)', marginBottom: 20 }}>{t('selfHost.llmDesc')}</p>
              <ul className="space-y-2">
                {llmKeys.map((k) => (
                  <li key={k} className="text-mono" style={{ fontSize: 13, color: 'var(--violet-300)' }}>{k}</li>
                ))}
              </ul>
            </GlassCard>
          </Reveal>
        </div>
      </section>

      {/* Local-mode UI surface */}
      <section className="py-12 sm:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <GlassCard padding="lg">
              <div className="flex items-center gap-3 mb-4">
                <Monitor className="w-5 h-5" style={{ color: 'var(--violet-300)' }} />
                <h2 className="text-display" style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)' }}>{t('selfHost.uiTitle')}</h2>
              </div>
              <p style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 'var(--lh-relaxed)' }}>{t('selfHost.uiDesc')}</p>
            </GlassCard>
          </Reveal>
        </div>
      </section>

      {/* Next steps */}
      <section className="py-16 sm:py-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <Reveal>
            <h2 className="text-display" style={{ fontSize: 26, color: 'var(--text-1)', marginBottom: 14 }}>{t('selfHost.nextStepsTitle')}</h2>
            <p style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 'var(--lh-relaxed)', marginBottom: 28, maxWidth: 520, marginLeft: 'auto', marginRight: 'auto' }}>
              {t('selfHost.nextStepsDesc')}
            </p>
            <AuroraButton href={LOCAL_MODE_INSTALL_DOC} external variant="secondary">
              {t('selfHost.nextStepsCta')}
              <ArrowRight className="w-4 h-4" />
            </AuroraButton>
          </Reveal>
        </div>
      </section>
    </>
  );
}
