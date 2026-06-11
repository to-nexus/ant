'use client';

import { useTranslation } from 'react-i18next';
import { ArrowRight, MessageSquare, ExternalLink, Sparkles, Map } from 'lucide-react';
import { PageHero } from '@/components/PageHero';
import { RecentActivity } from '@/components/RecentActivity';
import { GlassCard } from '@/components/aurora/GlassCard';
import { AuroraButton } from '@/components/aurora/AuroraButton';
import { SectionHeading } from '@/components/aurora/SectionHeading';
import { IconOrb } from '@/components/aurora/IconOrb';
import { Reveal } from '@/components/aurora/Reveal';
import { githubStats } from '@/lib/githubStats';
import { GITHUB_DISCUSSIONS_URL, GITHUB_GOOD_FIRST_ISSUES_URL, GITHUB_ROADMAP_URL } from '@/lib/links';

interface Category {
  name: string;
  desc: string;
}

export default function CommunityContent() {
  const { t } = useTranslation('site');
  const categories = t('community.categories', { returnObjects: true }) as Category[];
  const goodFirst = githubStats.goodFirstIssues;

  return (
    <>
      <PageHero
        title={t('community.heroTitle')}
        highlight={t('community.heroHighlight')}
        description={t('community.heroDesc')}
        accent="purple"
      >
        <AuroraButton href={GITHUB_DISCUSSIONS_URL} external size="lg">
          <MessageSquare className="w-4 h-4" />
          {t('community.primaryCta')}
          <ArrowRight className="w-4 h-4" />
        </AuroraButton>
      </PageHero>

      {/* Discussions */}
      <section className="py-16 sm:py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="flex justify-center mb-10">
              <SectionHeading title={t('community.discussionsTitle')} subtitle={t('community.discussionsDesc')} />
            </div>
          </Reveal>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {categories.map((cat, i) => (
              <Reveal key={cat.name} delay={(i % 2) * 0.08}>
                <GlassCard hoverable padding="md" style={{ height: '100%' }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--violet-300)', marginBottom: 8 }}>{cat.name}</h3>
                  <p style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 'var(--lh-relaxed)' }}>{cat.desc}</p>
                </GlassCard>
              </Reveal>
            ))}
          </div>

          <p className="mt-8 text-center" style={{ fontSize: 14, color: 'var(--text-4)', fontStyle: 'italic' }}>
            {t('community.responseNote')}
          </p>
        </div>
      </section>

      {/* Recent activity */}
      <section className="py-16 sm:py-24">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="flex justify-center mb-10">
              <SectionHeading title={t('community.activityTitle')} subtitle={t('community.activityDesc')} />
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <GlassCard padding="lg">
              <RecentActivity
                prTitle={t('home.community.recentPRs')}
                issueTitle={t('home.community.recentIssues')}
                emptyLabel={t('home.community.activityEmpty')}
              />
            </GlassCard>
          </Reveal>
        </div>
      </section>

      {/* Good first issues */}
      <section className="py-16 sm:py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="text-center mb-10 flex flex-col items-center gap-3">
              <IconOrb tone="orange" size={44}>
                <Sparkles className="w-5 h-5" />
              </IconOrb>
              <SectionHeading title={t('community.goodFirstTitle')} subtitle={t('community.goodFirstDesc')} />
            </div>
          </Reveal>

          {goodFirst.length === 0 ? (
            <p className="text-center" style={{ fontSize: 14, color: 'var(--text-4)', padding: '32px 0' }}>
              {t('community.goodFirstEmpty')}
            </p>
          ) : (
            <div className="space-y-2 mb-6">
              {goodFirst.map((item) => (
                <a
                  key={item.htmlUrl}
                  href={item.htmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-start gap-3 transition-colors"
                  style={{ padding: '16px', borderRadius: 'var(--r-lg)', background: 'var(--bg-surface)', border: '1px solid var(--border-1)' }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="truncate" style={{ fontSize: 14, color: 'var(--text-2)' }}>{item.title}</p>
                    <p className="mt-1" style={{ fontSize: 12, color: 'var(--text-4)' }}>
                      #{item.number} · {item.author}
                    </p>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 shrink-0 mt-1" style={{ color: 'var(--text-4)' }} />
                </a>
              ))}
            </div>
          )}

          <div className="text-center">
            <a
              href={GITHUB_GOOD_FIRST_ISSUES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 transition-colors"
              style={{ fontSize: 14, color: 'var(--violet-300)' }}
            >
              {t('community.goodFirstCta')}
            </a>
          </div>
        </div>
      </section>

      {/* Roadmap */}
      <section className="py-16 sm:py-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <Reveal>
            <div className="flex justify-center mb-4">
              <IconOrb tone="teal" size={44}>
                <Map className="w-5 h-5" />
              </IconOrb>
            </div>
            <h2 className="text-display" style={{ fontSize: 26, color: 'var(--text-1)', marginBottom: 14 }}>{t('community.roadmapTitle')}</h2>
            <p style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 'var(--lh-relaxed)', marginBottom: 28, maxWidth: 520, marginLeft: 'auto', marginRight: 'auto' }}>
              {t('community.roadmapDesc')}
            </p>
            <AuroraButton href={GITHUB_ROADMAP_URL} external variant="secondary">
              {t('community.roadmapCta')}
            </AuroraButton>
          </Reveal>
        </div>
      </section>
    </>
  );
}
