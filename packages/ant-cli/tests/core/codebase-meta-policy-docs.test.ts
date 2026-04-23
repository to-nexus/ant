/**
 * Regression guard for `docs/architecture/35-codebase-meta-policy.md`:
 * asserts the 3-condition filter, non-encroachment domains, and
 * forbidden-examples matrix remain intact.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const DOC_PATH = join(__dirname, '../../../../docs/architecture/35-codebase-meta-policy.md');

describe('docs/architecture/35-codebase-meta-policy.md', () => {
  const doc = readFileSync(DOC_PATH, 'utf-8');

  it('declares the 3-condition filter with all three conditions named', () => {
    expect(doc).toMatch(/3-조건 필터|3-condition filter/);
    expect(doc).toMatch(/Codebase-local/);
    expect(doc).toMatch(/Not auto-derivable/);
    expect(doc).toMatch(/Cross-task invariant/);
  });

  it('calls out the three non-encroachment domains (decompose / prompt / config file)', () => {
    expect(doc).toMatch(/침범 금지|non-encroachment/);
    expect(doc).toMatch(/decompose/);
    expect(doc).toMatch(/prompt/);
    expect(doc).toMatch(/config 파일|config file/);
  });

  it('lists forbidden examples that would restate package.json / tsconfig facts', () => {
    // These are the specific redundant-restatement examples the doc must
    // publish — the lapis-bonding-fruit regression enumerated them as
    // the exact lines that polluted the 933-char ANTRULES output.
    expect(doc).toMatch(/Framework.*Next\.js|Next\.js.*Framework/);
    expect(doc).toMatch(/Test runner.*Jest|Jest.*Test runner/);
    expect(doc).toMatch(/Source root.*src|src.*Source root/);
    expect(doc).toMatch(/`@\/`.*alias|alias.*`@\/`/);
  });

  it('preserves the babel.config.js hazard as a legitimate allowed entry', () => {
    expect(doc).toMatch(/babel\.config\.js/);
    expect(doc).toMatch(/SWC/);
  });

  it('names the dep-self-contained separation so ANTRULES does not absorb the dependency-install principle', () => {
    expect(doc).toMatch(/dep-self-contained/);
    expect(doc).toMatch(/ANTRULES의?\s*책임이?\s*아니다|not.*ANTRULES.*responsibility|책임 범위|책임에서 제외/);
  });

  it('documents the partial rename (ant-md.md → antrules.md)', () => {
    expect(doc).toMatch(/antrules\.md/);
    // The renamed partial must be the one the doc references.
    expect(doc).toMatch(/jobs\/code\/base\/injections\/antrules/);
  });
});
