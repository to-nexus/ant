import { twMerge } from 'tailwind-merge';
import { GLYPH_SIZE, GLYPH_TONE, type GlyphSize, type GlyphTone } from './glyphScale';

export interface SunburstSpinnerProps {
  size?: GlyphSize;
  tone?: GlyphTone;
  className?: string;
  label?: string;
  style?: React.CSSProperties;
}

const RAY_COUNT = 8;
const CYCLE_S = 1;

/**
 * Sunburst in-flight glyph — an eight-ray `✳` where a bright pulse chases
 * around fixed-length rays (the macOS "network activity" spinner technique).
 * Drop-in prop-compatible with `Spinner`; use it where a thin ring reads as a
 * speck (borderless chat lines with no card to frame it).
 *
 * Each ray runs the SAME `sunburst-ray` fade (opacity 1 → 0.2) over the SAME
 * `CYCLE_S`-long duration, offset by a negative delay of `i * (CYCLE_S /
 * RAY_COUNT)`. Negative delays start every ray already mid-fade instead of
 * waiting out a positive delay first, so the stagger is visible from the
 * very first frame. Ray LENGTH never animates — only brightness does — so
 * the one thing that visibly moves is the bright pulse itself; nothing rigid
 * rotates (an earlier version spun the whole `<svg>`, which made the mostly-
 * dim ray field read as the rotating body instead of the highlight).
 * Keyframe (`sunburst-ray`) lives in `src/styles/aurora-tokens.css`.
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
      style={style}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'status' : undefined}
    >
      {Array.from({ length: RAY_COUNT }, (_, i) => {
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
            style={{
              animation: `sunburst-ray ${CYCLE_S}s linear infinite`,
              animationDelay: `${-i * (CYCLE_S / RAY_COUNT)}s`,
            }}
          />
        );
      })}
    </svg>
  );
}
