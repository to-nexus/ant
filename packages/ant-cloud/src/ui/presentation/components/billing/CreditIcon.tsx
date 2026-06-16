/**
 * CreditIcon — the single glyph that represents credits everywhere they appear
 * (navbar badge, token-usage popup, payment center). Uses lucide `Coins`.
 *
 * `gradient` wraps the glyph in a small aurora-gradient chip (white glyph) for
 * hero / emphasis spots; the default renders a plain violet glyph for inline use.
 */

import { Coins } from 'lucide-react';

interface CreditIconProps {
  size?: number;
  /** Render inside an aurora-gradient rounded chip (white glyph). */
  gradient?: boolean;
  className?: string;
}

export function CreditIcon({ size = 14, gradient = false, className }: CreditIconProps) {
  if (gradient) {
    const pad = Math.round(size * 0.5);
    return (
      <span
        className={`inline-flex items-center justify-center rounded-full ${className ?? ''}`}
        style={{
          background: 'var(--gradient-violet-pink)',
          padding: pad,
          boxShadow: 'var(--shadow-glow-violet)',
        }}
      >
        <Coins size={size} color="white" strokeWidth={2.25} />
      </span>
    );
  }
  return <Coins size={size} className={className} style={{ color: 'var(--violet-500)' }} strokeWidth={2.25} />;
}
