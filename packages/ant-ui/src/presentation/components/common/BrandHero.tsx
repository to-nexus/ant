import { useTranslation } from 'react-i18next';

interface BrandHeroProps {
  logoSize?: number;
  className?: string;
}

export function BrandHero({ logoSize = 64, className = '' }: BrandHeroProps) {
  const { t } = useTranslation('common');

  // Unique ids per logoSize avoid SVG <defs> collisions across instances.
  const gradId = `bh-grad-${logoSize}`;
  const shineId = `bh-shine-${logoSize}`;
  const haloBlur = logoSize * 0.5;

  return (
    <div className={`inline-flex items-center gap-4 ${className}`}>
      <div
        style={{
          position: 'relative',
          width: logoSize,
          height: logoSize,
          flexShrink: 0,
        }}
      >
        {/* Aurora glow halo behind the logo */}
        <div
          aria-hidden="true"
          className="gradient-flow"
          style={{
            position: 'absolute',
            inset: 0,
            background: 'var(--gradient-aurora)',
            backgroundSize: '200% 200%',
            borderRadius: '50%',
            filter: `blur(${haloBlur}px)`,
            opacity: 0.55,
            pointerEvents: 'none',
          }}
        />
        <svg
          width={logoSize}
          height={logoSize}
          viewBox="0 0 64 64"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{
            position: 'relative',
            display: 'block',
            filter: 'drop-shadow(0 4px 16px oklch(60% 0.25 320 / 0.45))',
          }}
          role="img"
          aria-label={t('brand.prefix') + t('brand.highlight') + t('brand.suffix')}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="oklch(60% 0.26 285)" />
              <stop offset="50%" stopColor="oklch(64% 0.28 340)" />
              <stop offset="100%" stopColor="oklch(72% 0.22 50)" />
            </linearGradient>
            <linearGradient id={shineId} x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="white" stopOpacity="0.45" />
              <stop offset="60%" stopColor="white" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Rounded-square logo plate */}
          <rect x="2" y="2" width="60" height="60" rx="16" ry="16" fill={`url(#${gradId})`} />
          {/* Subtle white shine on top half */}
          <rect x="2" y="2" width="60" height="32" rx="16" ry="16" fill={`url(#${shineId})`} />
          {/* "A" glyph */}
          <path
            d="M20 46 L32 18 L44 46 M24.5 38 L39.5 38"
            stroke="white"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </div>
      <span
        className="font-display"
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 900,
          letterSpacing: '-0.025em',
          fontSize: '1.875rem',
          lineHeight: 1.15,
        }}
      >
        <span style={{ color: 'var(--text-1)' }}>{t('brand.prefix')}</span>
        <span
          className="gradient-flow"
          style={{
            background: 'var(--gradient-aurora)',
            backgroundSize: '200% 200%',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
          }}
        >
          {t('brand.highlight')}
        </span>
        <span style={{ color: 'var(--text-1)' }}>{t('brand.suffix')}</span>
      </span>
    </div>
  );
}
