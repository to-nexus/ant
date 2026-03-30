'use client';

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Monitor, Server, Layers, FolderGit2, BookOpen } from 'lucide-react';

const LANGUAGES: { name: string; descKey: string; tier: 'supported' | 'planned' }[] = [
  { name: 'TypeScript / JavaScript', descKey: 'langTs', tier: 'supported' },
  { name: 'Go', descKey: 'langGo', tier: 'supported' },
  { name: 'Python', descKey: 'langPy', tier: 'planned' },
  { name: 'Java / Kotlin', descKey: 'langJava', tier: 'planned' },
  { name: 'Rust', descKey: 'langRust', tier: 'planned' },
];

const SUPPORTED_FRAMEWORKS = {
  Frontend: ['Next.js', 'Nuxt', 'SvelteKit', 'Angular', 'Vite + React/Vue'],
  Backend: ['Express', 'NestJS', 'Gin'],
  'CSS / UI': ['Tailwind CSS', 'CSS Modules', 'styled-components'],
};

const PLANNED_FRAMEWORKS = {
  Python: ['FastAPI', 'Django', 'Flask'],
  'Java / Kotlin': ['Spring Boot'],
  Rust: ['Axum', 'Actix'],
};

const PROJECT_TYPES: {
  icon: ReactNode;
  title: string;
  descKey: 'frontendDesc' | 'backendDesc' | 'fullstackDesc' | 'monorepoDesc';
}[] = [
  { icon: <Monitor className="w-5 h-5" />, title: 'Frontend', descKey: 'frontendDesc' },
  { icon: <Server className="w-5 h-5" />, title: 'Backend', descKey: 'backendDesc' },
  { icon: <Layers className="w-5 h-5" />, title: 'Fullstack', descKey: 'fullstackDesc' },
  { icon: <FolderGit2 className="w-5 h-5" />, title: 'Monorepo', descKey: 'monorepoDesc' },
];

export default function CapabilitiesContent() {
  const { t } = useTranslation('site');

  const supported = LANGUAGES.filter((l) => l.tier === 'supported');
  const planned = LANGUAGES.filter((l) => l.tier === 'planned');

  return (
    <>
      {/* Hero */}
      <section className="relative pt-32 pb-16 sm:pt-40 sm:pb-24 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-blue-950/20 via-transparent to-transparent" />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="animate-fade-in-up">
            <h1 className="text-4xl sm:text-5xl font-display font-bold text-white leading-tight mb-6">
              {t('capabilities.heroTitle1')}{' '}
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-300">
                {t('capabilities.heroTitle2')}
              </span>
            </h1>
            <p className="text-lg text-gray-400 max-w-2xl mx-auto leading-relaxed">{t('capabilities.heroDesc')}</p>
          </div>
        </div>
      </section>

      {/* Project Types */}
      <section className="py-16 sm:py-24">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-display font-bold text-white text-center mb-12">
            {t('capabilities.projectTypesTitle')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {PROJECT_TYPES.map((item) => (
              <div key={item.title} className="p-5 rounded-xl bg-white/[0.03] border border-white/5">
                <div className="w-9 h-9 rounded-lg bg-blue-950/50 border border-blue-800/30 flex items-center justify-center text-blue-400 mb-3">
                  {item.icon}
                </div>
                <h3 className="text-sm font-semibold text-white mb-1">{item.title}</h3>
                <p className="text-xs text-gray-400">{t(`capabilities.${item.descKey}`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Languages */}
      <section className="py-16 sm:py-24 bg-gradient-to-b from-transparent via-blue-950/5 to-transparent">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-display font-bold text-white text-center mb-12">
            {t('capabilities.langTitle')}
          </h2>

          <div className="mb-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-400 mb-3">
              {t('capabilities.supportedLabel')}
            </h3>
            <div className="space-y-3">
              {supported.map((lang) => (
                <div key={lang.name} className="flex items-start gap-4 p-5 rounded-xl bg-white/[0.03] border border-emerald-800/20">
                  <div className="shrink-0 mt-0.5 w-2 h-2 rounded-full bg-emerald-400" />
                  <div>
                    <h4 className="text-sm font-semibold text-white">{lang.name}</h4>
                    <p className="text-sm text-gray-400 mt-1">{t(`capabilities.${lang.descKey}`)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-8">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
              {t('capabilities.plannedLabel')}
            </h3>
            <div className="space-y-3">
              {planned.map((lang) => (
                <div key={lang.name} className="flex items-start gap-4 p-5 rounded-xl bg-white/[0.02] border border-white/5">
                  <div className="shrink-0 mt-0.5 w-2 h-2 rounded-full bg-gray-600" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-gray-400">{lang.name}</h4>
                      <span className="px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-500 border border-white/10 rounded-full">
                        {t('capabilities.plannedLabel')}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">{t(`capabilities.${lang.descKey}`)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Frameworks */}
      <section className="py-16 sm:py-24">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-display font-bold text-white text-center mb-12">
            {t('capabilities.frameworkTitle')}
          </h2>

          <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-400 mb-4">
            {t('capabilities.frameworkSupported')}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
            {Object.entries(SUPPORTED_FRAMEWORKS).map(([category, items]) => (
              <div key={category} className="p-6 rounded-2xl bg-white/[0.03] border border-emerald-800/20">
                <h4 className="text-sm font-semibold text-gray-300 mb-4">{category}</h4>
                <div className="flex flex-wrap gap-2">
                  {items.map((item) => (
                    <span key={item} className="px-3 py-1.5 text-xs font-medium text-gray-300 bg-white/5 border border-white/10 rounded-full">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-4">
            {t('capabilities.frameworkPlanned')}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {Object.entries(PLANNED_FRAMEWORKS).map(([category, items]) => (
              <div key={category} className="p-6 rounded-2xl bg-white/[0.02] border border-white/5">
                <h4 className="text-sm font-semibold text-gray-500 mb-4">{category}</h4>
                <div className="flex flex-wrap gap-2">
                  {items.map((item) => (
                    <span key={item} className="px-3 py-1.5 text-xs font-medium text-gray-500 bg-white/[0.02] border border-white/5 rounded-full">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 sm:py-24 bg-gradient-to-b from-transparent via-blue-950/5 to-transparent">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="w-12 h-12 rounded-xl bg-blue-950/50 border border-blue-800/30 flex items-center justify-center text-blue-400 mx-auto mb-5">
            <BookOpen className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-display font-bold text-white mb-4">{t('capabilities.howTitle')}</h2>
          <p className="text-gray-400 leading-relaxed mb-6">{t('capabilities.howDesc')}</p>
          <div className="inline-flex items-center gap-3 text-sm">
            <span className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-gray-300">Learn</span>
            <span className="text-gray-600">→</span>
            <span className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-gray-300">Design</span>
            <span className="text-gray-600">→</span>
            <span className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-gray-300">Code</span>
          </div>
        </div>
      </section>

      {/* Honest Note */}
      <section className="py-16 sm:py-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="p-6 rounded-2xl bg-amber-950/10 border border-amber-900/20">
            <p className="text-sm text-amber-200/80 leading-relaxed">
              <strong className="text-amber-200">{t('capabilities.noteLabel')}</strong> {t('capabilities.note')}
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
