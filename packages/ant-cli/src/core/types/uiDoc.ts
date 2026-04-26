/**
 * UI Document Types — DEPRECATED re-export shim.
 *
 * The canonical SSOT now lives in `./designDoc.ts` which generalizes UI and
 * GameArt surfaces under a single `ParsedDesignDocs` discriminated by
 * `surface: 'ui' | 'gameArt'` (D24 / D25, Phase 2 follow-up).
 *
 * Existing imports of `ParsedUiDocs` / `UiSpecSection` / `UiSpecTocEntry`
 * keep working because they alias to the new types. Prefer `ParsedDesignDocs`
 * for new code.
 */

import type {
  DesignDocSection,
  DesignDocTocEntry,
  ParsedDesignDocs,
} from './designDoc';

/** @deprecated use `DesignDocSection` from `./designDoc`. */
export type UiSpecSection = DesignDocSection;

/** @deprecated use `DesignDocTocEntry` from `./designDoc`. */
export type UiSpecTocEntry = DesignDocTocEntry;

/** @deprecated use `ParsedDesignDocs` (with `surface: 'ui'`) from `./designDoc`. */
export type ParsedUiDocs = ParsedDesignDocs;
