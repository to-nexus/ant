'use client';

import type { ReactNode } from 'react';
import { Star, Users, Code2, Cpu } from 'lucide-react';
import { githubStats } from '@/lib/githubStats';
import { GITHUB_URL } from '@/lib/links';

function format(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

interface Stat {
  icon: ReactNode;
  value: string;
  label: string;
  href?: string;
}

interface StatsStripProps {
  starsLabel: string;
  contributorsLabel: string;
  languagesLabel: string;
  llmLabel: string;
}

export function StatsStrip({ starsLabel, contributorsLabel, languagesLabel, llmLabel }: StatsStripProps) {
  const stats: Stat[] = [
    { icon: <Star className="w-4 h-4" />, value: format(githubStats.stars), label: starsLabel, href: GITHUB_URL },
    { icon: <Users className="w-4 h-4" />, value: String(githubStats.contributorsCount || 0), label: contributorsLabel, href: `${GITHUB_URL}/graphs/contributors` },
    { icon: <Code2 className="w-4 h-4" />, value: '5+', label: languagesLabel, href: '/capabilities' },
    { icon: <Cpu className="w-4 h-4" />, value: '4+', label: llmLabel },
  ];

  return (
    <section className="py-10">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          {stats.map((s, i) => {
            const inner = (
              <>
                <div className="flex items-center gap-2 text-emerald-400 mb-1.5">
                  {s.icon}
                  <span className="text-xl font-display font-bold text-white">{s.value}</span>
                </div>
                <span className="text-xs text-gray-500 uppercase tracking-wider">{s.label}</span>
              </>
            );
            const cls = 'flex flex-col p-4 rounded-xl bg-white/[0.03] border border-white/5 hover:border-white/10 transition-colors';
            return s.href ? (
              <a key={i} href={s.href} target={s.href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer" className={cls}>
                {inner}
              </a>
            ) : (
              <div key={i} className={cls}>
                {inner}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
