/**
 * Game-Art Asset Validator (Phase 2 — D20 + I6 backstop)
 *
 * Production helper that validates a `game-art-assets.json` entry against
 * the two invariants the design template enforces verbally:
 *
 *  - **D20 (kind discipline)** — every entry is either `kind: 'inline'`
 *    (no `src`, payload lives in the catalog itself) or `kind: 'external'`
 *    (carries a `src` pointing at a file under `assets/game/...`).
 *    `kind: 'inline'` entries are EXEMPT from the src-existence check.
 *  - **I6 (asset surface boundary)** — `kind: 'external'` srcs MUST live
 *    inside the game pool (`assets/game/...`). A src that points
 *    into the service pool (`assets/service/...`) is a cross-surface
 *    leak and MUST throw.
 *
 * The validator is intentionally pure — file existence is supplied by an
 * injectable predicate so callers can test deterministically and so the
 * helper can run in any environment (FS / virtual / test).
 */
import { ARTIFACT_PREFIX } from '@ant/shared';

/** Shape of a single entry in `game-art-assets.json`. */
export interface GameArtAssetEntry {
  id: string;
  kind: 'inline' | 'external';
  /** Required when `kind === 'external'`; absent when `kind === 'inline'`. */
  src?: string;
  /** Inline payload format hint (`css` / `svg` / `oscillator`). Optional. */
  format?: string;
  /** Free-form metadata — not validated here. */
  [extra: string]: unknown;
}

/** A predicate that answers "does this workspace-relative path exist on disk?". */
export type SrcExistsPredicate = (workspaceRelativePath: string) => boolean;

export type ValidationCode =
  /** `kind: 'external'` entry is missing the required `src` field. */
  | 'external-missing-src'
  /** `kind: 'external'` entry's src points at the service pool — I6 leak. */
  | 'external-cross-surface'
  /** `kind: 'external'` entry's src points outside the game pool entirely. */
  | 'external-outside-game-pool'
  /** `kind: 'external'` entry's src does not exist on disk. */
  | 'external-src-missing'
  /** `kind: 'inline'` `svg` payload exceeds the css-only complexity ceiling (D21). */
  | 'inline-svg-too-complex'
  /** `kind: 'inline'` `css` payload exceeds the byte ceiling (D21). */
  | 'inline-css-too-long'
  /** `kind: 'inline'` `oscillator.durationMs` exceeds the ceiling (D21). */
  | 'inline-oscillator-too-long';

/**
 * Inline-payload ceilings (D21). These are the SSOT for the numeric limits
 * the design template (`jobs/design/basis/gameArtTier/_preamble.md` §2 +
 * `game-art-assets-guide-by-*.md`) states verbally. An inline entry above a
 * ceiling is a warning (returned as a `ValidationIssue`) that the retry
 * channel converts into a "promote to kind:external" re-prompt — it is NOT a
 * throw, because an over-complex inline payload is recoverable, whereas an I6
 * cross-surface leak is not.
 */
export const INLINE_LIMITS = {
  /** Max `path|circle|rect|polygon|ellipse` primitives in an inline svg. */
  svgMaxPrimitives: 5,
  /** Max side length of the inline svg `viewBox` (both width and height). */
  svgMaxViewBoxSide: 64,
  /** Max byte length of an inline `css` payload. */
  cssMaxBytes: 1024,
  /** Max `durationMs` of an inline oscillator config. */
  oscillatorMaxDurationMs: 200,
} as const;

const SVG_PRIMITIVE_RE = /<\s*(?:path|circle|rect|polygon|ellipse)\b/gi;
const SVG_VIEWBOX_RE = /viewBox\s*=\s*['"]\s*[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+([-\d.]+)\s*['"]/i;

/**
 * Check an inline entry against the D21 css-only ceilings. Pure — inspects
 * only the payload fields present on the entry (`svg` / `css` / `oscillator`).
 * Missing / malformed payloads are skipped (shape is not this helper's
 * concern — it only flags oversize payloads).
 */
function checkInlineLimits(entry: GameArtAssetEntry): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const svg = entry.svg;
  if (typeof svg === 'string') {
    const primitiveCount = (svg.match(SVG_PRIMITIVE_RE) || []).length;
    const viewBox = SVG_VIEWBOX_RE.exec(svg);
    const widthOver = viewBox ? Number(viewBox[1]) > INLINE_LIMITS.svgMaxViewBoxSide : false;
    const heightOver = viewBox ? Number(viewBox[2]) > INLINE_LIMITS.svgMaxViewBoxSide : false;
    if (primitiveCount > INLINE_LIMITS.svgMaxPrimitives || widthOver || heightOver) {
      issues.push({
        id: entry.id,
        code: 'inline-svg-too-complex',
        reason:
          `inline svg exceeds the css-only ceiling (D21): ${primitiveCount} primitive(s) `
          + `(max ${INLINE_LIMITS.svgMaxPrimitives}), viewBox side max ${INLINE_LIMITS.svgMaxViewBoxSide}. `
          + `Promote to kind:external under assets/game/... instead.`,
      });
    }
  }

  const css = entry.css;
  if (typeof css === 'string') {
    const bytes = Buffer.byteLength(css, 'utf-8');
    if (bytes > INLINE_LIMITS.cssMaxBytes) {
      issues.push({
        id: entry.id,
        code: 'inline-css-too-long',
        reason:
          `inline css payload is ${bytes} bytes (max ${INLINE_LIMITS.cssMaxBytes}). `
          + `A single-tone / gradient shape stays well under the ceiling; promote richer visuals to kind:external.`,
      });
    }
  }

  const oscillator = entry.oscillator;
  if (oscillator && typeof oscillator === 'object') {
    const durationMs = (oscillator as { durationMs?: unknown }).durationMs;
    if (typeof durationMs === 'number' && durationMs > INLINE_LIMITS.oscillatorMaxDurationMs) {
      issues.push({
        id: entry.id,
        code: 'inline-oscillator-too-long',
        reason:
          `inline oscillator durationMs=${durationMs} exceeds ${INLINE_LIMITS.oscillatorMaxDurationMs}ms. `
          + `Longer audio must be kind:external under assets/game/sfx|bgm with audioScope:'external-enabled'.`,
      });
    }
  }

  return issues;
}

export interface ValidationIssue {
  id: string;
  code: ValidationCode;
  src?: string;
  reason: string;
}

export interface ValidationOptions {
  /**
   * File-existence predicate. When omitted, src-existence checks are
   * SKIPPED (the validator only enforces kind discipline + I6).
   * Pass a real `path => fs.existsSync(...)` (or a workspace-relative
   * variant) to enable D20's "src must exist" leg.
   */
  srcExists?: SrcExistsPredicate;
}

/**
 * Validate a single entry. `kind: 'inline'` is always accepted (no `src`
 * to check). `kind: 'external'` is run through the I6 + D20 gates.
 *
 * **Throws on I6 violation** (cross-surface leak) — the design surface
 * MUST NOT emit a service-pool src under `game-art-assets.json`. All
 * other issues are returned as `ValidationIssue[]` so callers can surface
 * them as warnings, populate kanban tickets, etc.
 */
export function validateGameArtAssetEntry(
  entry: GameArtAssetEntry,
  options: ValidationOptions = {},
): ValidationIssue[] {
  if (entry.kind === 'inline') return checkInlineLimits(entry);

  if (entry.kind !== 'external') {
    return [{
      id: entry.id,
      code: 'external-missing-src',
      reason: `Unknown kind "${String(entry.kind)}" — expected 'inline' | 'external'`,
    }];
  }

  const issues: ValidationIssue[] = [];

  if (!entry.src) {
    issues.push({
      id: entry.id,
      code: 'external-missing-src',
      reason: 'kind:external entries require a `src` pointing at assets/game/...',
    });
    return issues;
  }

  // I6 — cross-surface leak. Throwing matches the template-level enforcement
  // in `_preamble.md`: a service src under game-art-assets is a hard
  // contract violation that must NOT be silenced into a warning.
  if (entry.src.startsWith(ARTIFACT_PREFIX.ASSETS_SERVICE)) {
    throw new Error(
      `[I6] game-art-assets.json entry "${entry.id}" has external src "${entry.src}" pointing at the service pool. `
        + `Move the asset under ${ARTIFACT_PREFIX.ASSETS_GAME} or convert the entry to kind:inline.`,
    );
  }

  if (!entry.src.startsWith(ARTIFACT_PREFIX.ASSETS_GAME)) {
    issues.push({
      id: entry.id,
      code: 'external-outside-game-pool',
      src: entry.src,
      reason: `external src must start with ${ARTIFACT_PREFIX.ASSETS_GAME} (got "${entry.src}")`,
    });
    return issues;
  }

  if (options.srcExists && !options.srcExists(entry.src)) {
    issues.push({
      id: entry.id,
      code: 'external-src-missing',
      src: entry.src,
      reason: `external src "${entry.src}" does not exist on disk`,
    });
  }

  return issues;
}

/**
 * Validate every entry in a catalog. Aggregates `ValidationIssue[]` across
 * entries; I6 leaks still throw on the first offender so the caller never
 * silently consumes a cross-surface catalog.
 */
export function validateGameArtAssetCatalog(
  entries: ReadonlyArray<GameArtAssetEntry>,
  options: ValidationOptions = {},
): ValidationIssue[] {
  const all: ValidationIssue[] = [];
  for (const entry of entries) {
    all.push(...validateGameArtAssetEntry(entry, options));
  }
  return all;
}
