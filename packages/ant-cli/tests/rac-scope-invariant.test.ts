/**
 * RAC scope invariant — `state.artifacts ⊆ resolvedAction.refs ∪ context`.
 *
 * Locks the post-RAC SSOT introduced after the `prime-jetting-grate`
 * regression: a wholesale `outputs/design/system/**` load on the resolve
 * node injected `fe-system-main.md` into a `gen-code-directive` job whose
 * RAC explicitly excluded system-design slots. The leak surfaced through
 * three independent channels — decompose `tierRefs`, decompose `documents`,
 * and `deriveArtifactPolicy` package mapping — yet none was strictly
 * RAC-bounded. Pinning the pool itself to the RAC subset closes all three
 * at once. See `.cursorrules` "state.artifacts Post-RAC SSOT".
 *
 * The `mossy-nearing-gleam` follow-up regression (Apr 26 2026) showed the
 * pool fix alone was insufficient: two compensating channels remained —
 *
 *   Channel A: decompose `discoveryTools` (`read_file` / `list_files`,
 *              scope=`artifact`) bypassed the RAC entirely because its
 *              path validation only checked traversal/root containment.
 *              Closure: explicit RAC injects a `racScope` whitelist so
 *              tool calls outside `refs ∪ context` are rejected.
 *
 *   Channel B: `deriveArtifactPolicy` synthesised `refs` paths from the
 *              LLM's `packages` tag (e.g. `fe-main → fe-system-main.md`)
 *              regardless of pool membership. Closure: the function
 *              accepts an `ArtifactPolicyMode`; explicit pipelines
 *              suppress package→ref mapping.
 *
 * The Channel A/B locks live in this file so a single regression test
 * suite covers every leak path that has ever bypassed the pool SSOT.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadResolvedArtifacts } from '../src/agents/common/graph/loadDocumentsForRAC';
import {
  createTaskQueue,
  deriveArtifactPolicy,
} from '../src/agents/architect/graph/code/nodes/decompose/responseParser';
import {
  handleListFiles,
  handleReadFile,
  createClarifyContext,
  type DiscoveryToolContext,
} from '../src/agents/architect/graph/code/nodes/decompose/discoveryTools';
import type { ResolvedActionContext } from '@ant/shared';
import { ARTIFACT_PREFIX } from '@ant/shared';

function rac(intent: string, refs: string[] = [], context: string[] = []): ResolvedActionContext {
  return {
    intent,
    intentGroup: 'gen-code',
    mode: 'generate',
    source: 'explicit',
    hasExplicitFields: refs.length + context.length > 0,
    refs: refs.length > 0 ? refs : undefined,
    context: context.length > 0 ? context : undefined,
  } as unknown as ResolvedActionContext;
}

describe('RAC scope invariant — state.artifacts ⊆ RAC', () => {
  let featurePath: string;

  beforeAll(() => {
    featurePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-rac-scope-'));

    const sourcesDir = path.join(featurePath, 'inputs/sources');
    fs.mkdirSync(sourcesDir, { recursive: true });
    fs.writeFileSync(path.join(sourcesDir, 'prd.md'), '# PRD\n\nProduct requirements.');

    const sysDir = path.join(featurePath, 'outputs/design/system');
    fs.mkdirSync(sysDir, { recursive: true });
    fs.writeFileSync(
      path.join(sysDir, 'fe-system-main.md'),
      '# fe-system-main\n\nFrontend system design referencing Cross SDK.',
    );
    fs.writeFileSync(
      path.join(sysDir, 'api-contract-public.md'),
      '# api-contract-public\n\nPublic API contract.',
    );

    const specDir = path.join(featurePath, 'outputs/design/spec');
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(path.join(specDir, 'spec-foo.md'), '# spec-foo\n\nFeature spec.');
  });

  afterAll(() => {
    if (featurePath) fs.rmSync(featurePath, { recursive: true, force: true });
  });

  it('gen-code-directive (PRD-only context) does NOT pull in fe-system-main.md from disk', () => {
    // Reproduces the `prime-jetting-grate` scenario: user picks a directive
    // intent with the PRD as sole context, while disk also holds an
    // unrelated `outputs/design/system/fe-system-main.md`. The pool must
    // remain bounded by the RAC.
    const ra = rac('gen-code-directive', [], ['inputs/sources/prd.md']);
    const artifacts = loadResolvedArtifacts(ra, featurePath);

    const paths = artifacts.map(a => a.path).sort();
    expect(paths).toEqual(['inputs/sources/prd.md']);

    const racPaths = new Set([...(ra.refs ?? []), ...(ra.context ?? [])]);
    for (const a of artifacts) {
      expect(racPaths.has(a.path)).toBe(true);
    }
  });

  it('regression-free: gen-code-sys with explicit fe-system ref still loads it', () => {
    // Sanity check that the SSOT does not over-tighten — the legitimate
    // path (sys-design intent with system-design files explicitly listed
    // as ref) must still hydrate the pool.
    const ra = rac(
      'gen-code-sys',
      ['outputs/design/system/fe-system-main.md', 'outputs/design/system/api-contract-public.md'],
      ['inputs/sources/prd.md'],
    );
    const artifacts = loadResolvedArtifacts(ra, featurePath);

    const paths = artifacts.map(a => a.path).sort();
    expect(paths).toEqual([
      'inputs/sources/prd.md',
      'outputs/design/system/api-contract-public.md',
      'outputs/design/system/fe-system-main.md',
    ]);

    const fe = artifacts.find(a => a.path.endsWith('fe-system-main.md'));
    expect(fe?.role).toBe('ref');
    expect(fe?.content).toContain('Cross SDK');
  });

  it('directory slot — `outputs/design/spec/` walks into spec-*.md only when listed', () => {
    // Directory slot semantics: `loadResolvedArtifacts` walks the directory,
    // so design-spec intents that put the `spec/` dir into `refs` get every
    // spec file recursively. Directive intents (no spec slot) must not.
    const directiveOnly = loadResolvedArtifacts(
      rac('gen-code-directive', [], ['inputs/sources/prd.md']),
      featurePath,
    );
    expect(directiveOnly.some(a => a.path.startsWith('outputs/design/spec/'))).toBe(false);

    const specBased = loadResolvedArtifacts(
      rac('gen-code-spec', ['outputs/design/spec'], ['inputs/sources/prd.md']),
      featurePath,
    );
    expect(specBased.some(a => a.path === 'outputs/design/spec/spec-foo.md')).toBe(true);
  });

  it('empty RAC produces empty pool (no implicit disk pickups)', () => {
    const artifacts = loadResolvedArtifacts(rac('gen-code-directive'), featurePath);
    expect(artifacts).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────
// Channel A — decompose discovery tools must respect explicit RAC scope
// ───────────────────────────────────────────────────────────────────────

describe('discoveryTools RAC whitelist (Channel A — `mossy-nearing-gleam`)', () => {
  let featurePath: string;

  beforeAll(() => {
    featurePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-rac-discovery-'));
    fs.mkdirSync(path.join(featurePath, 'inputs/sources'), { recursive: true });
    fs.writeFileSync(path.join(featurePath, 'inputs/sources/prd.md'), '# PRD\n');
    fs.mkdirSync(path.join(featurePath, 'outputs/design/system'), { recursive: true });
    fs.writeFileSync(
      path.join(featurePath, 'outputs/design/system/fe-system-main.md'),
      '# fe-system-main — Cross SDK adapter contract',
    );
    fs.mkdirSync(path.join(featurePath, 'outputs/design/spec'), { recursive: true });
    fs.writeFileSync(path.join(featurePath, 'outputs/design/spec/spec-foo.md'), '# spec-foo');
  });

  afterAll(() => {
    if (featurePath) fs.rmSync(featurePath, { recursive: true, force: true });
  });

  function ctx(racScope?: DiscoveryToolContext['racScope']): DiscoveryToolContext {
    return {
      featurePath,
      clarify: createClarifyContext(),
      racScope,
    };
  }

  it('explicit RAC blocks read_file on a non-RAC artifact path', () => {
    const result = handleReadFile(
      { scope: 'artifact', path: 'outputs/design/system/fe-system-main.md' },
      ctx({ refs: [], context: ['inputs/sources/prd.md'] }),
    );
    expect(result).toMatch(/outside the RAC selection/);
    expect(result).not.toContain('Cross SDK');
  });

  it('explicit RAC blocks list_files on a non-RAC directory', () => {
    const result = handleListFiles(
      { scope: 'artifact', directory: 'outputs/design/system' },
      ctx({ refs: [], context: ['inputs/sources/prd.md'] }),
    );
    expect(result).toMatch(/outside the RAC selection/);
    expect(result).not.toContain('fe-system-main');
  });

  it('explicit RAC permits read_file on a RAC member path', () => {
    const result = handleReadFile(
      { scope: 'artifact', path: 'inputs/sources/prd.md' },
      ctx({ refs: [], context: ['inputs/sources/prd.md'] }),
    );
    expect(result).toContain('# PRD');
  });

  it('directory RAC entry permits read on descendants but rejects siblings', () => {
    // RAC pins `outputs/design/spec/` as a directory slot.
    const allowed = handleReadFile(
      { scope: 'artifact', path: 'outputs/design/spec/spec-foo.md' },
      ctx({ refs: ['outputs/design/spec'], context: [] }),
    );
    expect(allowed).toContain('# spec-foo');

    const denied = handleReadFile(
      { scope: 'artifact', path: 'outputs/design/system/fe-system-main.md' },
      ctx({ refs: ['outputs/design/spec'], context: [] }),
    );
    expect(denied).toMatch(/outside the RAC selection/);
  });

  it('list_files allowed on a parent of a RAC directory entry', () => {
    // Listing `outputs/design` is needed when the LLM wants to inspect
    // siblings of a pinned `outputs/design/spec/` directory slot.
    const result = handleListFiles(
      { scope: 'artifact', directory: 'outputs/design' },
      ctx({ refs: ['outputs/design/spec'], context: [] }),
    );
    expect(result).not.toMatch(/outside the RAC selection/);
  });

  it('infer pipeline (no racScope) preserves legacy behaviour', () => {
    const result = handleReadFile(
      { scope: 'artifact', path: 'outputs/design/system/fe-system-main.md' },
      ctx(undefined),
    );
    expect(result).toContain('Cross SDK');
  });
});

// ───────────────────────────────────────────────────────────────────────
// Channel B — deriveArtifactPolicy / createTaskQueue must respect mode
// ───────────────────────────────────────────────────────────────────────

describe('deriveArtifactPolicy mode gate (Channel B — `mossy-nearing-gleam`)', () => {
  it('explicit mode + fe-main packages → no auto refs synthesis', () => {
    const result = deriveArtifactPolicy(
      'feature',
      ['fe-main'],
      undefined,
      undefined,
      undefined,
      'explicit',
    );
    expect(result).toBeUndefined();
  });

  it('explicit mode + spec ref still surfaces the spec (RAC-derived)', () => {
    // The active spec is pulled from the RAC pool view, not the
    // packages mapping, so it must survive even in explicit mode —
    // suppressing it would hide a legitimately user-selected file.
    const result = deriveArtifactPolicy(
      'feature',
      ['fe-main'],
      undefined,
      'spec-login.md',
      undefined,
      'explicit',
    );
    expect(result?.refs).toEqual([`${ARTIFACT_PREFIX.SPEC}spec-login.md`]);
  });

  it('infer mode keeps the legacy package → fe-system-main.md mapping', () => {
    const result = deriveArtifactPolicy(
      'feature',
      ['fe-main'],
      undefined,
      undefined,
      undefined,
      'infer',
    );
    expect(result?.refs).toContain(`${ARTIFACT_PREFIX.FE_SYSTEM}main.md`);
    expect(result?.refs).toContain(`${ARTIFACT_PREFIX.API_CONTRACT}*`);
  });
});

describe('createTaskQueue mode gate — explicit pipeline produces RAC-only task.include', () => {
  it('Tier 3 explicit pipeline: no fe-system-main.md leaks into task.include', () => {
    // Reproduces `mossy-nearing-gleam` task shape: gen-code-directive
    // with PRD-only RAC, decompose LLM emits `packages: ["fe-main"]`.
    // Explicit mode must NOT bake `outputs/design/system/fe-system-main.md`
    // into the task.
    const tasks = [
      {
        id: 'feature-navbar',
        name: 'Feature: Navbar',
        type: 'feature' as const,
        priority: 300,
        description: 'Implement navbar',
        packages: ['fe-main'],
      },
      {
        id: 'final-verification',
        name: 'Final Verification',
        type: 'verification' as const,
        priority: 1000,
        description: 'Verify',
      },
    ] as any;

    const { taskQueue } = createTaskQueue(tasks, null, undefined, 3, 'explicit');
    const navbar = taskQueue.getAll().find(t => t.id === 'feature-navbar')!;

    expect(navbar.artifactPolicy).toBeUndefined();
    expect(navbar.include ?? []).not.toContain('outputs/design/system/fe-system-main.md');
    expect(navbar.include ?? []).not.toContain('outputs/design/system/api-contract-*');
    // packages survives as a tech-tier hint.
    expect(navbar.packages).toEqual(['fe-main']);
  });

  it('Tier 3 infer pipeline: legacy fe-main → fe-system-main.md path remains', () => {
    const tasks = [
      {
        id: 'feature-navbar',
        name: 'Feature: Navbar',
        type: 'feature' as const,
        priority: 300,
        description: 'Implement navbar',
        packages: ['fe-main'],
      },
      {
        id: 'final-verification',
        name: 'Final Verification',
        type: 'verification' as const,
        priority: 1000,
        description: 'Verify',
      },
    ] as any;

    const { taskQueue } = createTaskQueue(tasks, null, undefined, 3, 'infer');
    const navbar = taskQueue.getAll().find(t => t.id === 'feature-navbar')!;

    expect(navbar.artifactPolicy?.refs).toContain(`${ARTIFACT_PREFIX.FE_SYSTEM}main.md`);
    expect(navbar.include ?? []).toContain(`${ARTIFACT_PREFIX.FE_SYSTEM}main.md`);
  });
});
