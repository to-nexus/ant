/**
 * Shared size / tone scale for the animated loading glyphs in this directory
 * (`Spinner`, `SunburstSpinner`). One table so a new glyph cannot drift into its
 * own sizing or color vocabulary.
 */

export type GlyphSize = 'sm' | 'md' | 'lg';
export type GlyphTone = 'muted' | 'accent' | 'inverse' | 'inherit';

export const GLYPH_SIZE: Record<GlyphSize, string> = {
  sm: 'w-3.5 h-3.5',
  md: 'w-4 h-4',
  lg: 'w-6 h-6',
};

export const GLYPH_TONE: Record<GlyphTone, string> = {
  muted: 'var(--text-3)',
  accent: 'var(--violet-500)',
  inverse: 'white',
  inherit: 'currentColor',
};
