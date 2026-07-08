import type { CSSProperties } from 'react';
import type { SectionAccent } from '../layout/Explorer/SectionShell';

/**
 * Aurora selection semantics — single source of truth for how a SELECTED
 * surface looks. Values live in `aurora-tokens.css` (`--select-*`); these
 * helpers only read them so the explorer rows and the tab / segmented
 * controls stop hand-rolling divergent active styling.
 *
 * Direction: the selected label always uses the highest-contrast ink
 * (`--select-fg` = `--text-1`); brand identity is carried by a small accent
 * (a solid left rail on rows, a gradient underline on tabs) + a subtle
 * elevated / tinted surface. The per-section hue (violet / pink) lives only
 * in that accent, so it costs nothing in legibility.
 */

const SELECT_TOKENS: Record<SectionAccent, { fill: string; rail: string }> = {
  violet: { fill: 'var(--select-fill-violet)', rail: 'var(--select-rail-violet)' },
  pink: { fill: 'var(--select-fill-pink)', rail: 'var(--select-rail-pink)' },
  // orange / cool reuse the violet brand fill but keep their own rail hue.
  orange: { fill: 'var(--select-fill-violet)', rail: 'var(--orange-500)' },
  cool: { fill: 'var(--select-fill-violet)', rail: 'var(--teal-500)' },
};

/**
 * Container styling for a selectable list row. The `borderLeft` is always
 * present (transparent when idle) so selecting a row never shifts layout.
 */
export function selectedRowStyle(accent: SectionAccent, isActive: boolean): CSSProperties {
  const { fill, rail } = SELECT_TOKENS[accent];
  return {
    background: isActive ? fill : 'transparent',
    borderLeft: `3px solid ${isActive ? rail : 'transparent'}`,
  };
}

/**
 * Label styling for a selectable list row. `idleColor` lets each row keep its
 * own muted token (`--text-1` / `--text-2`) for the unselected state.
 */
export function selectedRowLabel(
  isActive: boolean,
  idleColor: string,
): Pick<CSSProperties, 'color' | 'fontWeight'> {
  return {
    color: isActive ? 'var(--select-fg)' : idleColor,
    fontWeight: isActive ? 700 : 500,
  };
}

/**
 * Active surface for an icon-only rail button (settings section nav). No label
 * to read, so the brand cue is the tinted tile itself + high-contrast icon —
 * a centered fill (never a left rail, which would offset a centered glyph).
 */
export function selectedIconTileStyle(isActive: boolean): CSSProperties {
  return {
    background: isActive ? 'var(--select-fill-violet)' : 'transparent',
    color: isActive ? 'var(--select-fg)' : 'var(--text-3)',
  };
}

/**
 * Styling for a selected segment in a tab / segmented control (GNB view-mode
 * selector, main-panel tabs, board view toggle). Brand cue is the caller's
 * gradient underline; this owns the elevated fill + high-contrast label.
 */
export function selectedSegmentStyle(isActive: boolean): CSSProperties {
  return isActive
    ? {
        background: 'var(--select-bg)',
        color: 'var(--select-fg)',
        border: '1px solid var(--border-brand)',
      }
    : {
        background: 'transparent',
        color: 'var(--text-3)',
        border: '1px solid transparent',
      };
}
