'use client';

import Link from 'next/link';
import { ArrowRight, Server, Cloud } from 'lucide-react';

interface SplitColumn {
  title: string;
  tagline: string;
  bullets: string[];
  ctaLabel: string;
  ctaHref: string;
}

interface SelfHostCloudSplitProps {
  title: string;
  description?: string;
  selfHost: SplitColumn;
  cloud: SplitColumn;
}

function Column({ icon, column, accent }: { icon: typeof Server; column: SplitColumn; accent: 'emerald' | 'teal' }) {
  const Icon = icon;
  const accentBg = accent === 'emerald' ? 'bg-emerald-950/40 border-emerald-800/40 text-emerald-300' : 'bg-teal-950/40 border-teal-800/40 text-teal-300';
  const ctaBg = accent === 'emerald' ? 'bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 hover:border-emerald-500/50 text-emerald-300' : 'bg-teal-500/10 hover:bg-teal-500/20 border-teal-500/30 hover:border-teal-500/50 text-teal-300';

  return (
    <div className="flex flex-col p-8 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-white/20 transition-colors">
      <div className={`w-12 h-12 rounded-xl border flex items-center justify-center mb-5 ${accentBg}`}>
        <Icon className="w-6 h-6" />
      </div>
      <h3 className="text-xl font-semibold text-white mb-2">{column.title}</h3>
      <p className="text-sm text-gray-400 mb-6 leading-relaxed">{column.tagline}</p>
      <ul className="space-y-2 mb-8 flex-1">
        {column.bullets.map((b, i) => (
          <li key={i} className="text-sm text-gray-400 flex items-start gap-2">
            <span className="shrink-0 mt-1.5 w-1 h-1 rounded-full bg-gray-600" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <Link
        href={column.ctaHref}
        className={`group inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-medium border rounded-xl transition-all ${ctaBg}`}
      >
        {column.ctaLabel}
        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
      </Link>
    </div>
  );
}

export function SelfHostCloudSplit({ title, description, selfHost, cloud }: SelfHostCloudSplitProps) {
  return (
    <section className="py-20 sm:py-28">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-display font-bold text-white mb-4">{title}</h2>
          {description && <p className="text-gray-400 max-w-2xl mx-auto">{description}</p>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Column icon={Server} column={selfHost} accent="emerald" />
          <Column icon={Cloud} column={cloud} accent="teal" />
        </div>
      </div>
    </section>
  );
}
