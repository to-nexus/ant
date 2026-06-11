interface BrandLogoProps {
  /** Logo image size in px. */
  size?: number;
  /** Show the "Ant" wordmark next to the logo. */
  showWord?: boolean;
  /** Wordmark font-size (px). */
  wordSize?: number;
  className?: string;
}

/**
 * ANT brand mark: the logo PNG wrapped in a drifting aurora glow halo, with an
 * optional "Ant" wordmark. Used in the nav and hero.
 */
export function BrandLogo({ size = 32, showWord = true, wordSize = 18, className }: BrandLogoProps) {
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <span style={{ position: 'relative', width: size, height: size, flexShrink: 0, display: 'inline-flex' }}>
        <span
          aria-hidden
          className="gradient-flow"
          style={{
            position: 'absolute',
            inset: -size * 0.18,
            background: 'var(--gradient-aurora)',
            backgroundSize: '200% 200%',
            borderRadius: '50%',
            filter: `blur(${Math.round(size * 0.42)}px)`,
            opacity: 0.55,
            pointerEvents: 'none',
          }}
        />
        <img
          src="/logo.png"
          alt="ANT"
          width={size}
          height={size}
          style={{ position: 'relative', zIndex: 1, width: size, height: size }}
        />
      </span>
      {showWord && (
        <span
          className="text-display"
          style={{ fontSize: wordSize, fontWeight: 800, color: 'var(--text-1)', letterSpacing: '-0.02em' }}
        >
          Ant
        </span>
      )}
    </span>
  );
}
