/**
 * Service Virtualization vocabulary / SSOT-table drift guard.
 *
 * The SV table (umbrella + 4 partial slices) appears verbatim in both
 * `CLAUDE.md` and `.cursorrules` (local developer docs, gitignored —
 * the tracked SSOT distillation lives in `AGENTS.md`). This guard locks
 * the local docs from drifting against each other so a developer who
 * edits the SV table in one MUST update the other to stay green.
 *
 * Because the docs are gitignored, on CI / a fresh clone they may not
 * exist — each doc is checked only if it exists. The guard runs in
 * full only on developer machines that have populated both docs.
 *
 * Locked invariants (when a doc exists):
 *   1. The doc declares "four orthogonal partials" — drifting the count
 *      flags here.
 *   2. The doc cites the four canonical partial names —
 *      `contract` / `data` / `imagery` / `session`.
 *   3. The doc cites the wire/gate regression test path and this
 *      vocabulary test path.
 *   4. The doc names the leaf vocabulary "mock" alongside the umbrella
 *      "Service Virtualization".
 *
 * When the table evolves (e.g. a 5th slice), update BOTH docs in one
 * commit and bump the count in this test — that's the intended choke
 * point.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const CLAUDE_MD = path.join(REPO_ROOT, 'CLAUDE.md');
const CURSORRULES = path.join(REPO_ROOT, '.cursorrules');

function read(p: string): string {
  return fs.readFileSync(p, 'utf-8');
}

const DOCS: Array<{ label: string; path: string }> = [
  { label: 'CLAUDE.md', path: CLAUDE_MD },
  { label: '.cursorrules', path: CURSORRULES },
];

const PARTIAL_NAMES = [
  'service-virtualization-contract',
  'service-virtualization-data',
  'service-virtualization-imagery',
  'service-virtualization-session',
];

describe('Service Virtualization SSOT-table — CLAUDE.md / .cursorrules drift guard', () => {
  for (const doc of DOCS) {
    // Gitignored — only enforce when the doc has been populated locally.
    const exists = fs.existsSync(doc.path);
    const maybe = exists ? it : it.skip;

    maybe(`${doc.label} declares "four orthogonal partials" for SV`, () => {
      const src = read(doc.path);
      expect(
        /four orthogonal partials cover the SV surface/.test(src),
        `${doc.label} must declare "four orthogonal partials cover the SV surface" — got drift`,
      ).toBe(true);
    });

    maybe(`${doc.label} must NOT declare a stale count for SV (three / five / six)`, () => {
      const src = read(doc.path);
      for (const stale of ['three', 'five', 'six']) {
        const re = new RegExp(`${stale} orthogonal partials cover the SV surface`, 'i');
        expect(
          re.test(src),
          `${doc.label} still cites "${stale} orthogonal partials" — SV table drift`,
        ).toBe(false);
      }
    });

    maybe(`${doc.label} cites all four canonical partial names in the SV table`, () => {
      const src = read(doc.path);
      for (const name of PARTIAL_NAMES) {
        expect(
          src.includes(name),
          `${doc.label} missing canonical partial name '${name}'`,
        ).toBe(true);
      }
    });

    maybe(`${doc.label} names the leaf vocabulary "mock" alongside the umbrella "Service Virtualization"`, () => {
      const src = read(doc.path);
      expect(src).toMatch(/Service Virtualization/);
      expect(src).toMatch(/leaf vocabulary = "mock"/);
    });

    maybe(`${doc.label} cites the body / wire / gate regression test path`, () => {
      const src = read(doc.path);
      expect(src.includes('tests/prompt/service-virtualization.test.ts')).toBe(true);
    });

    maybe(`${doc.label} cites this vocabulary regression test path`, () => {
      const src = read(doc.path);
      expect(src.includes('tests/policy/service-virtualization-vocabulary.test.ts')).toBe(true);
    });

    maybe(`${doc.label} cites "four pure functions" for the gate predicates`, () => {
      const src = read(doc.path);
      expect(
        /four pure functions/.test(src),
        `${doc.label} must say "four pure functions" — got drift`,
      ).toBe(true);
    });
  }
});
