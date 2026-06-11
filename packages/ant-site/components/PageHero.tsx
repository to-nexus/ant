'use client';

import type { ReactNode } from 'react';

// Accent names are preserved so all *Content.tsx callers stay unchanged;
// each maps to an aurora gradient + a hue for the ambient hero halo.
type Accent = 'emerald' | 'purple' | 'blue' | 'teal' | 'amber';

const ACCENT_GRADIENT: Record<Accent, string> = {
  emerald: 'var(--gradient-cool)',
  purple: 'var(--gradient-violet-pink)',
  blue: 'var(--gradient-cool)',
  teal: 'var(--gradient-cool)',
  amber: 'var(--gradient-sunset)',
};

const ACCENT_HUE: Record<Accent, number> = {
  emerald: 195,
  purple: 290,
  blue: 230,
  teal: 195,
  amber: 50,
};

interface PageHeroProps {
  title: string;
  highlight?: string;
  trailing?: string;
  description?: string;
  accent?: Accent;
  children?: ReactNode;
}

export function PageHero({ title, highlight, trailing, description, accent = 'purple', children }: PageHeroProps) {
  return (
    <section className="relative pt-32 pb-16 sm:pt-40 sm:pb-24 overflow-hidden">
      {/* Ambient hero halo */}
      <div
        aria-hidden
        className="gradient-flow"
        style={{
          position: 'absolute',
          top: '-10%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(900px, 90vw)',
          height: 420,
          background: `radial-gradient(ellipse at center, oklch(60% 0.24 ${ACCENT_HUE[accent]} / 0.30) 0%, transparent 70%)`,
          filter: 'blur(50px)',
          pointerEvents: 'none',
        }}
      />
      <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <div className="spring-in">
          <h1
            className="text-display"
            style={{ fontSize: 'clamp(36px, 6vw, 56px)', color: 'var(--text-1)', lineHeight: 1.1, marginBottom: 20 }}
          >
            {title}
            {highlight && (
              <>
                {' '}
                <span className="text-gradient" style={{ background: ACCENT_GRADIENT[accent] }}>
                  {highlight}
                </span>
              </>
            )}
            {trailing && ` ${trailing}`}
          </h1>
          {description && (
            <p
              style={{
                fontSize: 18,
                color: 'var(--text-3)',
                maxWidth: 640,
                margin: '0 auto',
                lineHeight: 'var(--lh-relaxed)',
              }}
            >
              {description}
            </p>
          )}
          {children && <div className="mt-10">{children}</div>}
        </div>
      </div>
    </section>
  );
}
