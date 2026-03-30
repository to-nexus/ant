'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Monitor, Box, Shield, Activity } from 'lucide-react';

type OsPlatform = 'mac-arm' | 'mac-intel' | 'windows' | 'linux' | 'unknown';

const DOWNLOAD_BASE = '/downloads/desktop/latest';

const DOWNLOADS: Record<OsPlatform, { label: string; file: string; desc: string }[]> = {
  'mac-arm': [
    { label: 'macOS (Apple Silicon)', file: `${DOWNLOAD_BASE}/macos-arm64.dmg`, desc: 'M1/M2/M3/M4' },
    { label: 'macOS (Intel)', file: `${DOWNLOAD_BASE}/macos-x64.dmg`, desc: 'Intel Mac' },
  ],
  'mac-intel': [
    { label: 'macOS (Intel)', file: `${DOWNLOAD_BASE}/macos-x64.dmg`, desc: 'Intel Mac' },
    { label: 'macOS (Apple Silicon)', file: `${DOWNLOAD_BASE}/macos-arm64.dmg`, desc: 'M1/M2/M3/M4' },
  ],
  'windows': [
    { label: 'Windows', file: `${DOWNLOAD_BASE}/windows-x64.exe`, desc: 'Windows 10+, 64-bit' },
  ],
  'linux': [
    { label: 'Linux (Debian)', file: `${DOWNLOAD_BASE}/linux-x64.deb`, desc: '.deb 패키지' },
    { label: 'Linux (AppImage)', file: `${DOWNLOAD_BASE}/linux-x64.AppImage`, desc: 'AppImage' },
  ],
  'unknown': [],
};

function detectOS(): OsPlatform {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) {
    // Apple Silicon detection heuristic
    if (navigator.platform === 'MacIntel' && 'maxTouchPoints' in navigator && navigator.maxTouchPoints > 0) {
      return 'mac-arm';
    }
    return 'mac-arm'; // Default to ARM for newer Macs
  }
  if (ua.includes('win')) return 'windows';
  if (ua.includes('linux')) return 'linux';
  return 'unknown';
}

export default function DownloadPage() {
  const { t } = useTranslation('site');
  const [detectedOS, setDetectedOS] = useState<OsPlatform>('unknown');

  useEffect(() => {
    setDetectedOS(detectOS());
  }, []);

  const macSteps = t('download.macSteps', { returnObjects: true }) as string[];
  const winSteps = t('download.winSteps', { returnObjects: true }) as string[];
  const linuxSteps = t('download.linuxSteps', { returnObjects: true }) as string[];

  const primaryDownloads = DOWNLOADS[detectedOS].length > 0 ? DOWNLOADS[detectedOS] : DOWNLOADS['mac-arm'];
  const allPlatforms = Object.entries(DOWNLOADS)
    .filter(([key]) => key !== 'unknown' && key !== detectedOS)
    .flatMap(([, items]) => items);

  return (
    <>
      {/* Hero */}
      <section className="relative pt-32 pb-16 sm:pt-40 sm:pb-24 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-teal-950/20 via-transparent to-transparent" />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="animate-fade-in-up">
            <h1 className="text-4xl sm:text-5xl font-display font-bold text-white leading-tight mb-6">
              {t('download.heroTitle1')}{' '}
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-teal-400 to-cyan-300">
                {t('download.heroTitle2')}
              </span>
            </h1>
            <p className="text-lg text-gray-400 max-w-2xl mx-auto leading-relaxed">
              {t('download.heroDesc')}
            </p>
          </div>
        </div>
      </section>

      {/* Primary Download */}
      <section className="py-16 sm:py-20">
        <div className="max-w-xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="space-y-3">
            {primaryDownloads.map((item, i) => (
              <a
                key={item.file}
                href={item.file}
                className={`flex items-center justify-between p-5 rounded-2xl border transition-all ${
                  i === 0
                    ? 'bg-gradient-to-r from-teal-950/30 to-cyan-950/30 border-teal-800/30 hover:border-teal-700/50'
                    : 'bg-white/[0.03] border-white/5 hover:border-white/10'
                }`}
              >
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${i === 0 ? 'bg-teal-600' : 'bg-white/5'}`}>
                    <Download className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">{item.label}</div>
                    <div className="text-xs text-gray-500">{item.desc}</div>
                  </div>
                </div>
                <span className={`text-xs font-medium ${i === 0 ? 'text-teal-300' : 'text-gray-500'}`}>
                  {t('download.downloadBtn')}
                </span>
              </a>
            ))}
          </div>

          {allPlatforms.length > 0 && (
            <details className="mt-6">
              <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-300 transition-colors text-center">
                {t('download.otherOS')}
              </summary>
              <div className="mt-3 space-y-2">
                {allPlatforms.map((item) => (
                  <a
                    key={item.file}
                    href={item.file}
                    className="flex items-center justify-between p-4 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all"
                  >
                    <div>
                      <div className="text-sm text-gray-300">{item.label}</div>
                      <div className="text-xs text-gray-500">{item.desc}</div>
                    </div>
                    <Download className="w-4 h-4 text-gray-500" />
                  </a>
                ))}
              </div>
            </details>
          )}
        </div>
      </section>

      {/* What It Does */}
      <section className="py-16 sm:py-24 bg-gradient-to-b from-transparent via-teal-950/5 to-transparent">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-display font-bold text-white text-center mb-12">
            {t('download.whatTitle')}
          </h2>
          <p className="text-center text-gray-400 mb-10 max-w-2xl mx-auto">{t('download.whatDesc')}</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                id: 'bridge',
                icon: <Box className="w-5 h-5" />,
                title: t('download.bridgeTitle'),
                desc: t('download.bridgeDesc'),
              },
              {
                id: 'tray',
                icon: <Monitor className="w-5 h-5" />,
                title: t('download.trayTitle'),
                desc: t('download.trayDesc'),
              },
              {
                id: 'monitor',
                icon: <Activity className="w-5 h-5" />,
                title: t('download.monitorTitle'),
                desc: t('download.monitorDesc'),
              },
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

      {/* System Requirements */}
      <section className="py-16 sm:py-24">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-display font-bold text-white text-center mb-12">
            {t('download.reqTitle')}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="pb-3 pr-6 text-sm font-semibold text-gray-400">{t('download.reqOS')}</th>
                  <th className="pb-3 px-6 text-sm font-semibold text-gray-400">{t('download.reqMinVersion')}</th>
                  <th className="pb-3 pl-6 text-sm font-semibold text-gray-400">{t('download.reqArch')}</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { os: 'macOS', version: '11 (Big Sur) 이상', arch: 'Apple Silicon (arm64), Intel (x64)' },
                  { os: 'Windows', version: '10 이상', arch: 'x64' },
                  { os: 'Linux', version: 'Ubuntu 20.04 이상', arch: 'x64' },
                ].map((row) => (
                  <tr key={row.os} className="border-b border-white/5">
                    <td className="py-3 pr-6 text-sm text-gray-300 font-medium">{row.os}</td>
                    <td className="py-3 px-6 text-sm text-gray-400">{row.version}</td>
                    <td className="py-3 pl-6 text-sm text-gray-400">{row.arch}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Install Guide */}
      <section className="py-16 sm:py-24 bg-gradient-to-b from-transparent via-teal-950/5 to-transparent">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-display font-bold text-white text-center mb-12">
            {t('download.installTitle')}
          </h2>
          <div className="space-y-6">
            {[
              { title: 'macOS', steps: macSteps },
              { title: 'Windows', steps: winSteps },
              { title: 'Linux', steps: linuxSteps },
            ].map((group) => (
              <div key={group.title} className="p-6 rounded-2xl bg-white/[0.03] border border-white/5">
                <h3 className="text-sm font-semibold text-white mb-3">{group.title}</h3>
                <ol className="space-y-2">
                  {group.steps.map((step, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm text-gray-400">
                      <span className="shrink-0 w-5 h-5 rounded-full bg-white/5 flex items-center justify-center text-xs text-gray-500 mt-0.5">{i + 1}</span>
                      {step}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Code Signing Notice */}
      <section className="py-12 sm:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="p-5 rounded-2xl bg-amber-950/10 border border-amber-900/20 flex items-start gap-3">
            <Shield className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-200/80 leading-relaxed">{t('download.codeSignNotice')}</p>
          </div>
        </div>
      </section>
    </>
  );
}
