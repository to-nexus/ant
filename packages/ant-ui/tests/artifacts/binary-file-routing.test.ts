/**
 * Binary file routing — valid-crating-prawn regression.
 *
 * A user-uploaded Duck.glb was destroyed when the artifacts tree opened it in
 * the TEXT editor (GET /files utf-8 decode → keystroke + Save → PUT utf-8
 * re-encode). The FE-side guarantee under test: binary extensions never route
 * to the text editor path — images keep the blob preview, everything else
 * binary gets the read-only info panel, and no binary path ever offers a
 * 'raw' (textarea) view mode.
 */

import { describe, it, expect } from 'vitest';
import {
  isBinaryFilePath,
  isBinaryImageFilePath,
} from '@/infrastructure/http/api/files';
import { supportedViewModes, canToggleViewMode } from '@/domain/file/viewMode';

describe('isBinaryFilePath (shared BINARY_EXTENSIONS SSOT)', () => {
  it.each([
    'assets/game/models/Duck.glb',
    'assets/game/models/Rig.FBX',
    'assets/game/audio/theme.ogg',
    'assets/game/audio/hit.flac',
    'docs/spec.pdf',
    'bundle.zip',
    'photo.png',
  ])('classifies %s as binary', (p) => {
    expect(isBinaryFilePath(p)).toBe(true);
  });

  it.each([
    'model.gltf', // JSON glTF variant — text-editable
    'mesh.obj', // Wavefront text format
    'icon.svg', // text-editable, documented FE carve-out
    'plan/prd.md',
    'src/main.ts',
  ])('keeps %s editable as text', (p) => {
    expect(isBinaryFilePath(p)).toBe(false);
  });

  it('image predicate stays a strict subset (blob preview keeps its own branch)', () => {
    expect(isBinaryImageFilePath('a.png')).toBe(true);
    expect(isBinaryImageFilePath('Duck.glb')).toBe(false);
  });
});

describe('supportedViewModes — binary never offers a raw textarea', () => {
  it('binary files are preview-only (no raw view, no toggle)', () => {
    expect([...supportedViewModes('assets/game/models/Duck.glb')]).toEqual(['preview']);
    expect(canToggleViewMode('assets/game/models/Duck.glb')).toBe(false);
    expect([...supportedViewModes('a.png')]).toEqual(['preview']);
  });

  it('text files keep both modes', () => {
    expect(supportedViewModes('plan/prd.md').has('raw')).toBe(true);
    expect(supportedViewModes('model.gltf').has('raw')).toBe(true);
  });
});
