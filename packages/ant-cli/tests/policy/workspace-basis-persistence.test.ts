/**
 * Workspace basis persistence SSOT — focal-molding-board fix (Part 2).
 *
 * The tier axes describe properties of the codebase (gameArtTier's
 * `perspective` selects plain-Phaser vs enable3d render paths), yet the
 * infer detect path hardcoded `basis: undefined` and nothing persisted a
 * settled tier — so every job re-inferred all axes at temperature > 0
 * (observed: perspective 2d→2d→3d + projectilePolicy simple→simple→complex
 * across three jobs on an unchanged project).
 *
 * Locks:
 *   1. Registry sanitizers (per-axis whitelist, drop-not-coerce).
 *   2. `validateWorkspaceConfig` round-trips a valid `basis` and drops
 *      invalid values.
 *   3. `persistSettledBasis` — write-once fill; explicit overwrite; raw
 *      config body preserved (no llmModels merge defaults baked in).
 *   4. `seedBasisFromWorkspace` — workspace tiers fill only what the
 *      explicit basis lacks.
 *   5. `observePerspectiveFromCodebase` — deterministic enable3d signal.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { sanitizeGameArtTier, sanitizeVisualTier } from '@ant/shared';
import { validateWorkspaceConfig } from '../../src/core/types/workspace';
import { persistSettledBasis } from '../../src/periphery/adapters/config/persistSettledBasis';
import { seedBasisFromWorkspace } from '../../src/agents/common/graph/nodes/detect';
import { observePerspectiveFromCodebase } from '../../src/agents/architect/graph/code/nodes/decompose';

const VALID_GAT = { concept: 'neonSynth', perspective: '2d', motionPattern: 'expressive' } as const;

describe('registry sanitizers — per-axis whitelist', () => {
  it('sanitizeGameArtTier keeps valid axes, drops invalid values', () => {
    expect(
      sanitizeGameArtTier({ ...VALID_GAT, perspective: 'isometric', bogusAxis: 'x' }),
    ).toEqual({ concept: 'neonSynth', motionPattern: 'expressive' });
  });

  it('sanitizeGameArtTier returns undefined when nothing valid survives', () => {
    expect(sanitizeGameArtTier({ concept: 'notAConcept' })).toBeUndefined();
    expect(sanitizeGameArtTier('string')).toBeUndefined();
    expect(sanitizeGameArtTier(undefined)).toBeUndefined();
  });

  it('sanitizeVisualTier keeps valid layers + designSystem passthrough', () => {
    expect(
      sanitizeVisualTier({ visualLanguage: 'modernSaas', surfaceSystem: 'nope', designSystem: 'aurora' }),
    ).toEqual({ visualLanguage: 'modernSaas', designSystem: 'aurora' });
    expect(sanitizeVisualTier({ surfaceSystem: 'nope' })).toBeUndefined();
  });
});

describe('validateWorkspaceConfig — basis slot', () => {
  const base = { projectName: 'p', repoType: 'cloud' };

  it('round-trips a valid basis', () => {
    const cfg = validateWorkspaceConfig({ ...base, basis: { gameArtTier: VALID_GAT } });
    expect(cfg.basis?.gameArtTier).toEqual(VALID_GAT);
  });

  it('drops invalid axis values and whole-invalid tiers', () => {
    const cfg = validateWorkspaceConfig({
      ...base,
      basis: { gameArtTier: { perspective: 'isometric' }, visualTier: { visualLanguage: 'modernSaas' } },
    });
    expect(cfg.basis?.gameArtTier).toBeUndefined();
    expect(cfg.basis?.visualTier).toEqual({ visualLanguage: 'modernSaas' });
  });

  it('yields no basis when input is absent or fully invalid', () => {
    expect(validateWorkspaceConfig(base).basis).toBeUndefined();
    expect(validateWorkspaceConfig({ ...base, basis: { gameArtTier: { concept: 'x' } } }).basis).toBeUndefined();
  });
});

describe('persistSettledBasis — write-once + explicit overwrite', () => {
  let dir: string;
  const configPath = () => path.join(dir, 'config.json');
  const readConfig = () => JSON.parse(fs.readFileSync(configPath(), 'utf8'));

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-basis-'));
    fs.writeFileSync(configPath(), JSON.stringify({ projectName: 'p', domain: 'game' }, null, 2));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('fills an absent tier (write-once) and reports true', () => {
    expect(persistSettledBasis({ gameArtTier: { ...VALID_GAT } }, { projectPath: dir })).toBe(true);
    expect(readConfig().basis.gameArtTier).toEqual(VALID_GAT);
  });

  it('does NOT clobber a stored tier with a newly settled value', () => {
    persistSettledBasis({ gameArtTier: { ...VALID_GAT } }, { projectPath: dir });
    const changed = persistSettledBasis(
      { gameArtTier: { concept: 'flatVector', perspective: '3d' } },
      { projectPath: dir },
    );
    expect(changed).toBe(false);
    expect(readConfig().basis.gameArtTier).toEqual(VALID_GAT);
  });

  it('explicit (wizard) tier overwrites the stored value', () => {
    persistSettledBasis({ gameArtTier: { ...VALID_GAT } }, { projectPath: dir });
    const changed = persistSettledBasis(
      { gameArtTier: { ...VALID_GAT } },
      { projectPath: dir, explicit: { gameArtTier: { concept: 'pixelArcade', perspective: '2d' } } },
    );
    expect(changed).toBe(true);
    expect(readConfig().basis.gameArtTier).toEqual({ concept: 'pixelArcade', perspective: '2d' });
  });

  it('sanitizes before writing — invalid axes never land on disk', () => {
    persistSettledBasis(
      { gameArtTier: { concept: 'neonSynth', perspective: 'isometric' } as never },
      { projectPath: dir },
    );
    expect(readConfig().basis.gameArtTier).toEqual({ concept: 'neonSynth' });
  });

  it('preserves the raw config body (no llmModels merge defaults baked in)', () => {
    persistSettledBasis({ gameArtTier: { ...VALID_GAT } }, { projectPath: dir });
    const raw = readConfig();
    expect(raw.llmModels).toBeUndefined();
    expect(raw.projectName).toBe('p');
    expect(raw.domain).toBe('game');
  });

  it('returns false without throwing when config.json is absent', () => {
    fs.rmSync(configPath());
    expect(persistSettledBasis({ gameArtTier: { ...VALID_GAT } }, { projectPath: dir })).toBe(false);
  });
});

describe('seedBasisFromWorkspace — detect-side read', () => {
  const stateWith = (basis: unknown) => ({ workspaceConfig: { basis } });

  it('fills tiers missing from the explicit basis', () => {
    const seeded = seedBasisFromWorkspace(
      stateWith({ gameArtTier: VALID_GAT, visualTier: { visualLanguage: 'modernSaas' } }),
      undefined,
    );
    expect(seeded?.gameArtTier).toEqual(VALID_GAT);
    expect(seeded?.visualTier).toEqual({ visualLanguage: 'modernSaas' });
  });

  it('explicit tier wins whole over the workspace tier', () => {
    const explicit = { gameArtTier: { concept: 'pixelArcade' } } as never;
    const seeded = seedBasisFromWorkspace(stateWith({ gameArtTier: VALID_GAT }), explicit);
    expect(seeded?.gameArtTier).toEqual({ concept: 'pixelArcade' });
  });

  it('returns the explicit basis untouched when no workspace basis exists', () => {
    const explicit = { techTier: { stack: 'frontend' } } as never;
    expect(seedBasisFromWorkspace({}, explicit)).toBe(explicit);
    expect(seedBasisFromWorkspace({}, undefined)).toBeUndefined();
  });
});

describe('observePerspectiveFromCodebase — deterministic enable3d signal', () => {
  let dir: string;
  const writePkg = (deps: Record<string, string>) => {
    fs.mkdirSync(path.join(dir, 'codebase'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'codebase', 'package.json'),
      JSON.stringify({ name: 'g', dependencies: deps }),
    );
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-persp-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('enable3d present → 3d', () => {
    writePkg({ phaser: '^3.80.0', enable3d: '^0.25.0' });
    expect(observePerspectiveFromCodebase(dir)).toBe('3d');
  });

  it('phaser without enable3d → 2d', () => {
    writePkg({ phaser: '^3.80.0' });
    expect(observePerspectiveFromCodebase(dir)).toBe('2d');
  });

  it('non-game codebase / missing manifest → undefined (no signal)', () => {
    writePkg({ react: '^19.0.0' });
    expect(observePerspectiveFromCodebase(dir)).toBeUndefined();
    fs.rmSync(path.join(dir, 'codebase'), { recursive: true, force: true });
    expect(observePerspectiveFromCodebase(dir)).toBeUndefined();
    expect(observePerspectiveFromCodebase(undefined)).toBeUndefined();
  });
});
