import { MODEL_REGISTRY } from '@ant/shared';
import type { AvailableModel } from '../hooks/useAvailableModels';

/**
 * How a stored model id resolves against the current catalog:
 *   - `selectable`   — offered as a live choice via `/models`; normal display.
 *   - `legacy`       — kept in MODEL_REGISTRY as `selectable:false` (still priced
 *                      / sized / runnable) but no longer a new choice. Shown with
 *                      its registry displayName + a legacy marker.
 *   - `unavailable`  — id absent from MODEL_REGISTRY entirely (removed model). The
 *                      raw id is surfaced so the user knows to reselect. In normal
 *                      flow the BE migrates these away, so this is a defensive net.
 */
export type ModelStatus = 'selectable' | 'legacy' | 'unavailable';

export interface ResolvedModel {
  id: string;
  displayName: string;
  /** '' for unavailable ids — no provider accent, neutral/warning treatment. */
  provider: string;
  status: ModelStatus;
}

/**
 * Resolve a stored model id to a displayable model. Selectable list wins, then
 * the shared registry (legacy), else the raw id (unavailable). Returns null for
 * an empty id so callers can render their inherited/placeholder path.
 */
export function resolveModelDisplay(
  id: string,
  availableModels: AvailableModel[],
): ResolvedModel | null {
  if (!id) return null;

  const inList = availableModels.find((m) => m.id === id);
  if (inList) {
    return { id, displayName: inList.displayName, provider: inList.provider, status: 'selectable' };
  }

  const spec = MODEL_REGISTRY[id];
  if (spec) {
    return { id, displayName: spec.displayName, provider: spec.provider, status: 'legacy' };
  }

  return { id, displayName: id, provider: '', status: 'unavailable' };
}
