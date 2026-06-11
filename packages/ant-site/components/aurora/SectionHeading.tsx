import type { CSSProperties, ReactNode } from 'react';

interface SectionHeadingProps {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  align?: 'center' | 'left';
  className?: string;
  style?: CSSProperties;
}

/**
 * Aurora section header: optional eyebrow chip (gradient dot + uppercase
 * label), display-font title, and subtitle. Centered by default.
 */
export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = 'center',
  className,
  style,
}: SectionHeadingProps) {
  const centered = align === 'center';
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: centered ? 'center' : 'flex-start',
        textAlign: centered ? 'center' : 'left',
        gap: 12,
        ...style,
      }}
    >
      {eyebrow && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--text-3)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          <span
            aria-hidden
            style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--gradient-aurora)' }}
          />
          {eyebrow}
        </span>
      )}
      <h2
        className="text-display"
        style={{
          margin: 0,
          fontSize: 'clamp(28px, 4vw, 40px)',
          color: 'var(--text-1)',
          maxWidth: 760,
        }}
      >
        {title}
      </h2>
      {subtitle && (
        <p
          style={{
            margin: 0,
            color: 'var(--text-3)',
            fontSize: 16,
            lineHeight: 'var(--lh-relaxed)',
            maxWidth: 620,
          }}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}
