import { describe, it, expect, afterAll } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { pickAssetsRoot } from '@ant/shared';
import { indexAssetPool } from '../../src/infrastructure/workspace/assetInventory';

/**
 * Asset Surface Boundary (I6) regression: the shared `pickAssetsRoot` gate +
 * `indexAssetPool` must NEVER surface the other domain's pool. The old code
 * walked the whole `assets/` tree domain-blind, leaking `assets/service/*`
 * into a game code job.
 */
describe('indexAssetPool — domain-scoped inventory (I6)', () => {
  const feature = fs.mkdtempSync(path.join(os.tmpdir(), 'assetinv-'));
  afterAll(() => fs.rmSync(feature, { recursive: true, force: true }));

  // Seed BOTH pools so a domain-blind walk would mix them.
  const write = (rel: string) => {
    const abs = path.join(feature, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'x');
  };
  write('assets/game/entities/hero.png');
  write('assets/game/sfx/jump.wav');
  write('assets/service/icons/logo.svg');

  it('game domain sees only assets/game/*', () => {
    const inv = indexAssetPool({ featurePath: feature, assetsRoot: pickAssetsRoot({ workspaceDomain: 'game' }) });
    expect(inv.count).toBe(2);
    expect(inv.files.every(f => f.startsWith('assets/game/'))).toBe(true);
    expect(inv.files.some(f => f.startsWith('assets/service/'))).toBe(false);
    expect(Object.keys(inv.groups).sort()).toEqual(['entities', 'sfx']);
  });

  it('service domain sees only assets/service/*', () => {
    const inv = indexAssetPool({ featurePath: feature, assetsRoot: pickAssetsRoot({ workspaceDomain: 'service' }) });
    expect(inv.count).toBe(1);
    expect(inv.files).toEqual(['assets/service/icons/logo.svg']);
    expect(inv.files.some(f => f.startsWith('assets/game/'))).toBe(false);
  });

  it('empty pool → empty inventory (no throw)', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'assetinv-empty-'));
    try {
      const inv = indexAssetPool({ featurePath: empty, assetsRoot: pickAssetsRoot({ workspaceDomain: 'game' }) });
      expect(inv).toEqual({ files: [], groups: {}, count: 0, sizes: {}, corrupted: {} });
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('pickAssetsRoot precedence: workspace > rac > intentGroup > service default', () => {
    expect(pickAssetsRoot({ workspaceDomain: 'game', racDomain: 'service' })).toBe('assets/game');
    expect(pickAssetsRoot({ racDomain: 'game' })).toBe('assets/game');
    expect(pickAssetsRoot({ intentGroup: 'design-game-art' })).toBe('assets/game');
    expect(pickAssetsRoot({})).toBe('assets/service');
  });
});
