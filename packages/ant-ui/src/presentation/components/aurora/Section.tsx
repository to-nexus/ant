
import * as React from 'react';

/**
 * Aurora Section — labeled block with optional eyebrow chip, title (display
 * font), subtitle, and right-aligned action slot.
 */

export interface SectionProps {
  title?: string;
  subtitle?: string;
  eyebrow?: string;
  action?: React.ReactNode;
  anchorId?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}

export function Section({
  title,
  subtitle,
  eyebrow,
  action,
  anchorId,
  children,
  style,
  className,
}: SectionProps) {
  return (
    <section
      id={anchorId}
      className={className}
      style={{ marginBottom: 56, ...style }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          marginBottom: 24,
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          {eyebrow && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 1.5,
                textTransform: 'uppercase',
                color: 'var(--violet-600)',
                marginBottom: 8,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--gradient-aurora)',
                }}
              />
              {eyebrow}
            </div>
          )}
          {title && (
            <h2
              className="text-display"
              style={{
                fontSize: 'var(--fs-2xl)',
                margin: 0,
                color: 'var(--text-1)',
              }}
            >
              {title}
            </h2>
          )}
          {subtitle && (
            <p
              style={{
                margin: '6px 0 0',
                color: 'var(--text-3)',
                fontSize: 14,
                maxWidth: 600,
              }}
            >
              {subtitle}
            </p>
          )}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
