/**
 * Entry-point ownership — per-unit vs host entry, node-scoped per-framework.
 *
 * Locks the consistency redesign on top of the `west-beating-shelf` orphan-screen
 * fix (commit 95497bd1): the orphan-screen intent is preserved, but the FE-noun
 * leakage + `entryPointTopology` var have been removed. The ownership boundary is
 * now expressed as a UNIVERSAL principle in the always-injected partials
 * (host entry vs per-unit entry), while the file-per-route vs shared-registry
 * specifics live behind the framework tech-tier gate (the `_entry-points-*`
 * partials) and a new decompose node-scoped per-framework injection.
 *
 * Covers:
 *   1. universal partials (rule / checklist / decompose rules) — neutral
 *      vocabulary only, no FE nouns, no topology `{{#if}}` branch, no leftover
 *      `entryPointTopology` reference.
 *   2. `_entry-points-file-per-route` / `_entry-points-shared-registry` partials
 *      carry the ownership rule body.
 *   3. framework basis files include the correct topology partial.
 *   4. decompose node-scoped `injections/framework/<fw>` render the right
 *      perspective; backend files carry no FE nouns.
 *   5. antrules DI consumption-convention class (Axis 2, unchanged direction).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { readFileSync } from 'node:fs';
import {
  FilePromptAdapter,
  initPartials,
} from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATES_DIR = join(__dirname, '../../src/core/prompt/templates');
const RULE = 'jobs/code/base/injections/entry-point-ownership-rule';
const CHECK = 'jobs/code/base/injections/entry-point-ownership-checklist';
const DECOMPOSE_RULES = 'jobs/code/nodes/decompose/variants/default/rules';
const FW_PARTIAL = 'jobs/code/basis/techTier/framework';
const DECOMPOSE_FW = 'jobs/code/nodes/decompose/injections/framework';

const FE_NOUNS = /app-shell|root layout|provider tree|global navigation|\bscreen\b|per-screen/i;
const FILE_PER_ROUTE_MARKER = /each route is its own file/;
const SHARED_REGISTRY_MARKER = /many units register into one place/;

describe('entry-point-ownership-rule — neutral universal principle', () => {
  const adapter = new FilePromptAdapter();

  it('source carries no FE nouns and no topology branch / leftover var', () => {
    const src = readFileSync(
      join(TEMPLATES_DIR, 'jobs/code/base/injections/entry-point-ownership-rule.md'),
      'utf8',
    );
    // strip the {{!-- ... --}} authoring comment; the FPOP note legitimately
    // names the forbidden nouns to forbid them, which is not body leakage.
    const body = src.replace(/\{\{!--[\s\S]*?--\}\}/g, '');
    expect(body).not.toMatch(FE_NOUNS);
    expect(body).not.toContain('entryPointTopology');
    expect(body).not.toContain('file-per-route');
    expect(body).not.toContain('shared-registry');
  });

  it('consumer branch: per-unit entry you author is yours, closure mandatory', async () => {
    const out = await adapter.render(RULE, {});
    expect(out).toMatch(/per-unit entry that mounts a unit YOU author is YOURS/);
    expect(out).toMatch(/do NOT leave it a placeholder/i);
    expect(out).toMatch(/tech-tier partial pins how this framework expresses that entry/);
  });

  it('integration branch: owns host entries, NOT per-unit entries', async () => {
    const out = await adapter.render(RULE, { taskBand: 'integration' });
    expect(out).toMatch(/You own \*\*host entries\*\*/);
    expect(out).toMatch(/per-unit entry — one that serves exactly ONE unit — is NOT yours/);
    expect(out).not.toMatch(FE_NOUNS);
  });

  it('platform branch invites recording the DI consumption convention (Axis 2)', async () => {
    const out = await adapter.render(RULE, { taskBand: 'platform' });
    expect(out).toMatch(/consumption mechanism/);
    expect(out).toMatch(/ANTRULES/);
  });
});

describe('entry-point-ownership-checklist — neutral, in sync', () => {
  const adapter = new FilePromptAdapter();

  it('source carries no FE nouns and no topology branch', () => {
    const src = readFileSync(
      join(TEMPLATES_DIR, 'jobs/code/base/injections/entry-point-ownership-checklist.md'),
      'utf8',
    );
    const body = src.replace(/\{\{!--[\s\S]*?--\}\}/g, '');
    expect(body).not.toMatch(FE_NOUNS);
    expect(body).not.toContain('entryPointTopology');
  });

  it('consumer line defers per-unit form to the tech-tier partial', async () => {
    const out = await adapter.render(CHECK, {});
    expect(out).toMatch(/per-unit entry/);
    expect(out).toMatch(/tech-tier partial/);
  });

  it('integration line scopes to host entries, excludes per-unit', async () => {
    const out = await adapter.render(CHECK, { taskBand: 'integration' });
    expect(out).toMatch(/You own host entries/);
    expect(out).toMatch(/per-unit entry that serves ONE unit is NOT yours/);
  });
});

describe('_entry-points-* partials — ownership rule body SSOT', () => {
  const adapter = new FilePromptAdapter();

  it('file-per-route partial: author owns per-unit route, closure', async () => {
    const out = await adapter.render(`${FW_PARTIAL}/_entry-points-file-per-route`, {});
    expect(out).toMatch(FILE_PER_ROUTE_MARKER);
    expect(out).toMatch(/owned by the task that AUTHORS that unit/);
    expect(out).toMatch(/dead, unreachable surface/);
  });

  it('shared-registry partial: registry is integration-owned, units in feature band', async () => {
    const out = await adapter.render(`${FW_PARTIAL}/_entry-points-shared-registry`, {});
    expect(out).toMatch(SHARED_REGISTRY_MARKER);
    expect(out).toMatch(/authored in the feature band/);
    expect(out).toMatch(/`integration` band/);
  });
});

describe('framework basis files include the correct topology partial', () => {
  let adapter: FilePromptAdapter;

  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
  });

  it('nextjs → file-per-route (with concrete app/page.tsx), NOT shared-registry', async () => {
    const out = await adapter.render(`${FW_PARTIAL}/nextjs`, {});
    expect(out).toMatch(FILE_PER_ROUTE_MARKER);
    expect(out).toContain('app/page.tsx');
    expect(out).toContain('app/layout.tsx');
    expect(out).not.toMatch(SHARED_REGISTRY_MARKER);
  });

  it.each(['react', 'react-native', 'nestjs', 'gin'])(
    '%s → shared-registry, NOT file-per-route',
    async (fw) => {
      const out = await adapter.render(`${FW_PARTIAL}/${fw}`, {});
      expect(out).toMatch(SHARED_REGISTRY_MARKER);
      expect(out).not.toMatch(FILE_PER_ROUTE_MARKER);
    },
  );
});

describe('decompose node-scoped per-framework injection', () => {
  let adapter: FilePromptAdapter;

  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
  });

  it('nextjs: file-per-route body + per-route-page-in-create-list decompose line', async () => {
    const out = await adapter.render(`${DECOMPOSE_FW}/nextjs`, {});
    expect(out).toMatch(FILE_PER_ROUTE_MARKER);
    expect(out).toMatch(/per-route page is part of the `create` list/);
    expect(out).toMatch(/do NOT emit a separate route-integration task/i);
  });

  it('gin (backend): shared-registry body + router decompose line, NO FE nouns', async () => {
    const out = await adapter.render(`${DECOMPOSE_FW}/gin`, {});
    expect(out).toMatch(SHARED_REGISTRY_MARKER);
    expect(out).toMatch(/router setup is owned by exactly ONE `integration` task/);
    expect(out).not.toMatch(FE_NOUNS);
    expect(out).not.toMatch(/\blayout\b/i);
  });

  it('nestjs (backend): shared-registry body, NO FE nouns', async () => {
    const out = await adapter.render(`${DECOMPOSE_FW}/nestjs`, {});
    expect(out).toMatch(SHARED_REGISTRY_MARKER);
    expect(out).toMatch(/root module composition is owned by exactly ONE `integration` task/);
    expect(out).not.toMatch(FE_NOUNS);
  });
});

describe('decompose Shared Integration Points — neutral host/per-unit + closure', () => {
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

  it('uses neutral host-entry / per-unit vocabulary and defers framework form', async () => {
    const out = await adapter.render(DECOMPOSE_RULES, BASE_VARS);
    expect(out).toMatch(/host entry/);
    expect(out).toMatch(/per-unit entr/);
    expect(out).toMatch(/per-framework entry-point guidance injected for this split/);
    expect(out).not.toMatch(/app-shell/);
    expect(out).not.toContain('entryPointTopology');
  });

  it('closure principle: a routable surface with no mounting-entry task is dead', async () => {
    const out = await adapter.render(DECOMPOSE_RULES, BASE_VARS);
    expect(out).toMatch(/dead, unreachable surface/);
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
