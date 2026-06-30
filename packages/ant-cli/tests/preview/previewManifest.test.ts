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
 * commands. Canonical shape is `provision` / `commands` (matching the
 * vocabulary the contract teaches). The loader degrades to an empty result on
 * any absence / parse / shape error, and WARNS on a present-but-nonconforming
 * manifest so an un-provisioned preview is never silent.
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
      (dir) => writeManifest(dir, '{ "provision": { not valid json '),
      (dir) => expect(readPreviewManifest(dir)).toEqual({ root: [], byPackage: {} }),
    );
  });

  it('root provision.commands → loaded into root, byPackage empty', () => {
    withTempRoot(
      (dir) => writeManifest(dir, JSON.stringify({
        provision: { commands: ['npx prisma db push --skip-generate'] },
      })),
      (dir) => {
        const m = readPreviewManifest(dir);
        expect(m.root).toEqual(['npx prisma db push --skip-generate']);
        expect(m.byPackage).toEqual({});
      },
    );
  });

  it('decorative keys ($schema / name / description) are ignored, commands still loaded', () => {
    withTempRoot(
      (dir) => writeManifest(dir, JSON.stringify({
        $schema: 'https://ant.dev/schema/manifest.json',
        name: 'classboard-backend',
        provision: {
          description: 'apply prisma schema',
          commands: ['npx prisma generate', 'npx prisma db push --skip-generate'],
        },
      })),
      (dir) => {
        const m = readPreviewManifest(dir);
        expect(m.root).toEqual(['npx prisma generate', 'npx prisma db push --skip-generate']);
        expect(m.byPackage).toEqual({});
      },
    );
  });

  it('monorepo provision.packages[src].commands → keyed by source', () => {
    withTempRoot(
      (dir) => writeManifest(dir, JSON.stringify({
        provision: {
          packages: {
            'apps/api': { commands: ['npx prisma migrate deploy'] },
            'apps/worker': { commands: ['npm run db:seed'] },
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
        provision: {
          commands: ['npm run migrate:all'],
          packages: { 'apps/api': { commands: ['npm run seed'] } },
        },
      })),
      (dir) => {
        const m = readPreviewManifest(dir);
        expect(m.root).toEqual(['npm run migrate:all']);
        expect(m.byPackage).toEqual({ 'apps/api': ['npm run seed'] });
      },
    );
  });

  it('schema validation: non-string / empty entries dropped', () => {
    withTempRoot(
      (dir) => writeManifest(dir, JSON.stringify({
        provision: {
          commands: ['valid', 42, '', '  ', null],
          packages: {
            'apps/api': { commands: 'not-an-array' },
            'apps/ok': { commands: ['ok'] },
          },
        },
      })),
      (dir) => {
        const m = readPreviewManifest(dir);
        expect(m.root).toEqual(['valid']);
        // 'apps/api' has a non-array commands → dropped (no empty key)
        expect(m.byPackage).toEqual({ 'apps/ok': ['ok'] });
      },
    );
  });

  it('present but no "provision" object (e.g. legacy/wrong key) → empty result (warned, not coerced)', () => {
    withTempRoot(
      // The exact mis-keyed shape that caused the silent un-provisioned preview:
      (dir) => writeManifest(dir, JSON.stringify({
        preview: { setupCommands: ['npx prisma db push'] },
      })),
      (dir) => expect(readPreviewManifest(dir)).toEqual({ root: [], byPackage: {} }),
    );
  });

  it('provision object present but no commands anywhere → empty result (warned)', () => {
    withTempRoot(
      (dir) => writeManifest(dir, JSON.stringify({ provision: { description: 'todo' } })),
      (dir) => expect(readPreviewManifest(dir)).toEqual({ root: [], byPackage: {} }),
    );
  });
});
