/**
 * Rail tokens — the one vocabulary both settings rails (AgentTree,
 * PipelineRail) are built from, so the two read identically.
 */

import type { CSSProperties } from 'react';

/** Icon-only toolbar box; <button> and <label> callers render the same. */
export const TOOLBAR_ICON_CLASS =
  'inline-flex items-center justify-center h-6 w-6 rounded text-[color:var(--text-3)] hover:text-[color:var(--text-2)] hover:bg-[color:var(--bg-hover)] transition-colors';

/** Selectable row chrome — left padding comes from `RAIL_INDENT`, not the class. */
export const RAIL_ROW_CLASS =
  'group flex items-center gap-1 py-1 pr-1 rounded text-xs cursor-pointer hover:bg-[color:var(--bg-hover)]';

export const RAIL_GROUP_HEADER_CLASS =
  'text-[10px] font-semibold uppercase tracking-wide flex items-center gap-1.5 px-1';

export const RAIL_EMPTY_STYLE: CSSProperties = { fontSize: 10.5, lineHeight: 1.45, color: 'var(--text-4)' };

/** Row indent per depth (px) — agent › job › intent ladder. */
export const RAIL_INDENT = [8, 24, 40] as const;
