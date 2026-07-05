/**
 * loadResolvedArtifacts — directory walk / codebase-scope semantics
 *
 * RCA: `fern-grading-knife` decompose crashed with a 7.85M-token prompt
 * because a codebase directory ref was walked into the pool with NO ignore
 * filter, pulling in 22,131 `codebase/node_modules/**` files. Locks:
 *   - Codebase-scoped refs (empty `''` codebaseSlot path, or under
 *     `codebase/`) are NEVER eager-loaded — served by the codebase manifest +
 *     tools (token-cost-0 contract).
 *   - Any other directory ref walk skips dependency/build output
 *     (node_modules, .git, dist, .next, …) and lockfiles.
 *   - Curated non-codebase dirs (e.g. visual/ui/ant) still load real content.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadResolvedArtifacts } from '../../src/agents/common/graph/loadDocumentsForRAC';
import type { ResolvedActionContext } from '@ant/shared';

function rac(refs: string[] = [], context: string[] = []): ResolvedActionContext {
  return {
    intent: 'rev-code',
    intentGroup: 'gen-code',
    mode: 'creation',
    refs,
    context,
  } as unknown as ResolvedActionContext;
}

describe('loadResolvedArtifacts — directory walk & codebase scope', () => {
  let featurePath: string;

  beforeAll(() => {
    featurePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-walk-'));

    // A realistic codebase with installed deps + build output.
    const cb = path.join(featurePath, 'codebase');
    fs.mkdirSync(path.join(cb, 'src'), { recursive: true });
    fs.writeFileSync(path.join(cb, 'src/app.ts'), 'export const x = 1;');
    fs.writeFileSync(path.join(cb, 'package.json'), '{"name":"demo"}');
    fs.writeFileSync(path.join(cb, 'pnpm-lock.yaml'), 'lockfile: {}');
    const nm = path.join(cb, 'node_modules/next/dist');
    fs.mkdirSync(nm, { recursive: true });
    fs.writeFileSync(path.join(nm, 'index.d.ts'), 'export {};');
    const dist = path.join(cb, 'dist');
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, 'bundle.js'), 'console.log(1)');

    // Curated non-codebase design dir — must still load real content.
    const antDir = path.join(featurePath, 'visual/ui/ant');
    fs.mkdirSync(antDir, { recursive: true });
    fs.writeFileSync(path.join(antDir, 'ui-tokens.json'), '{"color":{"bg":"#000"}}');
    // Even here a stray node_modules must be ignored by the walk.
    const antNm = path.join(antDir, 'node_modules');
    fs.mkdirSync(antNm, { recursive: true });
    fs.writeFileSync(path.join(antNm, 'junk.js'), 'x');
  });

  afterAll(() => {
    if (featurePath) fs.rmSync(featurePath, { recursive: true, force: true });
  });

  it('empty codebaseSlot path ("") loads nothing (never walks the feature tree)', () => {
    const artifacts = loadResolvedArtifacts(rac(['']), featurePath);
    expect(artifacts).toEqual([]);
  });

  it('a codebase/ directory ref loads nothing into the pool (served by manifest + tools)', () => {
    const artifacts = loadResolvedArtifacts(rac(['codebase']), featurePath);
    expect(artifacts).toEqual([]);
  });

  it('a codebase/ subdirectory ref also loads nothing', () => {
    const artifacts = loadResolvedArtifacts(rac(['codebase/src']), featurePath);
    expect(artifacts).toEqual([]);
    // and even an explicit codebase file is not eager-loaded
    expect(loadResolvedArtifacts(rac(['codebase/src/app.ts']), featurePath)).toEqual([]);
  });

  it('a non-codebase directory walk excludes node_modules / dist / lockfiles', () => {
    const artifacts = loadResolvedArtifacts(rac([], ['visual/ui/ant']), featurePath);
    const paths = artifacts.map(a => a.path);
    expect(paths).toContain('visual/ui/ant/ui-tokens.json');
    expect(paths.some(p => p.includes('node_modules'))).toBe(false);
    // real content preserved
    const tok = artifacts.find(a => a.path.endsWith('ui-tokens.json'));
    expect(tok?.content).toContain('"bg":"#000"');
  });
});
