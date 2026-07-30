/**
 * `list_assets` — an unknown category must never read as an empty pool
 * (zero-hunting-label).
 *
 * The handler used to join the LLM-supplied `category` onto an ALREADY
 * domain-scoped pool root, so `game/models` resolved to
 * `assets/game/game/models`. `FileSystemPort.listFiles` returns `[]` for a
 * missing directory instead of throwing, so the miss was silent and the reply
 * was an affirmative denial — "No assets found. Add asset files under
 * assets/game/." The model believed that over its own `list_files` result and
 * designed around an asset it had been handed in the RAC.
 *
 * Locked here: the domain-prefixed form is tolerated, a genuinely unknown
 * category is distinguishable from an empty pool and names what does exist, and
 * both branches share ONE response shape so "zero" can be compared with "some".
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleListAssets } from '../../src/agents/architect/graph/design/nodes/tool/handlers/assets';

let featurePath: string;
const ASSETS_ROOT = 'assets/game';

function ctxFor(root: string) {
  return {
    featurePath: root,
    assetsRoot: ASSETS_ROOT,
    chatStatus: { showStatus: vi.fn(async () => 0) },
  } as any;
}

async function listAssets(category?: string) {
  const res = await handleListAssets(ctxFor(featurePath), category ? { category } : {});
  return JSON.parse(res.content as string);
}

beforeEach(() => {
  featurePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-list-assets-'));
  const models = path.join(featurePath, 'assets', 'game', 'models');
  fs.mkdirSync(models, { recursive: true });
  fs.writeFileSync(path.join(models, 'Duck.glb'), Buffer.alloc(2048));
});

afterEach(() => {
  fs.rmSync(featurePath, { recursive: true, force: true });
});

describe('handleListAssets', () => {
  it('lists the whole pool with paths, sizes and the available categories', async () => {
    const out = await listAssets();
    expect(out.categoryFound).toBe(true);
    expect(out.count).toBe(1);
    expect(out.availableCategories).toEqual(['models']);
    expect(out.assets[0].path).toBe('assets/game/models/Duck.glb');
    expect(out.assets[0].sizeBytes).toBe(2048);
  });

  it('resolves a bare category name', async () => {
    const out = await listAssets('models');
    expect(out.categoryFound).toBe(true);
    expect(out.count).toBe(1);
  });

  it('tolerates the domain-prefixed form that used to double the root', async () => {
    // `game/models` → `assets/game/game/models` before the fix → count 0.
    for (const form of ['game/models', 'assets/game/models', '/models/']) {
      const out = await listAssets(form);
      expect(out.categoryFound).toBe(true);
      expect(out.count).toBe(1);
      expect(out.assets[0].path).toBe('assets/game/models/Duck.glb');
    }
  });

  it('an unknown category is NOT reported as an empty pool, and names what exists', async () => {
    const out = await listAssets('sprites');
    expect(out.categoryFound).toBe(false);
    expect(out.count).toBe(0);
    // The pool is NOT empty — that distinction is the whole fix.
    expect(out.total).toBe(1);
    expect(out.availableCategories).toEqual(['models']);
    expect(out.message).toContain('sprites');
    expect(out.message).toContain('models');
    expect(out.message).not.toMatch(/No assets found/i);
  });

  it('an empty pool says so, in the same response shape', async () => {
    fs.rmSync(path.join(featurePath, 'assets'), { recursive: true, force: true });
    const out = await listAssets();
    expect(out.count).toBe(0);
    expect(out.total).toBe(0);
    expect(out.availableCategories).toEqual([]);
    expect(out.message).toContain('empty');
    // Same keys as the populated branch — "zero" is comparable with "some".
    expect(Object.keys(out)).toEqual(
      expect.arrayContaining(['assetsRoot', 'category', 'categoryFound', 'availableCategories', 'assets', 'count', 'total']),
    );
  });
});
