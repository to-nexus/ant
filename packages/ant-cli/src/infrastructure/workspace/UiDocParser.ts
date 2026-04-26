/**
 * UI Document Parser — DEPRECATED re-export shim.
 *
 * The canonical SSOT now lives in `./DesignDocParser.ts` which generalizes
 * UI and GameArt surfaces under a single discriminated parser
 * (D24 / D25, Phase 2 follow-up).
 *
 * Existing imports of `parseUiDocs` / `generateUiSectionsSummary` keep
 * working because the new parser exports the same names as deprecated
 * UI-specific wrappers. New call sites should prefer:
 *   - `parseDesignDocs(surface, ...)` for explicit surface dispatch
 *   - `parseGameArtDocs(...)` for the GameArt surface
 *   - `generateDesignDocSectionsSummary(parsed, fieldName)` for prompt text
 */

export {
  parseUiDocs,
  parseGameArtDocs,
  parseDesignDocs,
  generateUiSectionsSummary,
  generateDesignDocSectionsSummary,
} from './DesignDocParser';
