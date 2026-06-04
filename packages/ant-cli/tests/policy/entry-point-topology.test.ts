/**
 * Entry-point topology — per-screen route ownership (Axis 1).
 *
 * Locks the fix for the `west-beating-shelf` orphan-screen defect: per-screen
 * route files (App Router page files) are owned by the consumer-band task that
 * AUTHORS the screen, not the `integration` band. integration owns only
 * app-shell + central-registry entries. The discriminator is the framework's
 * entry-point topology (`file-per-route` vs `shared-registry`).
 *
 * Covers:
 *   1. entryPointTopology() — the framework→topology SSOT map.
 *   2. entry-point-ownership-rule render truth-table (consumer + integration
 *      branches × topology).
 *   3. entry-point-ownership-checklist sync (consumer + file-per-route).
 *   4. decompose "Shared Integration Points" — topology branch + closure.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { entryPointTopology } from '@ant/shared';
import {
  FilePromptAdapter,
  initPartials,
} from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATES_DIR = join(__dirname, '../../src/core/prompt/templates');
const RULE = 'jobs/code/base/injections/entry-point-ownership-rule';
const CHECK = 'jobs/code/base/injections/entry-point-ownership-checklist';
const DECOMPOSE_RULES = 'jobs/code/nodes/decompose/variants/default/rules';

describe('entryPointTopology() — framework→topology SSOT', () => {
  it('nextjs is the only file-per-route framework', () => {
    expect(entryPointTopology('nextjs')).toBe('file-per-route');
  });

  it('react / react-native / nestjs / gin are shared-registry', () => {
    expect(entryPointTopology('react')).toBe('shared-registry');
    expect(entryPointTopology('react-native')).toBe('shared-registry');
    expect(entryPointTopology('nestjs')).toBe('shared-registry');
    expect(entryPointTopology('gin')).toBe('shared-registry');
  });

  it('frameworkless / none / unknown → undefined (topology branches stay inert)', () => {
    expect(entryPointTopology(undefined)).toBeUndefined();
    expect(entryPointTopology(null)).toBeUndefined();
    expect(entryPointTopology('')).toBeUndefined();
    expect(entryPointTopology('none')).toBeUndefined();
    expect(entryPointTopology('svelte')).toBeUndefined();
  });
});

describe('entry-point-ownership-rule — topology truth-table', () => {
  const adapter = new FilePromptAdapter();

  it('consumer + file-per-route: per-screen route is YOURS, create AND wire it', async () => {
    const out = await adapter.render(RULE, { entryPointTopology: 'file-per-route' });
    expect(out).toMatch(/per-screen route entry that mounts a screen YOU author is YOURS/);
    expect(out).toMatch(/creates AND wires its route file/);
    expect(out).toMatch(/do NOT leave it a placeholder/i);
    // must NOT defer to integration for per-screen mounting
    expect(out).not.toMatch(/the dedicated `integration` band task will handle it/);
  });

  it('consumer + shared-registry: registry is integration-owned, do not author it', async () => {
    const out = await adapter.render(RULE, { entryPointTopology: 'shared-registry' });
    expect(out).toMatch(/central registry owned by the `integration` band/);
    expect(out).toMatch(/do NOT author that registry/);
  });

  it('consumer + undefined topology: legacy fallback (integration handles registration)', async () => {
    const out = await adapter.render(RULE, {}); // no taskBand, no topology
    expect(out).toMatch(/the dedicated `integration` band task will handle it/);
  });

  it('integration branch owns app-shell + registry, NOT per-screen routes', async () => {
    const out = await adapter.render(RULE, { taskBand: 'integration', entryPointTopology: 'file-per-route' });
    expect(out).toMatch(/app-shell and registry entries/);
    expect(out).toMatch(/per-screen route entry — one that mounts exactly ONE screen — is NOT yours/);
    expect(out).toMatch(/do NOT create per-screen route files/);
  });

  it('platform branch invites recording the DI consumption convention (Axis 2)', async () => {
    const out = await adapter.render(RULE, { taskBand: 'platform' });
    expect(out).toMatch(/consumption mechanism/);
    expect(out).toMatch(/ANTRULES/);
  });
});

describe('entry-point-ownership-checklist — sync', () => {
  const adapter = new FilePromptAdapter();

  it('consumer + file-per-route mentions per-screen route ownership', async () => {
    const out = await adapter.render(CHECK, { entryPointTopology: 'file-per-route' });
    expect(out).toMatch(/per-screen route file that mounts a screen you author/);
  });

  it('integration line scopes to app-shell + registry, excludes per-screen', async () => {
    const out = await adapter.render(CHECK, { taskBand: 'integration' });
    expect(out).toMatch(/app-shell \+ registry entries/);
    expect(out).toMatch(/per-screen route that mounts ONE screen is NOT yours/);
  });
});

describe('decompose Shared Integration Points — topology branch + closure', () => {
  let adapter: FilePromptAdapter;
  const BASE_VARS: Record<string, any> = {
    directive: 'Build a multi-screen app', techTier: { language: 'typescript', stack: 'frontend' },
    hasExistingCode: false, codebaseFilePaths: [], fileList: '', hasDocuments: false, documents: [],
    hasCompactedArtifacts: false, hasErrorInDirective: false, hasUi: false, uiSource: undefined,
    hasRuntimeError: false, isExplicitPipeline: false, visualTierActive: false, gameArtTierActive: false,
    gameContentTierActive: false, domainTierActive: false, needsBoundaryClassification: false,
    specClarifyBypassed: false, intentClarifyDisabled: true, isPriorityFromSpec: false,
  };

  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
  });

  it('file-per-route: no route-integration task, per-screen page in author create-list', async () => {
    const out = await adapter.render(DECOMPOSE_RULES, { ...BASE_VARS, entryPointTopology: 'file-per-route' });
    expect(out).toMatch(/file-per-route/);
    expect(out).toMatch(/Do NOT emit a dedicated integration task to wire per-screen routes/);
    // closure principle present regardless of topology
    expect(out).toMatch(/placeholder/);
  });

  it('shared-registry: screen creation in feature band, registry via integration task', async () => {
    const out = await adapter.render(DECOMPOSE_RULES, { ...BASE_VARS, entryPointTopology: 'shared-registry' });
    expect(out).toMatch(/central registry/);
    expect(out).toMatch(/Screen \*creation\* goes in the \*\*feature band\*\*/);
  });

  it('closure principle: a routable surface with no mounting-entry task is dead', async () => {
    const out = await adapter.render(DECOMPOSE_RULES, { ...BASE_VARS, entryPointTopology: 'file-per-route' });
    expect(out).toMatch(/dead, unreachable screen/);
  });
});

describe('antrules guidance — DI consumption convention class (Axis 2)', () => {
  const adapter = new FilePromptAdapter();

  it('existing-ledger branch lists the DI/shared-service consumption class', async () => {
    const out = await adapter.render('jobs/code/base/injections/antrules', { antrulesContent: '# ANTRULES.md\n(seed)' });
    expect(out).toMatch(/Shared-service consumption \/ dependency-injection convention/);
    expect(out).toMatch(/never import the adapter singleton directly/);
  });

  it('empty-ledger branch seeds the DI convention too', async () => {
    const out = await adapter.render('jobs/code/base/injections/antrules', {});
    expect(out).toMatch(/shared-service consumption \/ DI convention/);
  });
});
