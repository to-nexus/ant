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
import { selectArtifacts } from '../../src/core/artifact/ArtifactPipeline';
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
    // Asset-pool fixture — the second RAC-orthogonal family.
    fs.mkdirSync(path.join(workspacePath, 'assets/game/models'), { recursive: true });
    fs.writeFileSync(path.join(workspacePath, 'assets/game/models/Duck.glb'), 'glTF-binary');
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
    if (typeof res.content !== 'string') throw new Error('expected text content');
    return res.content;
  }

  async function gatedList(args: { directory: string }, racScope: RacScope | undefined): Promise<string> {
    const gate = decideRacGate(args.directory, racScope);
    if (!gate.allowed) return `Error: ${gate.error}`;
    const res = await handleListFiles(ctx(), args);
    if (typeof res.content !== 'string') throw new Error('expected text content');
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

  // zinc-bracing-gavel: RAC entries derive from disk (NFD for macOS uploads
  // on Linux) while the LLM re-emits NFC — byte-exact comparison denied
  // legitimately-selected artifacts before any handler ran.
  it('NFC-requested path passes a whitelist whose entry is NFD (and vice versa)', () => {
    const nfd = 'visual/ui/handoff/스크린샷 2026-08-21.png'.normalize('NFD');
    const nfc = nfd.normalize('NFC');
    expect(isWithinRacWhitelist(nfc, { refs: [nfd], context: [] })).toBe(true);
    expect(isWithinRacWhitelist(nfd, { refs: [nfc], context: [] })).toBe(true);
  });

  it("list_files('.') lists the workspace ROOT (not codebase/) and passes the gate", async () => {
    // Regression: normalizeToCodebasePath's Rule 4 used to silently rewrite
    // '.' → 'codebase/.', making the sibling artifact trees (assets/, plan/,
    // architecture/) structurally undiscoverable (fierce-gaining-gully).
    const result = await gatedList(
      { directory: '.' },
      { refs: [], context: ['plan/prd.md'] },
    );
    expect(result).not.toMatch(/outside the RAC selection/);
    expect(result).toContain('Workspace root');
    expect(result).toContain('plan/');
    expect(result).toContain('architecture/');
    expect(result).toContain('codebase/');
    // Root listing shows directory NAMES, not codebase contents.
    expect(result).not.toContain('src/');
  });

  // ── New invariants made possible by the SSOT unification ──────────────
  //
  // The deleted `discoveryTools` had a `scope: 'artifact' | 'codebase'`
  // enum the LLM had to choose between. The new contract drops the enum
  // and lets `normalizeToCodebasePath` decide; the orthogonality
  // (codebase paths bypass RAC) is now implicit in the prefix the LLM
  // writes. Lock that promise.

  // Asset pools are the SECOND orthogonal family. `ArtifactPipeline`'s
  // existence-band exception already rides asset stubs along with every
  // selection regardless of `task.include`; gating the READ side while the
  // injection side exempts them made a spec-mandated asset unreachable by
  // `list_files` and pushed the LLM into whole-filesystem `find` sweeps that
  // time out (valid-crating-prawn: 2 × 60s + ~4min burned before it worked
  // around the gate with an ungated `run_command cp`).
  it('asset pools are orthogonal to RAC — read and list reach them under an explicit RAC', async () => {
    const scope: RacScope = { refs: ['architecture/spec/spec-foo.md'], context: ['plan/prd.md'] };

    expect(decideRacGate('assets/game/models/Duck.glb', scope).allowed).toBe(true);
    expect(decideRacGate('assets/service/logo.svg', scope).allowed).toBe(true);
    // Pool root and its parent — needed for discovery listing.
    expect(decideRacGate('assets/game', scope).allowed).toBe(true);
    expect(decideRacGate('assets', scope).allowed).toBe(true);

    const listed = await gatedList({ directory: 'assets/game/models' }, scope);
    expect(listed).not.toMatch(/outside the RAC selection/);
    expect(listed).toContain('Duck.glb');
  });

  it('the asset exemption does NOT widen into authority artifacts', async () => {
    // `mossy-nearing-gleam` invariant must survive the asset carve-out.
    const scope: RacScope = { refs: ['architecture/spec/spec-foo.md'], context: ['plan/prd.md'] };
    expect(decideRacGate('architecture/system/fe-system-main.md', scope).allowed).toBe(false);
    const denied = await gatedRead({ path: 'architecture/system/fe-system-main.md' }, scope);
    expect(denied).toMatch(/outside the RAC selection/);
  });

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

// ────────────────────────────────────────────────────────────────
// Byte class, not directory — the `near-loading-brace` axis
// ────────────────────────────────────────────────────────────────

describe('binary artifacts are classified by content, not by directory', () => {
  let featurePath: string;

  beforeAll(() => {
    featurePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-rac-binary-'));
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(32),
    ]);
    for (const rel of [
      'visual/ui/handoff/shot.png',
      'assets/service/images/logo.png',
      'assets/gen/sketches/sketch.png',
      'plan/screenshot.png',
      'meta/stray.png',
    ]) {
      const abs = path.join(featurePath, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, png);
    }
    fs.mkdirSync(path.join(featurePath, 'plan'), { recursive: true });
    fs.writeFileSync(path.join(featurePath, 'plan/prd.md'), '# PRD\n\nText.');
  });

  afterAll(() => {
    if (featurePath) fs.rmSync(featurePath, { recursive: true, force: true });
  });

  // The stub/read decision used to be a 4-prefix path allowlist, so a PNG
  // selected as context from anywhere else was `toString('utf8')`-decoded and
  // its mojibake injected into the prompt.
  it.each([
    ['declared stub family', 'visual/ui/handoff/shot.png'],
    ['domain asset pool', 'assets/service/images/logo.png'],
    ['visual-job output pool', 'assets/gen/sketches/sketch.png'],
    ['a dir that accepts no images by policy', 'plan/screenshot.png'],
    ['a dir with no upload policy at all', 'meta/stray.png'],
  ])('a binary in %s becomes an existence-only stub', (_label, rel) => {
    const artifacts = loadResolvedArtifacts(rac('gen-code-directive', [], [rel]), featurePath);
    expect(artifacts).toHaveLength(1);
    const [a] = artifacts;
    expect(a.kind).toBe('binary');
    expect(a.sizeBytes).toBe(40);
    // Bytes never enter the prompt — the content is a manifest line.
    expect(a.content).toContain('[asset]');
    expect(a.content).not.toContain('\uFFFD');
    // Magic-byte sniff, for the image-block builder.
    expect(a.mediaType).toBe('image');
    expect(a.mimeType).toBe('image/png');
    // Bytes are NOT inlined: artifacts are checkpointed to code.json.
    expect(a.base64).toBeUndefined();
  });

  // The production path for a handoff attachment: `widenHandoffRefsToBundleDir`
  // collapses the individual files to the bundle DIR, so the RAC entry the pool
  // loader receives is a directory and the walk branch — not the leaf branch —
  // is what classifies each file.
  it('a directory RAC entry classifies each child by its own bytes', () => {
    const dirFeature = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-rac-dirwalk-'));
    try {
      const handoff = path.join(dirFeature, 'visual/ui/handoff');
      fs.mkdirSync(handoff, { recursive: true });
      fs.writeFileSync(
        path.join(handoff, 'shot.png'),
        Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          Buffer.alloc(32),
        ]),
      );
      fs.writeFileSync(path.join(handoff, 'notes.md'), '# Notes\n\nSpacing.');

      const artifacts = loadResolvedArtifacts(
        rac('gen-code-directive', [], ['visual/ui/handoff']),
        dirFeature,
      );

      const byPath = new Map(artifacts.map(a => [a.path, a]));
      const png = byPath.get('visual/ui/handoff/shot.png');
      expect(png?.kind).toBe('binary');
      expect(png?.mimeType).toBe('image/png');
      expect(png?.content).toContain('[asset]');
      // Handoff text stays a stub (on-demand read), not eager content.
      const md = byPath.get('visual/ui/handoff/notes.md');
      expect(md?.kind).toBe('text');
      expect(md?.content).toContain('[reference file]');
      expect(md?.content).not.toContain('Spacing');
    } finally {
      fs.rmSync(dirFeature, { recursive: true, force: true });
    }
  });

  it('text still loads its content and is marked text', () => {
    const artifacts = loadResolvedArtifacts(rac('gen-code-directive', ['plan/prd.md']), featurePath);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].kind).toBe('text');
    expect(artifacts[0].content).toContain('# PRD');
  });

  it('assets/gen is RAC-orthogonal like the domain pools', () => {
    const scope: RacScope = { refs: ['plan/prd.md'], context: [] };
    expect(decideRacGate('assets/gen/sketches/sketch.png', scope).allowed).toBe(true);
    expect(decideRacGate('assets/gen', scope).allowed).toBe(true);
  });
});

describe('selectArtifacts — existence-only binaries ride along regardless of include', () => {
  const stub = (p: string, kind?: 'binary' | 'text') => ({
    path: p,
    role: 'context' as const,
    content: `[asset] ${p}`,
    ...(kind ? { kind } : {}),
  });

  it('an attached binary OUTSIDE the asset pool survives a non-matching include', () => {
    // The exemption used to be `isAssetPoolPath`, so a handoff binary reached
    // decompose and then vanished before plan/execute unless the decompose LLM
    // happened to name it — how near-loading-brace planned around screenshots
    // it had been handed.
    const selected = selectArtifacts(
      [stub('visual/ui/handoff/shot.png', 'binary'), stub('plan/prd.md', 'text')],
      { include: ['architecture/spec/'] },
    );
    expect(selected.map(a => a.path)).toEqual(['visual/ui/handoff/shot.png']);
  });

  it('text artifacts stay include-gated', () => {
    const selected = selectArtifacts([stub('visual/ui/handoff/page.html', 'text')], {
      include: ['architecture/spec/'],
    });
    expect(selected).toEqual([]);
  });

  it('pool paths still ride along when `kind` is absent (checkpoint restore)', () => {
    const selected = selectArtifacts([stub('assets/game/models/Duck.glb')], {
      include: ['architecture/spec/'],
    });
    expect(selected.map(a => a.path)).toEqual(['assets/game/models/Duck.glb']);
  });

  it('verification still drops everything', () => {
    const selected = selectArtifacts([stub('visual/ui/handoff/shot.png', 'binary')], {
      taskType: 'verification',
    });
    expect(selected).toEqual([]);
  });
});
