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
  MessageSquare,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GitHubStarsBadge } from '@/components/GitHubStarsBadge';
import { QuickstartTabs } from '@/components/QuickstartTabs';
import { SelfHostCloudSplit } from '@/components/SelfHostCloudSplit';
import { ContributorsWall } from '@/components/ContributorsWall';
import { RecentActivity } from '@/components/RecentActivity';
import { FaqList } from '@/components/FaqList';
import { BrandLogo } from '@/components/aurora/BrandLogo';
import { AuroraButton } from '@/components/aurora/AuroraButton';
import { GlassCard } from '@/components/aurora/GlassCard';
import { SectionHeading } from '@/components/aurora/SectionHeading';
import { IconOrb } from '@/components/aurora/IconOrb';
import { Reveal } from '@/components/aurora/Reveal';
import type { IconOrbTone } from '@/components/aurora/IconOrb';
import { useAuthSession, getAppEntryUrl } from '@/lib/AuthSessionProvider';
import { GITHUB_DISCUSSIONS_URL, DOCS_URL } from '@/lib/links';

interface FeatureItem {
  icon: typeof Zap;
  titleKey: string;
  descKey: string;
  tone: IconOrbTone;
}

const FEATURES: FeatureItem[] = [
  { icon: Layers, titleKey: 'multiAgentTitle', descKey: 'multiAgentDesc', tone: 'violet' },
  { icon: Zap, titleKey: 'parallelTitle', descKey: 'parallelDesc', tone: 'pink' },
  { icon: Palette, titleKey: 'figmaTitle', descKey: 'figmaDesc', tone: 'orange' },
  { icon: Cpu, titleKey: 'stackTitle', descKey: 'stackDesc', tone: 'teal' },
  { icon: Server, titleKey: 'selfHostTitle', descKey: 'selfHostDesc', tone: 'violet' },
  { icon: Globe, titleKey: 'localTitle', descKey: 'localDesc', tone: 'emerald' },
];

const WORKFLOW: { icon: typeof FileText; tone: IconOrbTone; key: string }[] = [
  { icon: FileText, tone: 'violet', key: 'step1' },
  { icon: Palette, tone: 'pink', key: 'step2' },
  { icon: Code2, tone: 'orange', key: 'step3' },
  { icon: Eye, tone: 'teal', key: 'step4' },
];

interface FaqEntry {
  q: string;
  a: string;
}

export default function HomePage() {
  const { t } = useTranslation('site');
  const { user } = useAuthSession();
  const faqItems = t('home.faq.items', { returnObjects: true }) as FaqEntry[];
  const appHref = getAppEntryUrl(user);

  return (
    <>
      {/* §1 Hero */}
      <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-24 overflow-hidden">
        {/* Ambient hero halo */}
        <div
          aria-hidden
          className="gradient-flow"
          style={{
            position: 'absolute',
            top: '-8%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'min(820px, 92vw)',
            height: 440,
            background: 'var(--gradient-aurora)',
            backgroundSize: '200% 200%',
            borderRadius: '50%',
            filter: 'blur(110px)',
            opacity: 0.28,
            pointerEvents: 'none',
          }}
        />

        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="spring-in flex justify-center mb-7">
            <BrandLogo size={56} showWord={false} />
          </div>

          <p
            className="text-mono spring-in"
            style={{ fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 18 }}
          >
            {t('home.tagline')}
          </p>

          <h1
            className="text-display spring-in"
            style={{ fontSize: 'clamp(40px, 7vw, 68px)', color: 'var(--text-1)', lineHeight: 1.05, marginBottom: 22 }}
          >
            {t('home.title1')}
            <br />
            <span className="text-gradient">{t('home.title2')}</span>
          </h1>

          <p
            className="spring-in"
            style={{ fontSize: 19, color: 'var(--text-3)', maxWidth: 600, margin: '0 auto 36px', lineHeight: 'var(--lh-relaxed)' }}
          >
            {t('home.desc')}
          </p>

          <div className="spring-in flex flex-col sm:flex-row items-center justify-center gap-3">
            <AuroraButton href={appHref} external size="lg">
              {user ? t('nav.goToApp') : t('nav.getStarted')}
              <ArrowRight className="w-4 h-4" />
            </AuroraButton>
            <AuroraButton href="#quickstart" variant="secondary" size="lg">
              {t('home.ctaQuickstart')}
            </AuroraButton>
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm transition-colors"
              style={{ color: 'var(--text-3)' }}
            >
              {t('home.ctaDocs')}
              <ArrowRight className="w-4 h-4" />
            </a>
          </div>

          <div className="spring-in flex justify-center mt-7">
            <GitHubStarsBadge variant="full" />
          </div>

          {/* Glass workflow visual — the actual product loop, no fake screenshots */}
          <Reveal delay={0.15} className="mt-16">
            <GlassCard glow padding="lg" className="max-w-3xl mx-auto">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-5">
                {WORKFLOW.map((step, i) => {
                  const Icon = step.icon;
                  return (
                    <div key={step.key} className="flex flex-col items-center text-center gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-mono" style={{ fontSize: 11, color: 'var(--text-4)' }}>
                          0{i + 1}
                        </span>
                        <IconOrb tone={step.tone} size={44}>
                          <Icon className="w-5 h-5" />
                        </IconOrb>
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>
                          {t(`home.workflow.${step.key}Title`)}
                        </div>
                        <div className="text-mono" style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                          {t(`home.workflow.${step.key}Agent`)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </GlassCard>
          </Reveal>
        </div>
      </section>

      {/* §2 Quickstart */}
      <section id="quickstart" className="py-16 sm:py-24 scroll-mt-20">
        <Reveal>
          <QuickstartTabs title={t('home.quickstart.title')} description={t('home.quickstart.desc')} />
        </Reveal>
      </section>

      {/* §3 Workflow */}
      <section className="py-16 sm:py-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="flex justify-center mb-14">
              <SectionHeading title={t('home.workflow.title')} subtitle={t('home.workflow.desc')} />
            </div>
          </Reveal>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {WORKFLOW.map((step, i) => {
              const Icon = step.icon;
              return (
                <Reveal key={step.key} delay={i * 0.08}>
                  <GlassCard hoverable padding="lg">
                    <div className="flex items-center gap-3 mb-4">
                      <IconOrb tone={step.tone} size={40}>
                        <Icon className="w-5 h-5" />
                      </IconOrb>
                      <div>
                        <div className="text-mono" style={{ fontSize: 10, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                          {t(`home.workflow.${step.key}Agent`)}
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-1)' }}>
                          {t(`home.workflow.${step.key}Title`)}
                        </div>
                      </div>
                    </div>
                    <p style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 'var(--lh-relaxed)' }}>
                      {t(`home.workflow.${step.key}Desc`)}
                    </p>
                  </GlassCard>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* §4 Features */}
      <section className="py-16 sm:py-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="flex justify-center mb-12">
              <SectionHeading title={t('home.features.title')} />
            </div>
          </Reveal>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f, i) => {
              const Icon = f.icon;
              return (
                <Reveal key={f.titleKey} delay={(i % 3) * 0.08}>
                  <GlassCard hoverable padding="lg" style={{ height: '100%' }}>
                    <IconOrb tone={f.tone} size={44} style={{ marginBottom: 16 }}>
                      <Icon className="w-5 h-5" />
                    </IconOrb>
                    <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-1)', marginBottom: 8 }}>
                      {t(`home.features.${f.titleKey}`)}
                    </h3>
                    <p style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 'var(--lh-relaxed)' }}>
                      {t(`home.features.${f.descKey}`)}
                    </p>
                  </GlassCard>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* §5 Self-host vs Cloud */}
      <Reveal>
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
              t('home.split.cloudBullet5'),
            ],
            ctaLabel: t('home.split.cloudCta'),
            ctaHref: '/cloud',
          }}
        />
      </Reveal>

      {/* §6 Community velocity */}
      <section className="py-20 sm:py-24">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="flex justify-center mb-12">
              <SectionHeading title={t('home.community.title')} subtitle={t('home.community.desc')} />
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <GlassCard padding="lg">
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
            </GlassCard>
          </Reveal>
        </div>
      </section>

      {/* §7 Demo (honest placeholder, demoted below community) */}
      <section className="py-12 sm:py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <Reveal>
            <h2 className="text-display" style={{ fontSize: 26, color: 'var(--text-1)', marginBottom: 8 }}>
              {t('home.demo.title')}
            </h2>
            <p style={{ fontSize: 14, color: 'var(--text-3)', marginBottom: 28 }}>{t('home.demo.desc')}</p>
            <GlassCard padding="none">
              <div
                className="flex items-center justify-center"
                style={{ aspectRatio: '16 / 9', borderRadius: 'var(--r-2xl)', overflow: 'hidden' }}
              >
                <div className="flex items-center gap-3 text-mono" style={{ color: 'var(--text-4)', fontSize: 13 }}>
                  <Eye className="w-5 h-5" />
                  demo coming soon
                </div>
              </div>
            </GlassCard>
          </Reveal>
        </div>
      </section>

      {/* §8 FAQ */}
      <Reveal>
        <FaqList title={t('home.faq.title')} items={faqItems} />
      </Reveal>

      {/* §9 Final CTA band */}
      <section className="py-20 sm:py-28">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <GlassCard glow gradient="none" padding="xl" style={{ border: '1px solid var(--border-brand)' }}>
              <div className="text-center flex flex-col items-center">
                <h2 className="text-display" style={{ fontSize: 'clamp(26px, 4vw, 36px)', color: 'var(--text-1)', marginBottom: 14 }}>
                  {t('home.ctaBand.title')}
                </h2>
                <p style={{ fontSize: 16, color: 'var(--text-3)', maxWidth: 520, marginBottom: 28, lineHeight: 'var(--lh-relaxed)' }}>
                  {t('home.ctaBand.desc')}
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                  <AuroraButton href={appHref} external size="lg">
                    {user ? t('nav.goToApp') : t('nav.getStarted')}
                    <ArrowRight className="w-4 h-4" />
                  </AuroraButton>
                  <AuroraButton href={GITHUB_DISCUSSIONS_URL} external variant="secondary" size="lg">
                    <MessageSquare className="w-4 h-4" />
                    {t('home.ctaBand.openDiscussion')}
                  </AuroraButton>
                </div>
              </div>
            </GlassCard>
          </Reveal>
        </div>
      </section>
    </>
  );
}
