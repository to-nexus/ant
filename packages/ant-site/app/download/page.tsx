'use client';

import { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal, Clock, Box, Monitor, Activity, Shield, ArrowRight, Check, Copy } from 'lucide-react';
import { PageHero } from '@/components/PageHero';
import { GlassCard } from '@/components/aurora/GlassCard';
import { AuroraButton } from '@/components/aurora/AuroraButton';
import { SectionHeading } from '@/components/aurora/SectionHeading';
import { IconOrb } from '@/components/aurora/IconOrb';
import { Reveal } from '@/components/aurora/Reveal';
import type { IconOrbTone } from '@/components/aurora/IconOrb';

type DetectedOS = 'mac' | 'windows' | 'linux' | 'unknown';

interface DesktopItem {
  id: string;
  label: string;
  desc: string;
}

const DESKTOP_ITEMS: DesktopItem[] = [
  { id: 'mac-arm', label: 'macOS (Apple Silicon)', desc: 'M1 / M2 / M3 / M4' },
  { id: 'mac-intel', label: 'macOS (Intel)', desc: 'Intel Mac' },
  { id: 'windows', label: 'Windows', desc: 'Windows 10+, 64-bit' },
  { id: 'linux-deb', label: 'Linux (Debian)', desc: '.deb' },
  { id: 'linux-appimage', label: 'Linux (AppImage)', desc: 'AppImage' },
];

const SOURCE_SNIPPET = `git clone https://github.com/to-nexus/ant
cd ant
pnpm install
pnpm dev:infra:redis
pnpm dev:all`;

const WHAT_ITEMS: { id: string; Icon: typeof Box; titleKey: string; descKey: string; tone: IconOrbTone }[] = [
  { id: 'bridge', Icon: Box, titleKey: 'bridgeTitle', descKey: 'bridgeDesc', tone: 'violet' },
  { id: 'tray', Icon: Monitor, titleKey: 'trayTitle', descKey: 'trayDesc', tone: 'pink' },
  { id: 'monitor', Icon: Activity, titleKey: 'monitorTitle', descKey: 'monitorDesc', tone: 'teal' },
];

function detectOS(): DetectedOS {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) return 'mac';
  if (ua.includes('win')) return 'windows';
  if (ua.includes('linux')) return 'linux';
  return 'unknown';
}

export default function DownloadPage() {
  const { t } = useTranslation('site');
  const [os, setOs] = useState<DetectedOS>('unknown');
  const [copied, setCopied] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    setOs(detectOS());
  }, []);

  const prereqLine = useMemo(() => {
    if (os === 'windows') return t('download.sourcePrereqWin');
    if (os === 'linux') return t('download.sourcePrereqLinux');
    return t('download.sourcePrereqMac');
  }, [os, t]);

  function handleCopy() {
    if (typeof navigator === 'undefined') return;
    navigator.clipboard.writeText(SOURCE_SNIPPET).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

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

      {/* §1 Build from Source (Available Now) */}
      <section className="py-12 sm:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <GlassCard glow padding="xl" style={{ border: '1px solid var(--border-brand)' }}>
              <div className="flex items-center gap-3 mb-4">
                <IconOrb tone="violet" size={44}>
                  <Terminal className="w-5 h-5" />
                </IconOrb>
                <span className="text-mono" style={{ fontSize: 11, color: 'var(--violet-300)', border: '1px solid var(--border-brand)', background: 'oklch(26% 0.09 290)', padding: '3px 10px', borderRadius: 'var(--r-pill)' }}>
                  {t('download.sourceLabel')}
                </span>
              </div>
              <h2 className="text-display" style={{ fontSize: 'clamp(24px, 3.5vw, 30px)', color: 'var(--text-1)', marginBottom: 12 }}>
                {t('download.sourceTitle')}
              </h2>
              <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 'var(--lh-relaxed)', marginBottom: 24 }}>{t('download.sourceDesc')}</p>

              <div className="mb-5">
                <div className="text-mono" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-4)', marginBottom: 8 }}>
                  {t('download.sourcePrereqTitle')}
                </div>
                <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 'var(--lh-relaxed)' }}>{prereqLine}</p>
              </div>

              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-mono" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-4)' }}>
                    {t('download.sourceSnippetLabel')}
                  </div>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1.5 transition-colors"
                    style={{ fontSize: 12, color: copied ? 'var(--violet-300)' : 'var(--text-3)' }}
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'copied' : 'copy'}
                  </button>
                </div>
                <pre
                  className="text-mono"
                  style={{ fontSize: 13, color: 'var(--text-2)', background: 'var(--bg-surface-2)', border: '1px solid var(--border-1)', borderRadius: 'var(--r-md)', padding: 16, overflowX: 'auto', lineHeight: 'var(--lh-relaxed)', margin: 0 }}
                >
{SOURCE_SNIPPET}
                </pre>
              </div>

              <AuroraButton href="/self-host" size="sm">
                {t('download.sourceCta')}
                <ArrowRight className="w-4 h-4" />
              </AuroraButton>
            </GlassCard>
          </Reveal>
        </div>
      </section>

      {/* §2 Desktop App (Coming Soon) */}
      <section className="py-16 sm:py-24">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-mono" style={{ fontSize: 11, color: 'var(--amber-500)', border: '1px solid oklch(40% 0.12 85 / 0.5)', background: 'oklch(28% 0.09 85 / 0.4)', padding: '3px 10px', borderRadius: 'var(--r-pill)' }}>
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
            {DESKTOP_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={handleComingSoon}
                className="w-full flex items-center justify-between text-left transition-all"
                style={{ padding: 16, borderRadius: 'var(--r-lg)', background: 'var(--bg-surface)', border: '1px solid var(--border-1)' }}
              >
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center" style={{ width: 36, height: 36, borderRadius: 'var(--r-md)', background: 'var(--bg-surface-2)' }}>
                    <Clock className="w-4 h-4" style={{ color: 'var(--text-4)' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-2)' }}>{item.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-4)' }}>{item.desc}</div>
                  </div>
                </div>
                <span className="text-mono" style={{ fontSize: 11, color: 'var(--amber-500)', border: '1px solid oklch(40% 0.12 85 / 0.4)', background: 'oklch(28% 0.09 85 / 0.3)', padding: '3px 10px', borderRadius: 'var(--r-pill)' }}>
                  {t('download.comingSoon')}
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* What desktop will do */}
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
