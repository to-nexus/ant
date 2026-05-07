'use client';

import { useTranslation } from 'react-i18next';
import { ArrowRight, MessageSquare, ExternalLink, Sparkles, Map } from 'lucide-react';
import { PageHero } from '@/components/PageHero';
import { RecentActivity } from '@/components/RecentActivity';
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
        accent="emerald"
      >
        <a
          href={GITHUB_DISCUSSIONS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="group inline-flex items-center gap-2 px-6 py-3 text-base font-semibold text-white bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 rounded-xl shadow-lg shadow-emerald-500/25 transition-all"
        >
          <MessageSquare className="w-4 h-4" />
          {t('community.primaryCta')}
          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </a>
      </PageHero>

      {/* Discussions */}
      <section className="py-16 sm:py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-display font-bold text-white mb-3">{t('community.discussionsTitle')}</h2>
            <p className="text-sm text-gray-400 max-w-2xl mx-auto">{t('community.discussionsDesc')}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {categories.map((cat) => (
              <div key={cat.name} className="p-5 rounded-xl bg-white/[0.03] border border-white/5">
                <h3 className="text-sm font-semibold text-emerald-300 mb-2">{cat.name}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{cat.desc}</p>
              </div>
            ))}
          </div>

          <p className="mt-8 text-center text-sm text-gray-500 italic">{t('community.responseNote')}</p>
        </div>
      </section>

      {/* Recent activity */}
      <section className="py-16 sm:py-24 bg-gradient-to-b from-transparent via-emerald-950/5 to-transparent">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-display font-bold text-white mb-3">{t('community.activityTitle')}</h2>
            <p className="text-sm text-gray-400">{t('community.activityDesc')}</p>
          </div>
          <RecentActivity
            prTitle={t('home.community.recentPRs')}
            issueTitle={t('home.community.recentIssues')}
            emptyLabel={t('home.community.activityEmpty')}
          />
        </div>
      </section>

      {/* Good first issues */}
      <section className="py-16 sm:py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 mb-3">
              <Sparkles className="w-5 h-5 text-amber-400" />
              <h2 className="text-2xl sm:text-3xl font-display font-bold text-white">{t('community.goodFirstTitle')}</h2>
            </div>
            <p className="text-sm text-gray-400">{t('community.goodFirstDesc')}</p>
          </div>

          {goodFirst.length === 0 ? (
            <p className="text-center text-sm text-gray-500 py-8">{t('community.goodFirstEmpty')}</p>
          ) : (
            <div className="space-y-2 mb-6">
              {goodFirst.map((item) => (
                <a
                  key={item.htmlUrl}
                  href={item.htmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-start gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/5 hover:border-amber-800/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-200 group-hover:text-white truncate">{item.title}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      #{item.number} · {item.author}
                    </p>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-gray-600 group-hover:text-gray-400 shrink-0 mt-1" />
                </a>
              ))}
            </div>
          )}

          <div className="text-center">
            <a
              href={GITHUB_GOOD_FIRST_ISSUES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              {t('community.goodFirstCta')}
            </a>
          </div>
        </div>
      </section>

      {/* Roadmap */}
      <section className="py-16 sm:py-20 bg-gradient-to-b from-transparent via-emerald-950/5 to-transparent">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 mb-4">
            <Map className="w-5 h-5 text-emerald-400" />
            <h2 className="text-2xl font-display font-bold text-white">{t('community.roadmapTitle')}</h2>
          </div>
          <p className="text-sm text-gray-400 leading-relaxed mb-8 max-w-xl mx-auto">{t('community.roadmapDesc')}</p>
          <a
            href={GITHUB_ROADMAP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 hover:border-emerald-500/50 rounded-xl transition-colors"
          >
            {t('community.roadmapCta')}
          </a>
        </div>
      </section>
    </>
  );
}
