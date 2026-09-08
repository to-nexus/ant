/**
 * The pipeline's publication lifecycle as the header renders it — ONE pure
 * decision over the BE state (draft ⇄ published, activations lock the way
 * back), so the segment control, its disabled reasons and the tests read the
 * same table. Mirrors the BE gates: enable refuses a dirty/unsaved
 * definition, disable refuses while any activation exists.
 */

export type LifecycleStage = 'draft' | 'published';

export interface LifecycleInput {
  draftIsNew: boolean;
  readonly: boolean;
  enabled: boolean;
  definitionDirty: boolean;
  activationCount: number;
}

export type LifecycleBlock = 'unsaved' | 'readonly' | 'dirty' | 'activations';

export interface LifecycleDecision {
  stage: LifecycleStage;
  /** Why the segment cannot be switched right now — absent = switchable. */
  block?: LifecycleBlock;
  /** The header shows a plain badge instead of the segment. */
  badgeOnly: boolean;
}

export function decideLifecycle(input: LifecycleInput): LifecycleDecision {
  const stage: LifecycleStage = input.enabled ? 'published' : 'draft';
  if (input.draftIsNew) return { stage: 'draft', block: 'unsaved', badgeOnly: true };
  if (input.readonly) return { stage, block: 'readonly', badgeOnly: true };
  if (stage === 'draft' && input.definitionDirty) return { stage, block: 'dirty', badgeOnly: false };
  if (stage === 'published' && input.activationCount > 0) return { stage, block: 'activations', badgeOnly: false };
  return { stage, badgeOnly: false };
}

export type DeleteBlock = 'unsaved' | 'readonly' | 'enabled';

/** Header trash icon — the BE refuses DELETE unless the pipeline is saved, yours, and disabled. */
export function decideDelete(input: Pick<LifecycleInput, 'draftIsNew' | 'readonly' | 'enabled'>): { allowed: boolean; block?: DeleteBlock } {
  if (input.draftIsNew) return { allowed: false, block: 'unsaved' };
  if (input.readonly) return { allowed: false, block: 'readonly' };
  if (input.enabled) return { allowed: false, block: 'enabled' };
  return { allowed: true };
}
