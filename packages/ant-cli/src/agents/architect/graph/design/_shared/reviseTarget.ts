/**
 * Revise-target resolver — SINGLE OWNER of the "ref determines target" rule.
 *
 * For a revise design intent (`rev-ui` / `rev-game-art`) the selected ref
 * sub-source is the single discriminator that decides the full output
 * contract — docFormat, decompose variant, AND output directory. Previously
 * this decision was scattered across `resolveDesignOutputFormat` (docFormat),
 * the per-surface variant pickers, `isFigmaPipeline`, and the execute-phase
 * `designDirOf` fallback, which drifted (e.g. `rev-game-art` on a figma ref
 * could never reach `by-figma`).
 *
 *   ant     → json    / by-desc    / visual/{s}/ant     revise the JSON trio in place
 *   figma   → json    / by-figma   / visual/{s}/ant     regenerate the JSON trio from the changed figma
 *   handoff → handoff / by-handoff / visual/{s}/handoff revise the handoff bundle in place
 *
 * UI (`visual/ui`) and game-art (`visual/game-art`) are symmetric.
 */
import type { DesignGraphState } from '../state';
import { ARTIFACT_PREFIX } from '@ant/shared';
import { ArtifactPoolView } from '../../../../../core/artifact/ArtifactPipeline';

export type DesignDocFormat = 'json' | 'handoff';
export type DesignSurface = 'ui' | 'game-art';
export type DesignVariant = 'by-desc' | 'by-figma' | 'by-handoff';
export type ReviseSubSource = 'ant' | 'figma' | 'handoff';

export interface ReviseTargetResolution {
  docFormat: DesignDocFormat;
  variant: DesignVariant;
  /** Output directory prefix WITHOUT the trailing slash, e.g. `visual/game-art/ant`. */
  targetDir: string;
}

const SURFACE_DIRS = {
  ui: { ant: ARTIFACT_PREFIX.UI_ANT, handoff: ARTIFACT_PREFIX.UI_HANDOFF },
  'game-art': { ant: ARTIFACT_PREFIX.GAME_ART_ANT, handoff: ARTIFACT_PREFIX.GAME_ART_HANDOFF },
} as const;

const stripTrailingSlash = (p: string): string => p.replace(/\/$/, '');

/**
 * The single revise discriminator: which sub-source did the user select as the
 * authoritative ref? Reads the RAC pool via the surface's `*Source()` view.
 * Returns `null` when no design sub-source is present (e.g. an empty pool).
 */
export function resolveReviseSubSource(
  state: Pick<DesignGraphState, 'resolvedAction' | 'artifacts'>,
  surface: DesignSurface,
): ReviseSubSource | null {
  const pool = new ArtifactPoolView(state.artifacts || []);
  const source = surface === 'ui' ? pool.uiSource() : pool.gameArtSource();
  return source ?? null;
}

/**
 * Map a revise sub-source to its full output contract. `null` (no source
 * detected) degrades to the ant JSON contract — the legacy default.
 */
export function resolveReviseTarget(
  subSource: ReviseSubSource | null,
  surface: DesignSurface,
): ReviseTargetResolution {
  const dirs = SURFACE_DIRS[surface];
  switch (subSource) {
    case 'handoff':
      return { docFormat: 'handoff', variant: 'by-handoff', targetDir: stripTrailingSlash(dirs.handoff) };
    case 'figma':
      return { docFormat: 'json', variant: 'by-figma', targetDir: stripTrailingSlash(dirs.ant) };
    case 'ant':
    case null:
    default:
      return { docFormat: 'json', variant: 'by-desc', targetDir: stripTrailingSlash(dirs.ant) };
  }
}
