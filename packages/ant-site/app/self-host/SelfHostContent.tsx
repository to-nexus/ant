'use client';

import { useTranslation } from 'react-i18next';
import { Database, Cpu, Radio, Eye, Server, KeyRound, Monitor, ArrowRight } from 'lucide-react';
import { PageHero } from '@/components/PageHero';
import { QuickstartTabs } from '@/components/QuickstartTabs';
import { GITHUB_URL } from '@/lib/links';

interface EnvVar {
  name: string;
  default: string;
  desc: string;
}

const PROCESS_ICONS = [
  { key: 'api', Icon: Server },
  { key: 'worker', Icon: Cpu },
  { key: 'realtime', Icon: Radio },
  { key: 'preview', Icon: Eye },
] as const;

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
        accent="emerald"
      />

      <QuickstartTabs title="" />

      {/* Processes */}
      <section className="py-16 sm:py-24">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-display font-bold text-white mb-3">{t('selfHost.infraTitle')}</h2>
            <p className="text-sm text-gray-400 max-w-2xl mx-auto">{t('selfHost.infraDesc')}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
            {PROCESS_ICONS.map(({ key, Icon }) => (
              <div key={key} className="flex items-start gap-4 p-5 rounded-xl bg-white/[0.03] border border-white/5">
                <div className="shrink-0 w-10 h-10 rounded-lg bg-emerald-950/40 border border-emerald-800/30 flex items-center justify-center text-emerald-300">
                  <Icon className="w-5 h-5" />
                </div>
                <p className="text-sm text-gray-300 leading-relaxed pt-1.5">
                  {t(`selfHost.process.${key}`)}
                </p>
              </div>
            ))}
          </div>

          <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5">
            <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
              <Database className="w-4 h-4 text-teal-400" />
              {t('selfHost.infraDeps.title')}
            </h3>
            <ul className="space-y-2 text-sm text-gray-400">
              <li>• {t('selfHost.infraDeps.redis')}</li>
              <li>• {t('selfHost.infraDeps.chroma')}</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Env vars */}
      <section className="py-16 sm:py-24 bg-gradient-to-b from-transparent via-emerald-950/5 to-transparent">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-display font-bold text-white mb-3">{t('selfHost.envTitle')}</h2>
            <p className="text-sm text-gray-400">{t('selfHost.envDesc')}</p>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-white/[0.03] border-b border-white/10">
                  <th className="py-3 px-4 font-mono text-xs uppercase tracking-wider text-gray-500">name</th>
                  <th className="py-3 px-4 font-mono text-xs uppercase tracking-wider text-gray-500">default</th>
                  <th className="py-3 px-4 font-mono text-xs uppercase tracking-wider text-gray-500">desc</th>
                </tr>
              </thead>
              <tbody>
                {envVars.map((v) => (
                  <tr key={v.name} className="border-b border-white/5 last:border-b-0">
                    <td className="py-3 px-4 font-mono text-emerald-300 text-xs">{v.name}</td>
                    <td className="py-3 px-4 font-mono text-gray-400 text-xs">{v.default}</td>
                    <td className="py-3 px-4 text-gray-400 text-xs">{v.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* LLM key */}
      <section className="py-16 sm:py-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="p-7 rounded-2xl bg-white/[0.03] border border-white/5">
            <div className="flex items-center gap-3 mb-4">
              <KeyRound className="w-5 h-5 text-amber-400" />
              <h2 className="text-xl font-display font-bold text-white">{t('selfHost.llmTitle')}</h2>
            </div>
            <p className="text-sm text-gray-400 leading-relaxed mb-5">{t('selfHost.llmDesc')}</p>
            <ul className="space-y-2">
              {llmKeys.map((k) => (
                <li key={k} className="text-sm font-mono text-emerald-300">
                  {k}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Local-mode UI surface */}
      <section className="py-16 sm:py-20 bg-gradient-to-b from-transparent via-emerald-950/5 to-transparent">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="p-7 rounded-2xl bg-white/[0.03] border border-white/5">
            <div className="flex items-center gap-3 mb-4">
              <Monitor className="w-5 h-5 text-emerald-400" />
              <h2 className="text-xl font-display font-bold text-white">{t('selfHost.uiTitle')}</h2>
            </div>
            <p className="text-sm text-gray-400 leading-relaxed">{t('selfHost.uiDesc')}</p>
          </div>
        </div>
      </section>

      {/* Next steps */}
      <section className="py-16 sm:py-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl font-display font-bold text-white mb-4">{t('selfHost.nextStepsTitle')}</h2>
          <p className="text-sm text-gray-400 leading-relaxed mb-8 max-w-xl mx-auto">{t('selfHost.nextStepsDesc')}</p>
          <a
            href={LOCAL_MODE_INSTALL_DOC}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 hover:border-emerald-500/50 rounded-xl transition-colors"
          >
            {t('selfHost.nextStepsCta')}
            <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </section>
    </>
  );
}
