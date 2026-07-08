'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Box, Monitor, Activity, Shield, Download } from 'lucide-react';
import { PageHero } from '@/components/PageHero';
import { GlassCard } from '@/components/aurora/GlassCard';
import { SectionHeading } from '@/components/aurora/SectionHeading';
import { IconOrb } from '@/components/aurora/IconOrb';
import { Reveal } from '@/components/aurora/Reveal';
import type { IconOrbTone } from '@/components/aurora/IconOrb';
import { ANT_DESKTOP_MAC_ARM, ANT_DESKTOP_MAC_INTEL, ANT_DESKTOP_RELEASES_URL } from '@/lib/links';

interface DesktopItem {
  id: string;
  label: string;
  desc: string;
  href?: string;
  comingSoon: boolean;
}

const DESKTOP_ITEMS: DesktopItem[] = [
  { id: 'mac-arm', label: 'macOS (Apple Silicon)', desc: 'M1 / M2 / M3 / M4', href: ANT_DESKTOP_MAC_ARM, comingSoon: false },
  { id: 'mac-intel', label: 'macOS (Intel)', desc: 'Intel Mac', href: ANT_DESKTOP_MAC_INTEL, comingSoon: false },
  { id: 'windows', label: 'Windows', desc: 'Windows 10+, 64-bit', comingSoon: true },
  { id: 'linux-deb', label: 'Linux (Debian)', desc: '.deb', comingSoon: true },
  { id: 'linux-appimage', label: 'Linux (AppImage)', desc: 'AppImage', comingSoon: true },
];

const WHAT_ITEMS: { id: string; Icon: typeof Box; titleKey: string; descKey: string; tone: IconOrbTone }[] = [
  { id: 'bridge', Icon: Box, titleKey: 'bridgeTitle', descKey: 'bridgeDesc', tone: 'violet' },
  { id: 'tray', Icon: Monitor, titleKey: 'trayTitle', descKey: 'trayDesc', tone: 'pink' },
  { id: 'monitor', Icon: Activity, titleKey: 'monitorTitle', descKey: 'monitorDesc', tone: 'teal' },
];

export default function DownloadPage() {
  const { t } = useTranslation('site');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const installSteps = t('download.installSteps', { returnObjects: true }) as string[];

  function handleComingSoon() {
    setToastMessage(t('download.comingSoonToast'));
    setTimeout(() => setToastMessage(null), 3200);
  }

  return (
    <>
      <PageHero
        title={t('download.heroTitle1')}
        highlight={t('download.heroTitle2')}
        description={t('download.heroDesc')}
        accent="purple"
      />

      {/* Downloads */}
      <section className="py-12 sm:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-mono" style={{ fontSize: 11, color: 'var(--violet-300)', border: '1px solid var(--border-brand)', background: 'oklch(26% 0.09 290)', padding: '3px 10px', borderRadius: 'var(--r-pill)' }}>
                {t('download.desktopLabel')}
              </span>
            </div>
            <h2 className="text-display" style={{ fontSize: 'clamp(24px, 3.5vw, 30px)', color: 'var(--text-1)', marginBottom: 12 }}>
              {t('download.desktopTitle')}
            </h2>
            <p style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 'var(--lh-relaxed)', marginBottom: 28, maxWidth: 620 }}>
              {t('download.desktopDesc')}
            </p>
          </Reveal>

          <div className="space-y-2">
            {DESKTOP_ITEMS.map((item) => {
              const rowStyle = { padding: 16, borderRadius: 'var(--r-lg)', background: 'var(--bg-surface)', border: '1px solid var(--border-1)' } as const;
              const inner = (
                <>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center" style={{ width: 36, height: 36, borderRadius: 'var(--r-md)', background: 'var(--bg-surface-2)' }}>
                      {item.comingSoon ? (
                        <Clock className="w-4 h-4" style={{ color: 'var(--text-4)' }} />
                      ) : (
                        <Download className="w-4 h-4" style={{ color: 'var(--violet-300)' }} />
                      )}
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 500, color: item.comingSoon ? 'var(--text-2)' : 'var(--text-1)' }}>{item.label}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-4)' }}>{item.desc}</div>
                    </div>
                  </div>
                  {item.comingSoon ? (
                    <span className="text-mono" style={{ fontSize: 11, color: 'var(--amber-500)', border: '1px solid oklch(40% 0.12 85 / 0.4)', background: 'oklch(28% 0.09 85 / 0.3)', padding: '3px 10px', borderRadius: 'var(--r-pill)' }}>
                      {t('download.comingSoon')}
                    </span>
                  ) : (
                    <span className="text-mono" style={{ fontSize: 11, color: 'var(--violet-300)', border: '1px solid var(--border-brand)', background: 'oklch(26% 0.09 290)', padding: '3px 10px', borderRadius: 'var(--r-pill)' }}>
                      {t('download.downloadLabel')}
                    </span>
                  )}
                </>
              );

              return item.href ? (
                <a
                  key={item.id}
                  href={item.href}
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-between text-left transition-all"
                  style={rowStyle}
                >
                  {inner}
                </a>
              ) : (
                <button
                  key={item.id}
                  type="button"
                  onClick={handleComingSoon}
                  className="w-full flex items-center justify-between text-left transition-all"
                  style={rowStyle}
                >
                  {inner}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Unsigned build notice + macOS install steps */}
      <section className="py-4 sm:py-6">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <GlassCard padding="lg">
              <div className="flex items-start gap-3">
                <Shield className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--amber-500)' }} />
                <div>
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', marginBottom: 6 }}>{t('download.unsignedTitle')}</h3>
                  <p style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 'var(--lh-relaxed)', marginBottom: 18 }}>{t('download.unsignedBody')}</p>

                  <div className="text-mono" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-4)', marginBottom: 10 }}>
                    {t('download.installStepsTitle')}
                  </div>
                  <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {installSteps.map((step, i) => (
                      <li key={i} style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 'var(--lh-relaxed)' }}>{step}</li>
                    ))}
                  </ol>

                  <a
                    href={ANT_DESKTOP_RELEASES_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 transition-colors"
                    style={{ fontSize: 13, color: 'var(--violet-300)', marginTop: 18 }}
                  >
                    {t('download.releasesLinkLabel')}
                  </a>
                </div>
              </div>
            </GlassCard>
          </Reveal>
        </div>
      </section>

      {/* What Ant Desktop does */}
      <section className="py-16 sm:py-24">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="flex justify-center mb-10">
              <SectionHeading title={t('download.whatTitle')} subtitle={t('download.whatDesc')} />
            </div>
          </Reveal>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {WHAT_ITEMS.map((item, i) => (
              <Reveal key={item.id} delay={i * 0.08}>
                <GlassCard hoverable padding="lg" style={{ height: '100%' }}>
                  <IconOrb tone={item.tone} size={44} style={{ marginBottom: 16 }}>
                    <item.Icon className="w-5 h-5" />
                  </IconOrb>
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', marginBottom: 8 }}>{t(`download.${item.titleKey}`)}</h3>
                  <p style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 'var(--lh-relaxed)' }}>{t(`download.${item.descKey}`)}</p>
                </GlassCard>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Code-sign notice */}
      <section className="py-12 sm:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <GlassCard padding="lg">
              <div className="flex items-start gap-3">
                <Shield className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--amber-500)' }} />
                <p style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 'var(--lh-relaxed)' }}>{t('download.codeSignNotice')}</p>
              </div>
            </GlassCard>
          </Reveal>
        </div>
      </section>

      {/* Toast */}
      {toastMessage && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-3 max-w-md"
          style={{ borderRadius: 'var(--r-lg)', background: 'var(--bg-surface)', border: '1px solid var(--border-2)', backdropFilter: 'blur(8px)', boxShadow: 'var(--shadow-lg)', fontSize: 14, color: 'var(--text-1)' }}
        >
          {toastMessage}
        </div>
      )}
    </>
  );
}
