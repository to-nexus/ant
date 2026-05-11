'use client';

import { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import { Terminal, Clock, Box, Monitor, Activity, Shield, ArrowRight, Check, Copy } from 'lucide-react';
import { PageHero } from '@/components/PageHero';

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
pnpm dev:local:all`;

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
        accent="teal"
      />

      {/* §1 Build from Source (Available Now) */}
      <section className="py-16 sm:py-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="rounded-3xl bg-gradient-to-br from-emerald-950/30 to-teal-950/30 border border-emerald-800/30 p-7 sm:p-10">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-11 h-11 rounded-xl bg-emerald-950/60 border border-emerald-700/40 flex items-center justify-center text-emerald-300">
                <Terminal className="w-5 h-5" />
              </div>
              <span className="text-xs font-medium text-emerald-300 border border-emerald-700/40 bg-emerald-950/40 px-2 py-0.5 rounded-full">
                {t('download.sourceLabel')}
              </span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-display font-bold text-white mb-3">
              {t('download.sourceTitle')}
            </h2>
            <p className="text-sm text-gray-300 leading-relaxed mb-6">{t('download.sourceDesc')}</p>

            <div className="mb-5">
              <div className="text-xs font-mono uppercase tracking-wider text-emerald-400/70 mb-2">
                {t('download.sourcePrereqTitle')}
              </div>
              <p className="text-sm text-gray-300 leading-relaxed">{prereqLine}</p>
            </div>

            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-mono uppercase tracking-wider text-emerald-400/70">
                  {t('download.sourceSnippetLabel')}
                </div>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-emerald-300 transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'copied' : 'copy'}
                </button>
              </div>
              <pre className="text-xs sm:text-sm font-mono text-emerald-200 bg-black/40 border border-white/5 rounded-xl p-4 overflow-x-auto leading-relaxed">
{SOURCE_SNIPPET}
              </pre>
            </div>

            <Link
              href="/self-host"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-emerald-200 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 hover:border-emerald-500/60 rounded-xl transition-colors"
            >
              {t('download.sourceCta')}
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* §2 Desktop App (Coming Soon) */}
      <section className="py-16 sm:py-24 bg-gradient-to-b from-transparent via-teal-950/5 to-transparent">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs font-medium text-amber-300 border border-amber-700/40 bg-amber-950/30 px-2 py-0.5 rounded-full">
              {t('download.desktopLabel')}
            </span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-display font-bold text-white mb-3">
            {t('download.desktopTitle')}
          </h2>
          <p className="text-sm text-gray-400 leading-relaxed mb-8 max-w-2xl">
            {t('download.desktopDesc')}
          </p>

          <div className="space-y-2">
            {DESKTOP_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={handleComingSoon}
                className="w-full flex items-center justify-between p-4 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 hover:bg-white/[0.04] transition-all cursor-pointer text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-white/5">
                    <Clock className="w-4 h-4 text-gray-500" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-300">{item.label}</div>
                    <div className="text-xs text-gray-500">{item.desc}</div>
                  </div>
                </div>
                <span className="text-xs font-medium text-amber-400/80 border border-amber-800/30 bg-amber-950/20 px-2 py-0.5 rounded-full">
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
          <h2 className="text-2xl sm:text-3xl font-display font-bold text-white text-center mb-3">
            {t('download.whatTitle')}
          </h2>
          <p className="text-center text-gray-400 mb-10 max-w-2xl mx-auto text-sm">
            {t('download.whatDesc')}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { id: 'bridge', icon: <Box className="w-5 h-5" />, title: t('download.bridgeTitle'), desc: t('download.bridgeDesc') },
              { id: 'tray', icon: <Monitor className="w-5 h-5" />, title: t('download.trayTitle'), desc: t('download.trayDesc') },
              { id: 'monitor', icon: <Activity className="w-5 h-5" />, title: t('download.monitorTitle'), desc: t('download.monitorDesc') },
            ].map((item) => (
              <div key={item.id} className="p-6 rounded-2xl bg-white/[0.03] border border-white/5">
                <div className="w-10 h-10 rounded-lg bg-teal-950/50 border border-teal-800/30 flex items-center justify-center text-teal-400 mb-4">
                  {item.icon}
                </div>
                <h3 className="text-sm font-semibold text-white mb-2">{item.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Code-sign notice */}
      <section className="py-12 sm:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="p-5 rounded-2xl bg-amber-950/10 border border-amber-900/20 flex items-start gap-3">
            <Shield className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-200/80 leading-relaxed">{t('download.codeSignNotice')}</p>
          </div>
        </div>
      </section>

      {/* Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-xl bg-zinc-900/95 border border-amber-800/40 backdrop-blur shadow-lg shadow-black/40 text-sm text-amber-100 max-w-md animate-in fade-in slide-in-from-bottom-2 duration-200">
          {toastMessage}
        </div>
      )}
    </>
  );
}
