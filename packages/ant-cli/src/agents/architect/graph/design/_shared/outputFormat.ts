/**
 * Design output-format resolver — SINGLE OWNER.
 *
 * Decides whether a UI / game-art design job authors the Claude-Design-style
 * handoff bundle (`visual/{ui,game-art}/handoff/` — DESIGN.md root guide +
 * shared-layer dirs) or the legacy ant-canonical JSON trio
 * (`visual/{ui,game-art}/ant/`). Decompose stamps the result onto every task
 * as `task.docFormat`; execute reads the task field and learn re-derives via
 * this function — no other site may re-derive the decision from intent/pool
 * shards (convergence: shared decision → single owner).
 *
 *   generate  gen-ui-desc / gen-game-art-desc  → 'handoff'  (producer, repurposed)
 *   generate  figma pipeline (gen-*-figma)     → 'json'     (figma → ant JSON compile)
 *   revise    rev-ui / rev-game-art            → follows the selected source:
 *               pool source === 'handoff'      → 'handoff'  (revise bundle in place)
 *               otherwise (ant / figma / none) → 'json'     (legacy by-desc revise)
 *
 * A future `gen-*-from-handoff` converter intent (handoff ref → ant JSON)
 * plugs in here as another 'json' row.
 */
import type { DesignGraphState } from '../state';
import { ArtifactPoolView } from '../../../../../core/artifact/ArtifactPipeline';

export type DesignDocFormat = 'json' | 'handoff';

export function resolveDesignOutputFormat(
  state: Pick<DesignGraphState, 'resolvedAction' | 'artifacts'>,
  surface: 'ui' | 'game-art',
): DesignDocFormat {
  const intent = state.resolvedAction?.intent;
  if (intent === 'gen-ui-desc' || intent === 'gen-game-art-desc') return 'handoff';
  if (intent === 'rev-ui' || intent === 'rev-game-art') {
    const pool = new ArtifactPoolView(state.artifacts || []);
    const source = surface === 'ui' ? pool.uiSource() : pool.gameArtSource();
    return source === 'handoff' ? 'handoff' : 'json';
  }
  return 'json';
}
