/**
 * Game-Art Asset Validator (Phase 2 — D20 + I6 backstop)
 *
 * Production helper that validates a `game-art-assets.json` entry against
 * the two invariants the design template enforces verbally:
 *
 *  - **D20 (kind discipline)** — every entry is either `kind: 'inline'`
 *    (no `src`, payload lives in the catalog itself) or `kind: 'external'`
 *    (carries a `src` pointing at a file under `inputs/assets/game/...`).
 *    `kind: 'inline'` entries are EXEMPT from the src-existence check.
 *  - **I6 (asset surface boundary)** — `kind: 'external'` srcs MUST live
 *    inside the game pool (`inputs/assets/game/...`). A src that points
 *    into the service pool (`inputs/assets/service/...`) is a cross-surface
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
  | 'external-src-missing';

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
  if (entry.kind === 'inline') return [];

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
      reason: 'kind:external entries require a `src` pointing at inputs/assets/game/...',
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
