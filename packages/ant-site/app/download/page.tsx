'use client';

import { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Monitor, Box, Shield, Activity, Clock } from 'lucide-react';
import { PageHero } from '@/components/PageHero';

type DetectedPlatform = 'mac-arm' | 'mac-intel' | 'windows' | 'linux' | 'unknown';

interface DownloadItem {
  id: string;
  label: string;
  file: string;
  desc: string;
  platform: 'mac' | 'windows' | 'linux';
  comingSoon?: boolean;
}

const DOWNLOAD_BASE = '/downloads/desktop/latest';

const ALL_DOWNLOADS: DownloadItem[] = [
  { id: 'mac-arm', label: 'macOS (Apple Silicon)', file: `${DOWNLOAD_BASE}/macos-arm64.dmg`, desc: 'M1/M2/M3/M4', platform: 'mac' },
  { id: 'mac-intel', label: 'macOS (Intel)', file: `${DOWNLOAD_BASE}/macos-x64.dmg`, desc: 'Intel Mac', platform: 'mac' },
  { id: 'windows', label: 'Windows', file: `${DOWNLOAD_BASE}/windows-x64.exe`, desc: 'Windows 10+, 64-bit', platform: 'windows', comingSoon: true },
  { id: 'linux-deb', label: 'Linux (Debian)', file: `${DOWNLOAD_BASE}/linux-x64.deb`, desc: '.deb', platform: 'linux', comingSoon: true },
  { id: 'linux-appimage', label: 'Linux (AppImage)', file: `${DOWNLOAD_BASE}/linux-x64.AppImage`, desc: 'AppImage', platform: 'linux', comingSoon: true },
];

function detectOS(): DetectedPlatform {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) return 'mac-arm';
  if (ua.includes('win')) return 'windows';
  if (ua.includes('linux')) return 'linux';
  return 'unknown';
}

function getPlatformFromDetected(os: DetectedPlatform): 'mac' | 'windows' | 'linux' {
  if (os === 'mac-arm' || os === 'mac-intel') return 'mac';
  if (os === 'windows') return 'windows';
  if (os === 'linux') return 'linux';
  return 'mac';
}

export default function DownloadPage() {
  const { t } = useTranslation('site');
  const [detectedOS, setDetectedOS] = useState<DetectedPlatform>('unknown');

  useEffect(() => {
    setDetectedOS(detectOS());
  }, []);

  const macSteps = t('download.macSteps', { returnObjects: true }) as string[];
  const winSteps = t('download.winSteps', { returnObjects: true }) as string[];
  const linuxSteps = t('download.linuxSteps', { returnObjects: true }) as string[];

  const platform = getPlatformFromDetected(detectedOS);
  const isArm = detectedOS === 'mac-arm' || detectedOS === 'unknown';

  const primaryDownloads = useMemo(() => {
    const items = ALL_DOWNLOADS.filter((d) => d.platform === platform);
    if (platform === 'mac' && !isArm) return items.reverse();
    return items;
  }, [platform, isArm]);

  const secondaryDownloads = useMemo(
    () => ALL_DOWNLOADS.filter((d) => d.platform !== platform),
    [platform],
  );

  return (
    <>
      <PageHero
        title={t('download.heroTitle1')}
        highlight={t('download.heroTitle2')}
        description={t('download.heroDesc')}
        accent="teal"
      />

      {/* Primary Download */}
      <section className="py-16 sm:py-20">
        <div className="max-w-xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="space-y-3">
            {primaryDownloads.map((item, i) =>
              item.comingSoon ? (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-5 rounded-2xl border bg-white/[0.02] border-white/5 opacity-60 cursor-default"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-white/5">
                      <Clock className="w-5 h-5 text-gray-500" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-gray-400">{item.label}</div>
                      <div className="text-xs text-gray-600">{item.desc}</div>
                    </div>
                  </div>
                  <span className="text-xs font-medium text-amber-400/80 border border-amber-800/30 bg-amber-950/20 px-2 py-0.5 rounded-full">
                    {t('download.comingSoon')}
                  </span>
                </div>
              ) : (
                <a
                  key={item.id}
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
              ),
            )}
          </div>

          {secondaryDownloads.length > 0 && (
            <details className="mt-6">
              <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-300 transition-colors text-center">
                {t('download.otherOS')}
              </summary>
              <div className="mt-3 space-y-2">
                {secondaryDownloads.map((item) =>
                  item.comingSoon ? (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-4 rounded-xl bg-white/[0.02] border border-white/5 opacity-60 cursor-default"
                    >
                      <div>
                        <div className="text-sm text-gray-500">{item.label}</div>
                        <div className="text-xs text-gray-600">{item.desc}</div>
                      </div>
                      <span className="text-xs font-medium text-amber-400/80 border border-amber-800/30 bg-amber-950/20 px-2 py-0.5 rounded-full">
                        {t('download.comingSoon')}
                      </span>
                    </div>
                  ) : (
                    <a
                      key={item.id}
                      href={item.file}
                      className="flex items-center justify-between p-4 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all"
                    >
                      <div>
                        <div className="text-sm text-gray-300">{item.label}</div>
                        <div className="text-xs text-gray-500">{item.desc}</div>
                      </div>
                      <Download className="w-4 h-4 text-gray-500" />
                    </a>
                  ),
                )}
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
                  { os: 'macOS', version: '11 (Big Sur)+', arch: 'Apple Silicon (arm64), Intel (x64)' },
                  { os: 'Windows', version: '10+', arch: 'x64' },
                  { os: 'Linux', version: 'Ubuntu 20.04+', arch: 'x64' },
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
