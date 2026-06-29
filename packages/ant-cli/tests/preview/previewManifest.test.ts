import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  readPreviewManifest,
  MANIFEST_FILENAME,
} from '../../src/periphery/adapters/http/services/PreviewService/managers/previewManifest';

/**
 * Preview manifest loader — the single declared source for provisioning
 * commands. The loader degrades to an empty result on any absence / parse /
 * shape error: a broken manifest must NOT crash the preview start.
 */

function withTempRoot(write: ((dir: string) => void) | null, assert: (dir: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-'));
  try {
    if (write) write(dir);
    assert(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeManifest(dir: string, content: string) {
  fs.writeFileSync(path.join(dir, MANIFEST_FILENAME), content);
}

describe('readPreviewManifest', () => {
  it('missing file → empty result (no throw)', () => {
    withTempRoot(null, (dir) => {
      expect(readPreviewManifest(dir)).toEqual({ root: [], byPackage: {} });
    });
  });

  it('malformed JSON → empty result (no throw)', () => {
    withTempRoot(
      (dir) => writeManifest(dir, '{ "preview": { not valid json '),
      (dir) => expect(readPreviewManifest(dir)).toEqual({ root: [], byPackage: {} }),
    );
  });

  it('root setupCommands → loaded into root, byPackage empty', () => {
    withTempRoot(
      (dir) => writeManifest(dir, JSON.stringify({
        preview: { setupCommands: ['npx prisma db push --skip-generate'] },
      })),
      (dir) => {
        const m = readPreviewManifest(dir);
        expect(m.root).toEqual(['npx prisma db push --skip-generate']);
        expect(m.byPackage).toEqual({});
      },
    );
  });

  it('monorepo per-package setupCommands → loaded into byPackage keyed by source', () => {
    withTempRoot(
      (dir) => writeManifest(dir, JSON.stringify({
        preview: {
          packages: {
            'apps/api': { setupCommands: ['npx prisma migrate deploy'] },
            'apps/worker': { setupCommands: ['npm run db:seed'] },
          },
        },
      })),
      (dir) => {
        const m = readPreviewManifest(dir);
        expect(m.root).toEqual([]);
        expect(m.byPackage).toEqual({
          'apps/api': ['npx prisma migrate deploy'],
          'apps/worker': ['npm run db:seed'],
        });
      },
    );
  });

  it('root + per-package combined', () => {
    withTempRoot(
      (dir) => writeManifest(dir, JSON.stringify({
        preview: {
          setupCommands: ['npm run migrate:all'],
          packages: { 'apps/api': { setupCommands: ['npm run seed'] } },
        },
      })),
      (dir) => {
        const m = readPreviewManifest(dir);
        expect(m.root).toEqual(['npm run migrate:all']);
        expect(m.byPackage).toEqual({ 'apps/api': ['npm run seed'] });
      },
    );
  });

  it('schema validation: non-string / empty entries dropped, no preview key → empty', () => {
    withTempRoot(
      (dir) => writeManifest(dir, JSON.stringify({
        preview: {
          setupCommands: ['valid', 42, '', '  ', null],
          packages: {
            'apps/api': { setupCommands: 'not-an-array' },
            'apps/ok': { setupCommands: ['ok'] },
          },
        },
      })),
      (dir) => {
        const m = readPreviewManifest(dir);
        expect(m.root).toEqual(['valid']);
        // 'apps/api' has a non-array setupCommands → dropped (no empty key)
        expect(m.byPackage).toEqual({ 'apps/ok': ['ok'] });
      },
    );
  });

  it('manifest without a preview key → empty result', () => {
    withTempRoot(
      (dir) => writeManifest(dir, JSON.stringify({ somethingElse: true })),
      (dir) => expect(readPreviewManifest(dir)).toEqual({ root: [], byPackage: {} }),
    );
  });
});
