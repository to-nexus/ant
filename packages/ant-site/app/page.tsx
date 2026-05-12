'use client';

import {
  ArrowRight,
  FileText,
  Palette,
  Code2,
  Eye,
  Layers,
  Zap,
  Cpu,
  Server,
  Globe,
  Github,
  PlayCircle,
  MessageSquare,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { StarfieldCanvas, FloatingOrbs } from '@/components/HeroEffects';
import { GitHubStarsBadge } from '@/components/GitHubStarsBadge';
import { QuickstartTabs } from '@/components/QuickstartTabs';
import { SelfHostCloudSplit } from '@/components/SelfHostCloudSplit';
import { ContributorsWall } from '@/components/ContributorsWall';
import { RecentActivity } from '@/components/RecentActivity';
import { FaqList } from '@/components/FaqList';
import { GITHUB_DISCUSSIONS_URL, DOCS_URL } from '@/lib/links';

interface FeatureItem {
  icon: typeof Zap;
  titleKey: string;
  descKey: string;
}

const FEATURES: FeatureItem[] = [
  { icon: Layers, titleKey: 'multiAgentTitle', descKey: 'multiAgentDesc' },
  { icon: Zap, titleKey: 'parallelTitle', descKey: 'parallelDesc' },
  { icon: Palette, titleKey: 'figmaTitle', descKey: 'figmaDesc' },
  { icon: Cpu, titleKey: 'stackTitle', descKey: 'stackDesc' },
  { icon: Server, titleKey: 'selfHostTitle', descKey: 'selfHostDesc' },
  { icon: Globe, titleKey: 'localTitle', descKey: 'localDesc' },
];

interface FaqEntry {
  q: string;
  a: string;
}

export default function HomePage() {
  const { t } = useTranslation('site');
  const faqItems = t('home.faq.items', { returnObjects: true }) as FaqEntry[];

  return (
    <>
      {/* §1 Hero */}
      <section className="relative pt-32 pb-16 sm:pt-40 sm:pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-950/20 via-transparent to-transparent" />
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
        <FloatingOrbs />
        <div className="absolute inset-0">
          <StarfieldCanvas />
        </div>

        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="animate-fade-in-up">
            <div className="inline-flex items-center gap-3 mb-8">
              <img src="/logo.png" alt="ANT" className="w-14 h-14 sm:w-16 sm:h-16 drop-shadow-[0_0_24px_rgba(16,185,129,0.15)]" />
              <span className="text-xl sm:text-2xl font-display font-bold text-white tracking-tight">
                ANT
              </span>
            </div>

            <p className="text-sm font-mono text-emerald-400/80 mb-4 tracking-wider uppercase">
              {t('home.tagline')}
            </p>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-display font-bold text-white leading-tight mb-6">
              {t('home.title1')}
              <br />
              <span className="text-gradient">{t('home.title2')}</span>
            </h1>

            <p className="text-lg sm:text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
              {t('home.desc')}
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <GitHubStarsBadge variant="full" />
              <a
                href="#quickstart"
                className="group inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-gray-300 hover:text-white border border-white/10 hover:border-white/20 hover:bg-white/5 rounded-xl transition-all"
              >
                <PlayCircle className="w-4 h-4" />
                {t('home.ctaQuickstart')}
              </a>
              <a
                href={DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-gray-400 hover:text-white transition-colors"
              >
                {t('home.ctaDocs')}
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* §2 Quickstart */}
      <QuickstartTabs title={t('home.quickstart.title')} description={t('home.quickstart.desc')} />

      {/* §3 Workflow */}
      <section className="py-16 sm:py-24 bg-gradient-to-b from-transparent via-emerald-950/5 to-transparent">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-display font-bold text-white mb-3">
              {t('home.workflow.title')}
            </h2>
            <p className="text-gray-400 max-w-xl mx-auto">{t('home.workflow.desc')}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { step: '1', title: t('home.workflow.step1Title'), agent: t('home.workflow.step1Agent'), icon: <FileText className="w-5 h-5" />, desc: t('home.workflow.step1Desc') },
              { step: '2', title: t('home.workflow.step2Title'), agent: t('home.workflow.step2Agent'), icon: <Palette className="w-5 h-5" />, desc: t('home.workflow.step2Desc') },
              { step: '3', title: t('home.workflow.step3Title'), agent: t('home.workflow.step3Agent'), icon: <Code2 className="w-5 h-5" />, desc: t('home.workflow.step3Desc') },
              { step: '4', title: t('home.workflow.step4Title'), agent: t('home.workflow.step4Agent'), icon: <Eye className="w-5 h-5" />, desc: t('home.workflow.step4Desc') },
            ].map((item, i) => (
              <div
                key={item.step}
                className="relative p-6 rounded-2xl bg-white/[0.03] border border-white/5 hover:border-emerald-800/30 hover:bg-white/[0.05] transition-all animate-fade-in-up"
                style={{ animationDelay: `${i * 0.1}s` }}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 rounded-lg bg-emerald-950/50 border border-emerald-800/30 flex items-center justify-center text-emerald-400">
                    {item.icon}
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-500 font-mono uppercase tracking-wider">{item.agent}</div>
                    <div className="text-base font-semibold text-white">{item.title}</div>
                  </div>
                </div>
                <p className="text-sm text-gray-400 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* §4 Feature grid */}
      <section className="py-16 sm:py-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl sm:text-4xl font-display font-bold text-white text-center mb-12">
            {t('home.features.title')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.titleKey} className="p-6 rounded-2xl bg-white/[0.03] border border-white/5 hover:border-white/10 transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-emerald-950/50 border border-emerald-800/30 flex items-center justify-center text-emerald-400 mb-4">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="text-base font-semibold text-white mb-2">{t(`home.features.${f.titleKey}`)}</h3>
                  <p className="text-sm text-gray-400 leading-relaxed">{t(`home.features.${f.descKey}`)}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* §5 Demo */}
      <section className="py-16 sm:py-20 bg-gradient-to-b from-transparent via-emerald-950/5 to-transparent">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-display font-bold text-white mb-3">{t('home.demo.title')}</h2>
          <p className="text-sm text-gray-400 mb-8">{t('home.demo.desc')}</p>
          <div className="aspect-video rounded-2xl bg-[#0d1117] border border-white/10 flex items-center justify-center overflow-hidden">
            <div className="flex items-center gap-3 text-gray-600">
              <PlayCircle className="w-10 h-10" />
              <span className="text-sm font-mono">demo coming soon</span>
            </div>
          </div>
        </div>
      </section>

      {/* §6 Self-host vs Cloud */}
      <SelfHostCloudSplit
        title={t('home.split.title')}
        description={t('home.split.desc')}
        selfHost={{
          title: t('home.split.selfHostTitle'),
          tagline: t('home.split.selfHostTagline'),
          bullets: [
            t('home.split.selfHostBullet1'),
            t('home.split.selfHostBullet2'),
            t('home.split.selfHostBullet3'),
            t('home.split.selfHostBullet4'),
          ],
          ctaLabel: t('home.split.selfHostCta'),
          ctaHref: '/self-host',
        }}
        cloud={{
          title: t('home.split.cloudTitle'),
          tagline: t('home.split.cloudTagline'),
          bullets: [
            t('home.split.cloudBullet1'),
            t('home.split.cloudBullet2'),
            t('home.split.cloudBullet3'),
            t('home.split.cloudBullet4'),
          ],
          ctaLabel: t('home.split.cloudCta'),
          ctaHref: '/cloud',
        }}
      />

      {/* §7 Community velocity */}
      <section className="py-20 sm:py-24 bg-gradient-to-b from-transparent via-emerald-950/5 to-transparent">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-display font-bold text-white mb-3">
              {t('home.community.title')}
            </h2>
            <p className="text-sm text-gray-400 max-w-xl mx-auto">{t('home.community.desc')}</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
            <div className="lg:col-span-1">
              <ContributorsWall
                title={t('home.community.contributors')}
                emptyLabel={t('home.community.contributorsEmpty')}
                limit={24}
              />
            </div>
            <div className="lg:col-span-2">
              <RecentActivity
                prTitle={t('home.community.recentPRs')}
                issueTitle={t('home.community.recentIssues')}
                emptyLabel={t('home.community.activityEmpty')}
              />
            </div>
          </div>
        </div>
      </section>

      {/* §8 FAQ */}
      <FaqList title={t('home.faq.title')} items={faqItems} />

      {/* §9 Final CTA band */}
      <section className="py-20 sm:py-28">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-display font-bold text-white mb-4">
            {t('home.ctaBand.title')}
          </h2>
          <p className="text-gray-400 mb-8">{t('home.ctaBand.desc')}</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <GitHubStarsBadge variant="full" />
            <Link
              href="#quickstart"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-gray-300 hover:text-white border border-white/10 hover:border-white/20 hover:bg-white/5 rounded-xl transition-all"
            >
              <Github className="w-4 h-4" />
              Install
            </Link>
            <a
              href={GITHUB_DISCUSSIONS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-gray-300 hover:text-white border border-white/10 hover:border-white/20 hover:bg-white/5 rounded-xl transition-all"
            >
              <MessageSquare className="w-4 h-4" />
              {t('home.ctaBand.openDiscussion')}
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
