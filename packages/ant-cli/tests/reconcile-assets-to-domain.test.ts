/**
 * Phase 2 (D19/D22) — `reconcileAssetsToDomain` integration test.
 *
 * Locks the two wiring contracts:
 *   1. Workspace boot — given a project tree with `<projectPath>/config.json`
 *      that declares `domain`, `reconcileAssetsToDomain(featurePath)`
 *      auto-discovers the domain and migrates legacy assets in-place.
 *   2. Domain toggle — `reconcileProjectAssetsToDomain({ projectPathAbs,
 *      domain })` walks every feature under `features/` and applies the
 *      same migration with the freshly-toggled domain.
 *
 * Both contracts are idempotent (a second pass returns
 * `alreadyMigrated: true` with zero stat counts), and the helpers MUST
 * never throw on malformed inputs — failures degrade to silent noops so
 * canonical-structure boot remains unblocked.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  reconcileAssetsToDomain,
  reconcileProjectAssetsToDomain,
} from '../src/infrastructure/workspace/reconcileAssetsToDomain';

async function writeFile(p: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content, 'utf8');
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

describe('reconcileAssetsToDomain (Phase 2 — D19/D22)', () => {
  let sandbox: string;
  let projectPath: string;
  let featurePath: string;

  beforeEach(async () => {
    sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-reconcile-'));
    projectPath = path.join(sandbox, 'org', 'user', 'demo-project');
    featurePath = path.join(projectPath, 'features', 'skeleton');
    await fs.mkdir(featurePath, { recursive: true });
  });

  afterEach(async () => {
    if (sandbox && fsSync.existsSync(sandbox)) {
      await fs.rm(sandbox, { recursive: true, force: true });
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Workspace boot path
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  it('auto-discovers config.json and migrates legacy icons → game pool', async () => {
    await writeFile(
      path.join(projectPath, 'config.json'),
      JSON.stringify({ projectName: 'demo-project', domain: 'game' }),
    );
    await writeFile(
      path.join(featurePath, 'inputs/assets/icons/hero.svg'),
      '<svg/>',
    );
    await writeFile(
      path.join(featurePath, 'inputs/assets/images/bg.png'),
      'fake-png',
    );

    const result = await reconcileAssetsToDomain(featurePath);
    expect(result).not.toBeNull();
    expect(result!.domain).toBe('game');
    expect(result!.alreadyMigrated).toBe(false);
    expect(result!.stats.moved).toBe(2);
    expect(result!.stats.failed).toBe(0);

    expect(
      await pathExists(path.join(featurePath, 'inputs/assets/game/icons/hero.svg')),
    ).toBe(true);
    expect(
      await pathExists(path.join(featurePath, 'inputs/assets/game/images/bg.png')),
    ).toBe(true);
    expect(
      await pathExists(path.join(featurePath, 'inputs/assets/icons/hero.svg')),
    ).toBe(false);
  });

  it('routes service workspaces to inputs/assets/service/', async () => {
    await writeFile(
      path.join(projectPath, 'config.json'),
      JSON.stringify({ projectName: 'demo-project', domain: 'service' }),
    );
    await writeFile(
      path.join(featurePath, 'inputs/assets/icons/logo.svg'),
      '<svg/>',
    );

    const result = await reconcileAssetsToDomain(featurePath);
    expect(result!.domain).toBe('service');
    expect(
      await pathExists(path.join(featurePath, 'inputs/assets/service/icons/logo.svg')),
    ).toBe(true);
  });

  it('falls back to service when config.json exists but lacks a domain field', async () => {
    await writeFile(
      path.join(projectPath, 'config.json'),
      JSON.stringify({ projectName: 'demo-project' }), // no domain
    );
    await writeFile(
      path.join(featurePath, 'inputs/assets/icons/legacy.svg'),
      '<svg/>',
    );

    const result = await reconcileAssetsToDomain(featurePath);
    expect(result!.domain).toBe('service');
    expect(
      await pathExists(path.join(featurePath, 'inputs/assets/service/icons/legacy.svg')),
    ).toBe(true);
  });

  it('returns null when no config.json is reachable in the parent chain', async () => {
    // No config.json anywhere — workspace boot should NOT block.
    await writeFile(
      path.join(featurePath, 'inputs/assets/icons/lonely.svg'),
      '<svg/>',
    );
    const result = await reconcileAssetsToDomain(featurePath);
    expect(result).toBeNull();
    // Legacy file is left untouched (no migration without a known domain).
    expect(
      await pathExists(path.join(featurePath, 'inputs/assets/icons/lonely.svg')),
    ).toBe(true);
  });

  it('is idempotent — second pass returns alreadyMigrated: true', async () => {
    await writeFile(
      path.join(projectPath, 'config.json'),
      JSON.stringify({ projectName: 'demo-project', domain: 'game' }),
    );
    await writeFile(
      path.join(featurePath, 'inputs/assets/icons/hero.svg'),
      '<svg/>',
    );

    const first = await reconcileAssetsToDomain(featurePath);
    expect(first!.alreadyMigrated).toBe(false);

    const second = await reconcileAssetsToDomain(featurePath);
    expect(second!.alreadyMigrated).toBe(true);
    expect(second!.stats.moved).toBe(0);
  });

  it('rewrites ui-assets.json src paths to the resolved domain pool', async () => {
    await writeFile(
      path.join(projectPath, 'config.json'),
      JSON.stringify({ projectName: 'demo-project', domain: 'service' }),
    );
    await writeFile(
      path.join(featurePath, 'inputs/assets/icons/logo.svg'),
      '<svg/>',
    );
    const manifestPath = path.join(featurePath, 'outputs/design/ui/ant/ui-assets.json');
    await writeFile(
      manifestPath,
      JSON.stringify({
        items: [
          { id: 'logo', src: 'inputs/assets/icons/logo.svg' },
        ],
      }, null, 2),
    );

    const result = await reconcileAssetsToDomain(featurePath);
    expect(result!.uiAssetsRewritten).toBe(1);

    const rewritten = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    expect(rewritten.items[0].src).toBe('inputs/assets/service/icons/logo.svg');
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Domain-toggle path (project-wide reconcile)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  it('reconcileProjectAssetsToDomain walks every feature with the new domain', async () => {
    const featureA = path.join(projectPath, 'features', 'feature-a');
    const featureB = path.join(projectPath, 'features', 'feature-b');
    await writeFile(path.join(featureA, 'inputs/assets/icons/a.svg'), '<svg/>');
    await writeFile(path.join(featureB, 'inputs/assets/images/b.png'), 'png');

    const result = await reconcileProjectAssetsToDomain({
      projectPathAbs: projectPath,
      domain: 'game',
    });

    expect(Object.keys(result).sort()).toEqual(['feature-a', 'feature-b', 'skeleton'].sort());
    for (const key of ['feature-a', 'feature-b']) {
      const r = result[key];
      expect('error' in r).toBe(false);
      const ok = r as Exclude<typeof r, { error: string }>;
      expect(ok.domain).toBe('game');
      expect(ok.alreadyMigrated).toBe(false);
    }

    expect(
      await pathExists(path.join(featureA, 'inputs/assets/game/icons/a.svg')),
    ).toBe(true);
    expect(
      await pathExists(path.join(featureB, 'inputs/assets/game/images/b.png')),
    ).toBe(true);
  });

  it('reconcileProjectAssetsToDomain returns {} when features/ is absent', async () => {
    // Wipe the auto-created skeleton so features/ does not exist.
    await fs.rm(path.join(projectPath, 'features'), { recursive: true, force: true });
    const result = await reconcileProjectAssetsToDomain({
      projectPathAbs: projectPath,
      domain: 'game',
    });
    expect(result).toEqual({});
  });

  it('reconcileProjectAssetsToDomain skips dotfiles and non-directories', async () => {
    await writeFile(
      path.join(projectPath, 'features', '.hidden-marker'),
      'leftover',
    );
    await writeFile(
      path.join(projectPath, 'features', 'README.md'),
      '# notes',
    );
    const result = await reconcileProjectAssetsToDomain({
      projectPathAbs: projectPath,
      domain: 'service',
    });
    // Only the seeded `skeleton` feature remains as a real directory.
    expect(Object.keys(result)).toEqual(['skeleton']);
  });
});
