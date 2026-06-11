'use client';

import { ArrowRight, Server, Cloud } from 'lucide-react';
import { GlassCard } from '@/components/aurora/GlassCard';
import { AuroraButton } from '@/components/aurora/AuroraButton';
import { IconOrb } from '@/components/aurora/IconOrb';
import type { IconOrbTone } from '@/components/aurora/IconOrb';

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

function Column({
  icon: Icon,
  column,
  tone,
  dotHue,
}: {
  icon: typeof Server;
  column: SplitColumn;
  tone: IconOrbTone;
  dotHue: number;
}) {
  return (
    <GlassCard hoverable padding="lg">
      <div className="flex flex-col h-full">
        <IconOrb tone={tone} size={52} style={{ marginBottom: 20 }}>
          <Icon className="w-6 h-6" />
        </IconOrb>
        <h3 className="text-display" style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-1)', marginBottom: 8 }}>
          {column.title}
        </h3>
        <p style={{ fontSize: 14, color: 'var(--text-3)', marginBottom: 24, lineHeight: 'var(--lh-relaxed)' }}>
          {column.tagline}
        </p>
        <ul className="space-y-2.5 flex-1" style={{ marginBottom: 28 }}>
          {column.bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2.5" style={{ fontSize: 14, color: 'var(--text-2)' }}>
              <span
                aria-hidden
                className="shrink-0"
                style={{ marginTop: 7, width: 6, height: 6, borderRadius: '50%', background: `oklch(70% 0.18 ${dotHue})` }}
              />
              <span>{b}</span>
            </li>
          ))}
        </ul>
        <AuroraButton href={column.ctaHref} variant="secondary">
          {column.ctaLabel}
          <ArrowRight className="w-4 h-4" />
        </AuroraButton>
      </div>
    </GlassCard>
  );
}

export function SelfHostCloudSplit({ title, description, selfHost, cloud }: SelfHostCloudSplitProps) {
  return (
    <section className="py-20 sm:py-28">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-center mb-12">
          <div className="text-center">
            <h2 className="text-display" style={{ fontSize: 'clamp(28px, 4vw, 40px)', color: 'var(--text-1)', marginBottom: 14 }}>
              {title}
            </h2>
            {description && (
              <p style={{ fontSize: 16, color: 'var(--text-3)', maxWidth: 560, margin: '0 auto', lineHeight: 'var(--lh-relaxed)' }}>
                {description}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Column icon={Server} column={selfHost} tone="violet" dotHue={290} />
          <Column icon={Cloud} column={cloud} tone="pink" dotHue={350} />
        </div>
      </div>
    </section>
  );
}
