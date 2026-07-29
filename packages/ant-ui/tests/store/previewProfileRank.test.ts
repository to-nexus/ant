/**
 * `mergePreviewStatus` ranks the project profile by PROVENANCE, not by arrival
 * order.
 *
 * `PreviewBroadcaster` pushes the code job's `<techTier>` guess as an SSE status
 * patch (`source: 'techtier-hint'`). Under plain last-write-wins that hint
 * overwrote the manifest-derived profile already held in the store, which is how
 * the structure chip flipped fullstack↔monorepo and how chimeric pairs like
 * `language: go` + `framework: nextjs` appeared — the old hook also field-merged
 * the two sources.
 *
 * The rule lives here because this slice is the documented single writer of
 * preview state.
 */

import { describe, it, expect } from 'vitest';
import { create } from 'zustand';
import {
  createPreviewSlice,
  type PreviewSlice,
} from '../../src/domain/store/slices/previewSlice';
import type { ProjectProfile, PreviewStatus } from '../../src/infrastructure/http/api';

function makeStore() {
  return create<PreviewSlice>()((set, get, store) =>
    createPreviewSlice(set, get, store),
  );
}

const KEY = 'proj:main';

const MANIFEST: ProjectProfile = {
  language: 'go',
  framework: 'gin',
  structureType: 'backend-only',
  source: 'manifest',
};
const HINT: ProjectProfile = {
  language: 'typescript',
  framework: 'nextjs',
  structureType: 'fullstack',
  source: 'techtier-hint',
};

const profileOf = (s: ReturnType<typeof makeStore>) =>
  s.getState().previewByFeature[KEY]?.status?.projectProfile;

describe('mergePreviewStatus — project profile provenance rank', () => {
  it('a hint patch does NOT overwrite a held manifest profile', () => {
    const s = makeStore();
    s.getState().mergePreviewStatus(KEY, { projectProfile: MANIFEST } as Partial<PreviewStatus>);
    s.getState().mergePreviewStatus(KEY, { projectProfile: HINT } as Partial<PreviewStatus>);
    expect(profileOf(s)).toEqual(MANIFEST);
  });

  it('a manifest patch DOES overwrite a held hint', () => {
    const s = makeStore();
    s.getState().mergePreviewStatus(KEY, { projectProfile: HINT } as Partial<PreviewStatus>);
    s.getState().mergePreviewStatus(KEY, { projectProfile: MANIFEST } as Partial<PreviewStatus>);
    expect(profileOf(s)).toEqual(MANIFEST);
  });

  it('a same-provenance patch replaces (fresher detection wins)', () => {
    const s = makeStore();
    s.getState().mergePreviewStatus(KEY, { projectProfile: MANIFEST } as Partial<PreviewStatus>);
    const newer: ProjectProfile = { ...MANIFEST, framework: 'echo' };
    s.getState().mergePreviewStatus(KEY, { projectProfile: newer } as Partial<PreviewStatus>);
    expect(profileOf(s)?.framework).toBe('echo');
  });

  it('a patch omitting projectProfile preserves the held one', () => {
    const s = makeStore();
    s.getState().mergePreviewStatus(KEY, { projectProfile: MANIFEST } as Partial<PreviewStatus>);
    s.getState().mergePreviewStatus(KEY, { phase: 'running', running: true } as Partial<PreviewStatus>);
    expect(profileOf(s)).toEqual(MANIFEST);
  });

  it('never field-merges: the hint\'s framework cannot land on the manifest language', () => {
    const s = makeStore();
    const partialManifest: ProjectProfile = { language: 'python', structureType: 'backend-only', source: 'manifest' };
    s.getState().mergePreviewStatus(KEY, { projectProfile: partialManifest } as Partial<PreviewStatus>);
    s.getState().mergePreviewStatus(KEY, { projectProfile: HINT } as Partial<PreviewStatus>);
    expect(profileOf(s)).toEqual(partialManifest);
    expect(profileOf(s)?.framework).toBeUndefined();
  });

  it('the first patch seeds the profile even with no prior status', () => {
    const s = makeStore();
    s.getState().mergePreviewStatus(KEY, { projectProfile: HINT } as Partial<PreviewStatus>);
    expect(profileOf(s)).toEqual(HINT);
  });
});
