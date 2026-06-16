import type { ResolvedArtifact, UiSource } from '@ant/shared';
import { ArtifactPoolView } from '../../../../../../../core/prompt/builder/ArtifactPipeline';
import type { CodeTask } from '../../../../../types/task';

/**
 * Axis C (RCA: third-housing-forge) — a renderable `feature` task observes the
 * UI source for the full **affordance / control / content set** it must build
 * and wire, while the paired `ui` task owns visual styling. The feature owns
 * "what controls exist and that they work"; ui owns "how they look".
 *
 * The feature can already SEE the UI source in its RAC inventory and read it
 * on-demand (job-level RAC scope) — the gap was that the per-source reading
 * discipline went dark because the styling `uiSource` discriminator is computed
 * from the per-task selected subset (null for a feature whose `include` omits the
 * UI body). This helper recomputes the source from the JOB-LEVEL pool so an
 * affordance-scoped observation partial can fire WITHOUT pre-loading the body
 * (no duplicate of the paired ui task's pre-load, no context bloat).
 *
 * Returns inert flags for any non-renderable / non-feature task, and when the
 * job pool carries no UI source. Kept separate from the styling `uiSource`
 * template var so a renderable feature never trips the design-system styling
 * inventory branches keyed on `uiSource`.
 */
export function featureUiObservationVars(
  pool: ResolvedArtifact[],
  task: CodeTask,
): { featureObservesUiSource: boolean; featureUiSource: UiSource | null } {
  const isRenderableFeature =
    task?.type === 'feature' && (task as { renderable?: boolean }).renderable === true;
  if (!isRenderableFeature) {
    return { featureObservesUiSource: false, featureUiSource: null };
  }
  // Hard-exclusive by construction (one UiSource per job); throws on mixed —
  // which a valid RAC never is. Non-UI pool entries (PRD / system-design) are
  // ignored by `uiSource()`.
  const src = new ArtifactPoolView(pool).uiSource();
  return { featureObservesUiSource: src !== null, featureUiSource: src };
}
