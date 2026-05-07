'use client';

import type { ReactNode } from 'react';

type Accent = 'emerald' | 'purple' | 'blue' | 'teal' | 'amber';

const ACCENT_BG: Record<Accent, string> = {
  emerald: 'from-emerald-950/20',
  purple: 'from-purple-950/20',
  blue: 'from-blue-950/20',
  teal: 'from-teal-950/20',
  amber: 'from-amber-950/20',
};

const ACCENT_GRADIENT: Record<Accent, string> = {
  emerald: 'from-emerald-400 to-teal-300',
  purple: 'from-purple-400 to-fuchsia-300',
  blue: 'from-blue-400 to-cyan-300',
  teal: 'from-teal-400 to-cyan-300',
  amber: 'from-amber-400 to-orange-300',
};

interface PageHeroProps {
  title: string;
  highlight?: string;
  trailing?: string;
  description?: string;
  accent?: Accent;
  children?: ReactNode;
}

export function PageHero({ title, highlight, trailing, description, accent = 'emerald', children }: PageHeroProps) {
  return (
    <section className="relative pt-32 pb-16 sm:pt-40 sm:pb-24 overflow-hidden">
      <div className={`absolute inset-0 bg-gradient-to-b ${ACCENT_BG[accent]} via-transparent to-transparent`} />
      <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <div className="animate-fade-in-up">
          <h1 className="text-4xl sm:text-5xl font-display font-bold text-white leading-tight mb-6">
            {title}
            {highlight && (
              <>
                {' '}
                <span className={`bg-clip-text text-transparent bg-gradient-to-r ${ACCENT_GRADIENT[accent]}`}>
                  {highlight}
                </span>
              </>
            )}
            {trailing && ` ${trailing}`}
          </h1>
          {description && (
            <p className="text-lg text-gray-400 max-w-2xl mx-auto leading-relaxed">{description}</p>
          )}
          {children && <div className="mt-10">{children}</div>}
        </div>
      </div>
    </section>
  );
}
