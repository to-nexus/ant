'use client';

import { ArrowRight, Download, FileText, Palette, Code2, Eye, Cpu, Layers, Globe } from 'lucide-react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { StarfieldCanvas, FloatingOrbs } from '@/components/HeroEffects';

export default function HomePage() {
  const { t } = useTranslation('site');

  return (
    <>
      {/* Hero */}
      <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-950/20 via-transparent to-transparent" />
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
        <FloatingOrbs />
        <div className="absolute inset-0">
          <StarfieldCanvas />
        </div>

        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="animate-fade-in-up">
            <div className="inline-flex items-center gap-4 mb-10">
              <img src="/logo.png" alt="ANT" className="w-16 h-16 sm:w-20 sm:h-20 drop-shadow-[0_0_24px_rgba(16,185,129,0.15)]" />
              <span className="text-2xl sm:text-3xl font-display font-bold text-white tracking-tight">
                {t('home.brandPrefix')}<span className="text-orange-400">{t('home.brandHighlight')}</span>{t('home.brandSuffix')}
              </span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-display font-bold text-white leading-tight mb-6">
              {t('home.title1')}
              <br />
              <span className="text-gradient">{t('home.title2')}</span>
            </h1>

            <p className="text-lg sm:text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
              {t('home.desc')}
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <a
                href="/app/"
                className="group inline-flex items-center gap-2 px-7 py-3.5 text-base font-semibold text-white bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 rounded-xl shadow-lg shadow-emerald-500/25 hover:shadow-xl hover:shadow-emerald-500/30 transition-all"
              >
                {t('home.cta')}
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </a>
              <Link
                href="/download"
                className="inline-flex items-center gap-2 px-7 py-3.5 text-base font-medium text-gray-300 border border-white/10 hover:border-white/20 hover:bg-white/5 rounded-xl transition-all"
              >
                <Download className="w-4 h-4" />
                {t('home.downloadApp')}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Workflow */}
      <section className="py-20 sm:py-28">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16 animate-fade-in-up">
            <h2 className="text-3xl sm:text-4xl font-display font-bold text-white mb-4">
              {t('home.workflow.title')}
            </h2>
            <p className="text-gray-400 max-w-xl mx-auto">
              {t('home.workflow.desc')}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                step: '1',
                title: t('home.workflow.step1Title'),
                agent: t('home.workflow.step1Agent'),
                icon: <FileText className="w-5 h-5" />,
                desc: t('home.workflow.step1Desc'),
              },
              {
                step: '2',
                title: t('home.workflow.step2Title'),
                agent: t('home.workflow.step2Agent'),
                icon: <Palette className="w-5 h-5" />,
                desc: t('home.workflow.step2Desc'),
              },
              {
                step: '3',
                title: t('home.workflow.step3Title'),
                agent: t('home.workflow.step3Agent'),
                icon: <Code2 className="w-5 h-5" />,
                desc: t('home.workflow.step3Desc'),
              },
              {
                step: '4',
                title: t('home.workflow.step4Title'),
                agent: t('home.workflow.step4Agent'),
                icon: <Eye className="w-5 h-5" />,
                desc: t('home.workflow.step4Desc'),
              },
            ].map((item, i) => (
              <div
                key={item.step}
                className={`relative p-6 rounded-2xl bg-white/[0.03] border border-white/5 hover:border-emerald-800/30 hover:bg-white/[0.05] transition-all animate-fade-in-up`}
                style={{ animationDelay: `${i * 0.1}s` }}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-emerald-950/50 border border-emerald-800/30 flex items-center justify-center text-emerald-400">
                    {item.icon}
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 font-medium">{item.agent}</div>
                    <div className="text-base font-semibold text-white">{item.title}</div>
                  </div>
                </div>
                <p className="text-sm text-gray-400 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Key Differentiators */}
      <section className="py-20 sm:py-28 bg-gradient-to-b from-transparent via-emerald-950/5 to-transparent">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Link href="/figma" className="group p-8 rounded-2xl bg-white/[0.03] border border-white/5 hover:border-emerald-800/30 hover:bg-white/[0.05] transition-all">
              <div className="w-12 h-12 rounded-xl bg-purple-950/50 border border-purple-800/30 flex items-center justify-center text-purple-400 mb-5">
                <Layers className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">{t('home.diff.figmaTitle')}</h3>
              <p className="text-sm text-gray-400 leading-relaxed mb-4">
                {t('home.diff.figmaDesc')}
              </p>
              <span className="text-sm text-emerald-400 group-hover:text-emerald-300 transition-colors">
                {t('home.diff.figmaLink')}
              </span>
            </Link>

            <Link href="/capabilities" className="group p-8 rounded-2xl bg-white/[0.03] border border-white/5 hover:border-emerald-800/30 hover:bg-white/[0.05] transition-all">
              <div className="w-12 h-12 rounded-xl bg-blue-950/50 border border-blue-800/30 flex items-center justify-center text-blue-400 mb-5">
                <Cpu className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">{t('home.diff.stackTitle')}</h3>
              <p className="text-sm text-gray-400 leading-relaxed mb-4">
                {t('home.diff.stackDesc')}
              </p>
              <span className="text-sm text-emerald-400 group-hover:text-emerald-300 transition-colors">
                {t('home.diff.stackLink')}
              </span>
            </Link>

            <div className="p-8 rounded-2xl bg-white/[0.03] border border-white/5">
              <div className="w-12 h-12 rounded-xl bg-teal-950/50 border border-teal-800/30 flex items-center justify-center text-teal-400 mb-5">
                <Globe className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">{t('home.diff.localTitle')}</h3>
              <p className="text-sm text-gray-400 leading-relaxed">
                {t('home.diff.localDesc')}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Band */}
      <section className="py-20 sm:py-28">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-display font-bold text-white mb-4">
            {t('home.ctaBand.title')}
          </h2>
          <p className="text-gray-400 mb-8">
            {t('home.ctaBand.desc')}
          </p>
          <a
            href="/app/"
            className="inline-flex items-center gap-2 px-8 py-4 text-base font-semibold text-white bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 rounded-xl shadow-lg shadow-emerald-500/25 transition-all"
          >
            {t('home.ctaBand.button')}
            <ArrowRight className="w-4 h-4" />
          </a>
          <p className="mt-4 text-sm text-gray-500">
            {t('home.ctaBand.downloadNote')}{' '}
            <Link href="/download" className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2">
              {t('home.ctaBand.downloadLink')}
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}
