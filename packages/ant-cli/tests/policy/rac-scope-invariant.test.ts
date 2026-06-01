/**
 * RAC scope invariant — `state.artifacts ⊆ resolvedAction.refs ∪ context`.
 *
 * Locks the post-RAC SSOT: `state.artifacts` is pinned to the RAC subset, so
 * a wholesale `architecture/system/**` load can no longer inject docs the RAC
 * excluded. The decompose `read_file` / `list_files` tool calls are RAC-scoped
 * via `computeRacScope(resolvedAction)` + `decideRacGate` (explicit pipeline
 * only); the same gate runs at the shared code `tool` node so plan/execute
 * reads are RAC-scoped symmetrically (SSOT: `racGate.ts`). Per-task injection
 * is the single LLM-authored, RAC-validated `include` field — a task sees only
 * its own `include`. See `AGENTS.md` "state.artifacts Post-RAC SSOT".
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadResolvedArtifacts } from '../../src/agents/common/graph/loadDocumentsForRAC';
import {
  createTaskQueue,
} from '../../src/agents/architect/graph/code/nodes/decompose/responseParser';
import {
  decideRacGate,
  isWithinRacWhitelist,
  computeRacScope,
  type RacScope,
} from '../../src/agents/architect/graph/code/nodes/decompose/racGate';
import { handleReadFile, handleListFiles } from '../../src/agents/common/tool/handlers';
import { FileSystemAdapter } from '../../src/periphery/adapters/filesystem/FileSystemAdapter';
import type { ToolExecutionContext } from '../../src/agents/common/tool/types';
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

    const sourcesDir = path.join(featurePath, 'plan');
    fs.mkdirSync(sourcesDir, { recursive: true });
    fs.writeFileSync(path.join(sourcesDir, 'prd.md'), '# PRD\n\nProduct requirements.');

    const sysDir = path.join(featurePath, 'architecture/system');
    fs.mkdirSync(sysDir, { recursive: true });
    fs.writeFileSync(
      path.join(sysDir, 'fe-system-main.md'),
      '# fe-system-main\n\nFrontend system design referencing Auth SDK.',
    );
    fs.writeFileSync(
      path.join(sysDir, 'api-contract-public.md'),
      '# api-contract-public\n\nPublic API contract.',
    );

    const specDir = path.join(featurePath, 'architecture/spec');
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(path.join(specDir, 'spec-foo.md'), '# spec-foo\n\nFeature spec.');
  });

  afterAll(() => {
    if (featurePath) fs.rmSync(featurePath, { recursive: true, force: true });
  });

  it('gen-code-directive (PRD-only context) does NOT pull in fe-system-main.md from disk', () => {
    // Reproduces the `post-RAC pool-leak (2026-04)` scenario: user picks a directive
    // intent with the PRD as sole context, while disk also holds an
    // unrelated `architecture/system/fe-system-main.md`. The pool must
    // remain bounded by the RAC.
    const ra = rac('gen-code-directive', [], ['plan/prd.md']);
    const artifacts = loadResolvedArtifacts(ra, featurePath);

    const paths = artifacts.map(a => a.path).sort();
    expect(paths).toEqual(['plan/prd.md']);

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
      ['architecture/system/fe-system-main.md', 'architecture/system/api-contract-public.md'],
      ['plan/prd.md'],
    );
    const artifacts = loadResolvedArtifacts(ra, featurePath);

    const paths = artifacts.map(a => a.path).sort();
    expect(paths).toEqual([
      'architecture/system/api-contract-public.md',
      'architecture/system/fe-system-main.md',
      'plan/prd.md',
    ]);

    const fe = artifacts.find(a => a.path.endsWith('fe-system-main.md'));
    expect(fe?.role).toBe('ref');
    expect(fe?.content).toContain('Auth SDK');
  });

  it('directory slot — `architecture/spec/` walks into spec documents only when listed', () => {
    // Directory slot semantics: `loadResolvedArtifacts` walks the directory,
    // so design-spec intents that put the `spec/` dir into `refs` get every
    // spec file recursively (canonical `{slug}.md` or legacy `spec-{slug}.md`).
    // Directive intents (no spec slot) must not.
    const directiveOnly = loadResolvedArtifacts(
      rac('gen-code-directive', [], ['plan/prd.md']),
      featurePath,
    );
    expect(directiveOnly.some(a => a.path.startsWith('architecture/spec/'))).toBe(false);

    const specBased = loadResolvedArtifacts(
      rac('gen-code-spec', ['architecture/spec'], ['plan/prd.md']),
      featurePath,
    );
    expect(specBased.some(a => a.path === 'architecture/spec/spec-foo.md')).toBe(true);
  });

  it('empty RAC produces empty pool (no implicit disk pickups)', () => {
    const artifacts = loadResolvedArtifacts(rac('gen-code-directive'), featurePath);
    expect(artifacts).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────
// Channel A — decompose discovery tools must respect explicit RAC scope
// ───────────────────────────────────────────────────────────────────────

describe('decompose RAC whitelist (Channel A — `discovery-tool RAC bypass (2026-04)`)', () => {
  let workspacePath: string;

  beforeAll(() => {
    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-rac-discovery-'));
    fs.mkdirSync(path.join(workspacePath, 'plan'), { recursive: true });
    fs.writeFileSync(path.join(workspacePath, 'plan/prd.md'), '# PRD\n');
    fs.mkdirSync(path.join(workspacePath, 'architecture/system'), { recursive: true });
    fs.writeFileSync(
      path.join(workspacePath, 'architecture/system/fe-system-main.md'),
      '# fe-system-main — Auth SDK adapter contract',
    );
    fs.mkdirSync(path.join(workspacePath, 'architecture/spec'), { recursive: true });
    fs.writeFileSync(path.join(workspacePath, 'architecture/spec/spec-foo.md'), '# spec-foo');
    // Codebase fixture for orthogonality assertion.
    fs.mkdirSync(path.join(workspacePath, 'codebase/src'), { recursive: true });
    fs.writeFileSync(
      path.join(workspacePath, 'codebase/src/main.ts'),
      'export const ok = true;\n',
    );
  });

  afterAll(() => {
    if (workspacePath) fs.rmSync(workspacePath, { recursive: true, force: true });
  });

  function silentChatStatus(): ToolExecutionContext['chatStatus'] {
    const noop = async () => undefined as any;
    return new Proxy({}, { get: () => noop }) as ToolExecutionContext['chatStatus'];
  }

  function ctx(): ToolExecutionContext {
    return {
      fileSystem: new FileSystemAdapter(workspacePath),
      chatStatus: silentChatStatus(),
      workingDir: workspacePath,
    };
  }

  /**
   * Drive the gate exactly as decompose's tool loop wires it:
   *   1. `decideRacGate` first (reject sibling paths outside RAC).
   *   2. otherwise dispatch to the common handler.
   * If the gate logic in decompose/index.ts ever drifts from this shape,
   * one of these tests fires.
   */
  async function gatedRead(args: { path: string }, racScope: RacScope | undefined): Promise<string> {
    const gate = decideRacGate(args.path, racScope);
    if (!gate.allowed) return `Error: ${gate.error}`;
    const res = await handleReadFile(ctx(), args);
    return res.content;
  }

  async function gatedList(args: { directory: string }, racScope: RacScope | undefined): Promise<string> {
    const gate = decideRacGate(args.directory, racScope);
    if (!gate.allowed) return `Error: ${gate.error}`;
    const res = await handleListFiles(ctx(), args);
    return res.content;
  }

  it('explicit RAC blocks read_file on a non-RAC artifact path', async () => {
    const result = await gatedRead(
      { path: 'architecture/system/fe-system-main.md' },
      { refs: [], context: ['plan/prd.md'] },
    );
    expect(result).toMatch(/outside the RAC selection/);
    expect(result).not.toContain('Auth SDK');
  });

  it('explicit RAC blocks list_files on a non-RAC directory', async () => {
    const result = await gatedList(
      { directory: 'architecture/system' },
      { refs: [], context: ['plan/prd.md'] },
    );
    expect(result).toMatch(/outside the RAC selection/);
    expect(result).not.toContain('fe-system-main');
  });

  it('explicit RAC permits read_file on a RAC member path', async () => {
    const result = await gatedRead(
      { path: 'plan/prd.md' },
      { refs: [], context: ['plan/prd.md'] },
    );
    expect(result).toContain('# PRD');
  });

  it('directory RAC entry permits read on descendants but rejects siblings', async () => {
    // RAC pins `architecture/spec/` as a directory slot.
    const allowed = await gatedRead(
      { path: 'architecture/spec/spec-foo.md' },
      { refs: ['architecture/spec'], context: [] },
    );
    expect(allowed).toContain('# spec-foo');

    const denied = await gatedRead(
      { path: 'architecture/system/fe-system-main.md' },
      { refs: ['architecture/spec'], context: [] },
    );
    expect(denied).toMatch(/outside the RAC selection/);
  });

  it('list_files allowed on a parent of a RAC directory entry', async () => {
    // Listing `architecture` is needed when the LLM wants to inspect
    // siblings of a pinned `architecture/spec/` directory slot.
    const result = await gatedList(
      { directory: 'architecture' },
      { refs: ['architecture/spec'], context: [] },
    );
    expect(result).not.toMatch(/outside the RAC selection/);
  });

  it('infer pipeline (no racScope) preserves legacy behaviour', async () => {
    const result = await gatedRead(
      { path: 'architecture/system/fe-system-main.md' },
      undefined,
    );
    expect(result).toContain('Auth SDK');
  });

  // ── New invariants made possible by the SSOT unification ──────────────
  //
  // The deleted `discoveryTools` had a `scope: 'artifact' | 'codebase'`
  // enum the LLM had to choose between. The new contract drops the enum
  // and lets `normalizeToCodebasePath` decide; the orthogonality
  // (codebase paths bypass RAC) is now implicit in the prefix the LLM
  // writes. Lock that promise.

  it('codebase paths are orthogonal to RAC (always allowed even with restrictive scope)', async () => {
    // Restrictive RAC excludes everything; a codebase path STILL reads
    // because RAC is artifact-only by contract.
    const result = await gatedRead(
      { path: 'codebase/src/main.ts' },
      { refs: [], context: [] },
    );
    expect(result).toContain('export const ok = true');
  });

  it('RAC orthogonality check exposed via decideRacGate (no enum needed)', () => {
    // The decision function MUST not gate codebase paths regardless of
    // RAC contents.
    const verdict = decideRacGate(
      'codebase/anything/at/all.ts',
      { refs: ['plan/prd.md'], context: [] },
    );
    expect(verdict.allowed).toBe(true);

    // But the underlying isWithinRacWhitelist treats it as "not in
    // whitelist" — proving decideRacGate is doing its codebase-vs-sibling
    // dispatch, not delegating blindly.
    expect(isWithinRacWhitelist('codebase/anything/at/all.ts',
      { refs: ['plan/prd.md'], context: [] })).toBe(false);
  });

  it('bare path with no prefix gets normalized to codebase/ → orthogonal to RAC', () => {
    // `apps/console/foo.ts` — exactly the rac-pool-normalize shape —
    // is normalized to `codebase/apps/console/foo.ts` by the SSOT, so
    // the RAC gate must let it through even with empty whitelist.
    const verdict = decideRacGate(
      'apps/console/foo.ts',
      { refs: [], context: ['plan/prd.md'] },
    );
    expect(verdict.allowed).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────
// computeRacScope — explicit-only RAC scope derivation
// ───────────────────────────────────────────────────────────────────────

describe('computeRacScope', () => {
  it('explicit pipeline with non-empty RAC → scope', () => {
    const scope = computeRacScope({
      source: 'explicit',
      hasExplicitFields: true,
      refs: ['plan/prd.md'],
      context: [],
    } as any);
    expect(scope).toEqual({ refs: ['plan/prd.md'], context: [] });
  });

  it('infer pipeline → undefined (everything allowed downstream)', () => {
    expect(computeRacScope({ source: 'infer', hasExplicitFields: false, refs: [], context: [] } as any)).toBeUndefined();
  });

  it('explicit but empty RAC → undefined (LLM must discover anchors)', () => {
    expect(computeRacScope({ source: 'explicit', hasExplicitFields: true, refs: [], context: [] } as any)).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────────
// createTaskQueue — LLM-authored `include`, RAC-validated
// ───────────────────────────────────────────────────────────────────────

describe('createTaskQueue include RAC validation', () => {
  const baseTasks = (include: string[]) => ([
    {
      id: 'feature-navbar',
      name: 'Feature: Navbar',
      type: 'feature' as const,
      priority: 300,
      description: 'Implement navbar',
      stack: 'frontend',
      include,
    },
    {
      id: 'final-verification',
      name: 'Final Verification',
      type: 'verification' as const,
      priority: 1000,
      description: 'Verify',
    },
  ] as any);

  it('explicit pipeline: include paths outside RAC are dropped', () => {
    // RAC pinned to PRD only; LLM authored an out-of-RAC system-design path.
    const racScope = { refs: ['plan/prd.md'], context: [] };
    const { taskQueue } = createTaskQueue(
      baseTasks(['plan/prd.md', 'architecture/system/fe-system-main.md']),
      null, undefined, 3, racScope,
    );
    const navbar = taskQueue.getAll().find(t => t.id === 'feature-navbar')!;
    expect(navbar.include).toEqual(['plan/prd.md']);
    expect(navbar.include).not.toContain('architecture/system/fe-system-main.md');
    // retired carriers are gone
    expect((navbar as any).artifactPolicy).toBeUndefined();
    expect((navbar as any).packages).toBeUndefined();
  });

  it('explicit pipeline: in-RAC include survives; stack preserved', () => {
    const racScope = { refs: ['plan/prd.md', 'architecture/system/api-contract-main.md'], context: [] };
    const { taskQueue } = createTaskQueue(
      baseTasks(['architecture/system/api-contract-main.md']),
      null, undefined, 3, racScope,
    );
    const navbar = taskQueue.getAll().find(t => t.id === 'feature-navbar')!;
    expect(navbar.include).toEqual(['architecture/system/api-contract-main.md']);
    expect(navbar.stack).toBe('frontend');
  });

  it('infer pipeline (racScope undefined): include passes through unvalidated', () => {
    const { taskQueue } = createTaskQueue(
      baseTasks(['architecture/system/fe-system-main.md']),
      null, undefined, 3, undefined,
    );
    const navbar = taskQueue.getAll().find(t => t.id === 'feature-navbar')!;
    expect(navbar.include).toEqual(['architecture/system/fe-system-main.md']);
  });
});
