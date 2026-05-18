/**
 * basis/techTier hint file structural + MECE invariants.
 *
 * Active gates:
 *   - Allowed filenames (pinned by the Hints-layer spec; injection skips
 *     unknown names — fallback would risk wrong-path injection).
 *   - Allowed H2 section headers, in the prescribed order. No other H2
 *     headers may appear.
 *   - MECE audit: React core rule lives in `_react-core` and reaches
 *     every React-based framework file exactly once; CSR-only content
 *     never bleeds into Next.js.
 *
 * What this file no longer enforces:
 *   The earlier 600-raw / 1200-expanded token cap is removed. It was a
 *   bloat-regression heuristic (originally 400, raised to 600 reactively)
 *   that did not derive from an aggregate-prompt budget and that forced
 *   FPOP-violating compression when SBS-mandated framework specifics
 *   approached the ceiling. FPOP/SBS/MECE compliance is the primary
 *   quality gate (see `docs/internals/13-prompt-system.md` 비 FPOP / 비
 *   SBS 금지 목록); bloat regression is a PR-review concern.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const TEMPLATES_ROOT = join(__dirname, '../../src/core/prompt/templates');
const BASIS_ROOT = join(TEMPLATES_ROOT, 'jobs/code/basis/techTier');

const ALLOWED_FRAMEWORK = ['nextjs', 'react', 'react-native', 'nestjs', 'gin'];
const ALLOWED_LANGUAGE = ['typescript-browser', 'typescript-node', 'go'];

const ALLOWED_SECTIONS = [
  '## Root Entry Coordinates',
  '## Forbidden Patterns',
  '## Symptom → Upstream Cues',
  '## Version Notes',
  '## Toolchain Compatibility',
];

function collectMd(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => join(dir, f));
}

/**
 * Recursively expand Handlebars `{{> name}}` partial references against
 * the templates directory. Used by the MECE audit so its occurrence
 * counts reflect what the LLM actually sees — `react.md` is a thin
 * shell that pulls in `_react-core` + `_react-csr`, and `nextjs.md`
 * pulls in `_react-core`.
 *
 * Cycle-safe via the `visited` set.
 */
function expandPartials(text: string, visited = new Set<string>()): string {
  return text.replace(/\{\{>\s*([\w/\-]+)[^}]*\}\}/g, (_m, name: string) => {
    if (visited.has(name)) return '';
    visited.add(name);
    const partialPath = join(TEMPLATES_ROOT, `${name}.md`);
    if (!existsSync(partialPath)) return '';
    const partialText = readFileSync(partialPath, 'utf8');
    return expandPartials(partialText, visited);
  });
}

describe('basis/techTier hint files — presence', () => {
  const files = [
    ...collectMd(join(BASIS_ROOT, 'framework')),
    ...collectMd(join(BASIS_ROOT, 'language')),
  ];

  it('at least one file is present', () => {
    expect(files.length).toBeGreaterThan(0);
  });
});

describe('basis/techTier hint files — allowed filenames', () => {
  it('framework directory contains only allowed entries', () => {
    const dir = join(BASIS_ROOT, 'framework');
    if (!existsSync(dir)) return;
    // `_` prefix = partial-only internal building block (e.g. `_react-core`,
    // `_react-csr`). These are included by other framework files via
    // `{{> ...}}` and are never directly injected, so they are not required
    // to be in the ALLOWED_FRAMEWORK allow-list.
    const names = readdirSync(dir)
      .filter(f => f.endsWith('.md') && !f.startsWith('_'))
      .map(f => f.replace(/\.md$/, ''));
    for (const name of names) {
      expect(ALLOWED_FRAMEWORK, `framework/${name}.md not in allowed set`).toContain(name);
    }
  });

  it('language directory contains only allowed entries', () => {
    const dir = join(BASIS_ROOT, 'language');
    if (!existsSync(dir)) return;
    const names = readdirSync(dir)
      .filter(f => f.endsWith('.md') && !f.startsWith('_'))
      .map(f => f.replace(/\.md$/, ''));
    for (const name of names) {
      expect(ALLOWED_LANGUAGE, `language/${name}.md not in allowed set`).toContain(name);
    }
  });
});

describe('basis/techTier hint files — section header linter', () => {
  const files = [
    ...collectMd(join(BASIS_ROOT, 'framework')),
    ...collectMd(join(BASIS_ROOT, 'language')),
  ];

  it.each(files.map(f => [f]))('%s uses only allowed H2 headers', (path) => {
    const text = readFileSync(path, 'utf8');
    const h2Lines = text.split('\n').filter(l => l.startsWith('## '));
    for (const line of h2Lines) {
      const header = line.trim();
      expect(
        ALLOWED_SECTIONS,
        `${path} introduces disallowed header "${header}"; allowed: ${ALLOWED_SECTIONS.join(' | ')}`,
      ).toContain(header);
    }
  });

  it.each(files.map(f => [f]))('%s preserves the allowed header order', (path) => {
    const text = readFileSync(path, 'utf8');
    const h2Lines = text.split('\n').filter(l => l.startsWith('## ')).map(l => l.trim());
    const expectedOrder = ALLOWED_SECTIONS.filter(s => h2Lines.includes(s));
    expect(h2Lines).toEqual(expectedOrder);
  });
});

/**
 * MECE audit — the React 19 global-JSX rule that caused the
 * `prediction-dashboard/base/rosy-camping-chief` job to emit a
 * `src/types/jsx-global.d.ts` workaround lives in `_react-core.md`.
 * It must reach every React-based framework file exactly once:
 *
 *   - Exactly once in `react.md` (directly injected when framework='react')
 *   - Exactly once in `nextjs.md` (directly injected when framework='nextjs')
 *   - Zero CSR-only content bleeds into `nextjs.md` (CSR partial must NOT
 *     be reachable from nextjs)
 *
 * This gate locks in the invariant established in plan
 * `react_csr_ssr_partial_split`.
 */
describe('basis/techTier hint files — MECE audit', () => {
  const FRAMEWORK_DIR = join(BASIS_ROOT, 'framework');
  const REACT_CORE_MARKER = 'React 19: global `JSX` namespace removed';
  const CSR_ONLY_MARKER = 'vite-plugin-svgr';

  function expandedOf(fwName: string): string {
    const filePath = join(FRAMEWORK_DIR, `${fwName}.md`);
    return expandPartials(readFileSync(filePath, 'utf8'));
  }

  function countOccurrences(text: string, needle: string): number {
    let count = 0;
    let idx = text.indexOf(needle);
    while (idx !== -1) {
      count++;
      idx = text.indexOf(needle, idx + needle.length);
    }
    return count;
  }

  it('react.md expanded contains React core rule exactly once', () => {
    expect(countOccurrences(expandedOf('react'), REACT_CORE_MARKER)).toBe(1);
  });

  it('nextjs.md expanded contains React core rule exactly once', () => {
    expect(countOccurrences(expandedOf('nextjs'), REACT_CORE_MARKER)).toBe(1);
  });

  it('react.md expanded contains CSR-only marker (SVGR)', () => {
    expect(countOccurrences(expandedOf('react'), CSR_ONLY_MARKER)).toBe(1);
  });

  it('nextjs.md expanded does NOT contain CSR-only marker', () => {
    expect(countOccurrences(expandedOf('nextjs'), CSR_ONLY_MARKER)).toBe(0);
  });

  // Root entry coordinate guard — the `feature-route-layer` regression in
  // `architect-such-grading-knife` planned only `app/(protected)/page.tsx`
  // and silently dropped the literal `app/page.tsx`, because entry-point-
  // ownership-rule delegates framework coordinates here. Lock in the
  // literal-path pin so integration-band tasks have a place to read it
  // from at plan time.
  it('nextjs.md pins the literal app/page.tsx root coordinate', () => {
    const expanded = expandedOf('nextjs');
    expect(expanded).toContain('app/page.tsx');
    expect(expanded).toContain('app/layout.tsx');
    // Route group call-out: pinned so the LLM can't substitute `(group)/page.tsx`
    expect(expanded).toMatch(/route groups? .*not substitutes?/i);
  });
});
