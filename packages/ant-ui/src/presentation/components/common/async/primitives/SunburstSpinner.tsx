import { twMerge } from 'tailwind-merge';
import { GLYPH_SIZE, GLYPH_TONE, type GlyphSize, type GlyphTone } from './glyphScale';

export interface SunburstSpinnerProps {
  size?: GlyphSize;
  tone?: GlyphTone;
  className?: string;
  label?: string;
  style?: React.CSSProperties;
}

/**
 * Sunburst in-flight glyph — an eight-ray `✳` whose rays grow out of and retract
 * into the centre while the whole star turns slowly. Drop-in prop-compatible with
 * `Spinner`; use it where a thin ring reads as a speck (borderless chat lines with
 * no card to frame it).
 *
 * Rays alternate long/short and each carries its own phase offset, so the star
 * shimmers instead of pulsing as one block. `pathLength=1` normalises every ray
 * to a unit length, letting one `stroke-dashoffset` keyframe drive both lengths.
 * Keyframes (`sunburst-ray`, `spin`) live in `src/styles/aurora-tokens.css`.
 */
export function SunburstSpinner({
  size = 'md',
  tone = 'accent',
  className = '',
  label,
  style,
}: SunburstSpinnerProps) {
  const color = GLYPH_TONE[tone];
  return (
    <svg
      className={twMerge(GLYPH_SIZE[size], className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeLinecap="round"
      style={{ animation: 'spin 3s linear infinite', ...style }}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'status' : undefined}
    >
      {Array.from({ length: 8 }, (_, i) => {
        const long = i % 2 === 0;
        return (
          <line
            key={i}
            x1={12}
            y1={12 - 4.5}
            x2={12}
            y2={long ? 12 - 10.5 : 12 - 8}
            strokeWidth={long ? 2 : 1.6}
            transform={`rotate(${i * 45} 12 12)`}
            pathLength={1}
            strokeDasharray="1"
            style={{
              animation: 'sunburst-ray 1.4s ease-in-out infinite',
              animationDelay: `${i * 0.12}s`,
            }}
          />
        );
      })}
    </svg>
  );
}
