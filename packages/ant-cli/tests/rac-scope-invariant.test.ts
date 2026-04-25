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
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadResolvedArtifacts } from '../src/agents/common/graph/loadDocumentsForRAC';
import type { ResolvedActionContext } from '@ant/shared';

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
