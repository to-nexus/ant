/**
 * Content-lock for three setup-task prompt invariants (all setup/foundation
 * scope, orthogonal to the consumer-contract attestation gate):
 *
 *   결함1 — framework↔runtime version SET coherence (no `next:latest` + `react:^18` split)
 *   결함3 — single uniform package scope + root `--filter` == member `name` verbatim
 *   결함4 — pnpm `allowBuilds` is boolean-only; no speculative placeholder entries
 *
 * These lock the prompt wording at the invariant level (stable tokens, not full
 * sentences). If the rule is reworded, update the matched token here in the
 * same change — that's the intended choke point.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const TEMPLATES = path.resolve(
  __dirname,
  '../../src/core/prompt/templates/jobs/code',
);
const configMd = fs.readFileSync(
  path.join(TEMPLATES, 'nodes/execute/basis/techTier/typescript/setup/config.md'),
  'utf-8',
);
const nextjsMd = fs.readFileSync(
  path.join(TEMPLATES, 'basis/techTier/framework/nextjs.md'),
  'utf-8',
);

describe('결함1 — framework↔runtime version set coherence', () => {
  it('config.md states the set-coherence rule', () => {
    expect(configMd).toMatch(/set-coherence/i);
    expect(configMd).toMatch(/NEVER split the set/);
  });

  it('nextjs.md reminds that next + react + react-dom are ONE version set', () => {
    expect(nextjsMd).toContain('react-dom');
    expect(nextjsMd).toMatch(/ONE version set/i);
  });
});

describe('결함3 — package naming SSOT', () => {
  it('config.md drops the ambiguous @project/<app-or-lib-name> placeholder', () => {
    expect(configMd).not.toContain('@project/<app-or-lib-name>');
  });

  it('config.md requires root --filter targets to equal member name verbatim', () => {
    expect(configMd).toMatch(/MUST equal a member.*VERBATIM/);
  });
});

describe('결함4 — pnpm allowBuilds boolean-only', () => {
  it('config.md forbids speculative allowBuilds placeholder entries', () => {
    expect(configMd).toContain('allowBuilds');
    expect(configMd).toMatch(/never placeholder/i);
  });
});
