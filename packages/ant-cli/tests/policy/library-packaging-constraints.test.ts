/**
 * Locks the TS setup-task "Shared-Library Package Packaging" invariants
 * (generation-time prevention).
 *
 * RCA `lucky-jumping-apple`: a generated shared library (`packages/ui`) shipped
 * (a) a `package.json` `exports` map with `types` AFTER `import`/`require` (the
 * `types` condition silently never used) and (b) `tsconfig` `composite: true`
 * with no project references alongside a tsup `dts` build → TS6307 at build.
 * The fix encodes the two deterministic packaging invariants so the LLM writes
 * them correctly up-front. Precise phrasing: a correctly-wired composite+
 * references setup is NOT forbidden — only references-less composite + bundler
 * dts is the fault.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const FILE = path.join(
  __dirname,
  '..',
  '..',
  'src',
  'core',
  'prompt',
  'templates',
  'jobs',
  'code',
  'nodes',
  'execute',
  'basis',
  'techTier',
  'typescript',
  'setup',
  'constraints.md',
);

const content = fs.readFileSync(FILE, 'utf8');

describe('TS library packaging invariants (Fix D)', () => {
  it('has the Shared-Library Package Packaging section', () => {
    expect(content).toMatch(/Shared-Library Package Packaging/);
  });

  it('mandates `types` exports condition first', () => {
    expect(content).toMatch(/`types` condition MUST come BEFORE/i);
    expect(content).toMatch(/never reached|never be used|never used/i);
  });

  it('encodes the one-declaration-emitter invariant precisely (not an absolute composite ban)', () => {
    expect(content).toMatch(/one declaration emitter/i);
    expect(content).toMatch(/composite.*WITHOUT matching project `references`/i);
    expect(content).toMatch(/TS6307/);
    // over-generalization guard: legit composite+references is allowed
    expect(content).toMatch(/correctly-wired `composite` \+ `references` setup is fine/i);
  });
});
