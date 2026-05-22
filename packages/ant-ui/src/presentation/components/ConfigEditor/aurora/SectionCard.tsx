
import type { ReactNode } from 'react';
import * as LucideIcons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type SectionAccent =
  | 'aurora'
  | 'cool'
  | 'violet-pink'
  | 'pink-orange'
  | 'sunset';

export interface SectionCardProps {
  /** lucide-react icon name OR pre-resolved ReactNode. */
  icon?: string | ReactNode;
  title: string;
  description?: string;
  accent?: SectionAccent;
  status?: ReactNode;
  statusAction?: ReactNode;
  children: ReactNode;
  /** If false, body has no internal padding. Default true. */
  padded?: boolean;
  /** Optional anchor id for in-page navigation (TOC scroll target). */
  id?: string;
}

const ACCENT_STRIP: Record<SectionAccent, string> = {
  aurora: 'var(--gradient-aurora)',
  cool: 'var(--gradient-cool)',
  'violet-pink': 'var(--gradient-violet-pink)',
  'pink-orange': 'var(--gradient-pink-orange)',
  sunset: 'var(--gradient-sunset)',
};

function resolveIconNode(icon: string | ReactNode | undefined): ReactNode {
  if (icon == null) return null;
  if (typeof icon !== 'string') return icon;
  const registry = LucideIcons as unknown as Record<string, LucideIcon>;
  const IconComp = registry[icon];
  if (!IconComp) return null;
  return <IconComp size={16} strokeWidth={2} />;
}

export function SectionCard({
  icon,
  title,
  description,
  accent = 'aurora',
  status,
  statusAction,
  children,
  padded = true,
  id,
}: SectionCardProps) {
  const iconNode = resolveIconNode(icon);

  return (
    <section
      id={id}
      style={{
        position: 'relative',
        background: 'oklch(from var(--bg-surface) l c h / 0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid var(--border-1)',
        borderRadius: 'var(--r-xl)',
        boxShadow: 'var(--shadow-xs)',
        overflow: 'hidden',
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: ACCENT_STRIP[accent],
          opacity: 0.55,
        }}
      />
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          padding: '14px 18px 10px 22px',
          borderBottom: '1px solid var(--border-1)',
        }}
      >
        {iconNode && (
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 'var(--r-md)',
              background: 'var(--bg-surface-2)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              color: 'var(--text-2)',
            }}
          >
            {iconNode}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 700,
                color: 'var(--text-1)',
                letterSpacing: '-0.005em',
              }}
            >
              {title}
            </h3>
            {status}
            {statusAction}
          </div>
          {description && (
            <p
              style={{
                margin: '4px 0 0',
                fontSize: 12,
                lineHeight: 1.5,
                color: 'var(--text-3)',
                maxWidth: 560,
              }}
            >
              {description}
            </p>
          )}
        </div>
      </header>
      <div style={{ padding: padded ? '14px 18px 16px 22px' : 0 }}>
        {children}
      </div>
    </section>
  );
}
