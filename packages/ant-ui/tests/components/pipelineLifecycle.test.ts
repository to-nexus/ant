/**
 * Header lifecycle truth table — the ONE decision the draft ⇄ published
 * segment, its disabled reasons and the badge fallback all read. Mirrors the
 * BE gates: enable refuses an unsaved/dirty definition, disable refuses while
 * any activation exists.
 */
import { describe, it, expect } from 'vitest';
import { decideDelete, decideLifecycle, type LifecycleInput } from '../../src/presentation/components/Pipelines/lifecycle';

const base: LifecycleInput = { draftIsNew: false, readonly: false, enabled: false, definitionDirty: false, activationCount: 0 };

describe('decideLifecycle', () => {
  const rows: Array<[string, Partial<LifecycleInput>, ReturnType<typeof decideLifecycle>]> = [
    ['new draft → unsaved badge, no segment', { draftIsNew: true }, { stage: 'draft', block: 'unsaved', badgeOnly: true }],
    ['shared read-only → badge, whatever the stage', { readonly: true, enabled: true }, { stage: 'published', block: 'readonly', badgeOnly: true }],
    ['saved clean draft → publish is one click', {}, { stage: 'draft', badgeOnly: false }],
    ['dirty draft → publish blocked until saved', { definitionDirty: true }, { stage: 'draft', block: 'dirty', badgeOnly: false }],
    ['published, no activations → back to draft is one click', { enabled: true }, { stage: 'published', badgeOnly: false }],
    ['published with activations → the way back is blocked', { enabled: true, activationCount: 2 }, { stage: 'published', block: 'activations', badgeOnly: false }],
    // A dirty flag while published is a design-view artefact (the canvas is locked) — it must not block anything.
    ['published + stale dirty flag → still switchable', { enabled: true, definitionDirty: true }, { stage: 'published', badgeOnly: false }],
  ];
  it.each(rows)('%s', (_label, over, expected) => {
    expect(decideLifecycle({ ...base, ...over })).toEqual(expected);
  });
});

describe('decideDelete', () => {
  it.each<[string, Parameters<typeof decideDelete>[0], ReturnType<typeof decideDelete>]>([
    ['new draft → nothing to delete yet', { draftIsNew: true, readonly: false, enabled: false }, { allowed: false, block: 'unsaved' }],
    ['shared read-only → not yours to delete', { draftIsNew: false, readonly: true, enabled: false }, { allowed: false, block: 'readonly' }],
    ['published → back to draft first', { draftIsNew: false, readonly: false, enabled: true }, { allowed: false, block: 'enabled' }],
    ['saved, yours, disabled → deletable', { draftIsNew: false, readonly: false, enabled: false }, { allowed: true }],
  ])('%s', (_label, input, expected) => {
    expect(decideDelete(input)).toEqual(expected);
  });
});
