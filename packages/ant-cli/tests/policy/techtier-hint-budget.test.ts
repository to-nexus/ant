/**
 * Phase 5-23/25 — basis/techTier hint file budget + section-header linter.
 *
 * Enforces §2.2 of the Phase 2 refactoring plan:
 *   - Each file under `jobs/code/basis/techTier/{framework,language}/`
 *     MUST NOT exceed the token budget. The plan's design target is
 *     ≤ 400 tokens; we enforce a ≤ 600-token hard ceiling using the
 *     OpenAI canonical estimator (`Math.ceil(chars / 4)`). See
 *     `docs/architecture/13-prompt-system.md "Hints 계층"` for the
 *     full rationale — the 600-token ceiling is the "no-bloat" gate
 *     (original `nextjs.md` was ~2000 tokens before this phase).
 *   - Each file may only use the four allowed section headers, in the
 *     prescribed order, and must not introduce other H2 headers.
 *   - Allowed filenames are pinned by the Hints-layer spec; any extra
 *     file on disk must appear in the allowed set.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const TEMPLATES_ROOT = join(__dirname, '../../src/core/prompt/templates');
const BASIS_ROOT = join(TEMPLATES_ROOT, 'jobs/code/basis/techTier');

const ALLOWED_FRAMEWORK = ['nextjs', 'react', 'react-native', 'nestjs', 'gin'];
const ALLOWED_LANGUAGE = ['typescript-browser', 'typescript-node', 'go'];

const ALLOWED_SECTIONS = [
  '## Forbidden Patterns',
  '## Symptom → Upstream Cues',
  '## Version Notes',
  '## Toolchain Compatibility',
];

/**
 * Token budget ceilings.
 *
 * - `RAW_TOKEN_CEILING` = 600: per-file cap on the markdown as authored.
 *   400 is the design target; 600 is the hard ceiling that still prevents
 *   the original ~2000-token bloat era.
 * - `EXPANDED_TOKEN_CEILING` = 1200: cap after Handlebars partials expand.
 *   Composite files (e.g. `nextjs.md` = `_react-core` partial + Next.js
 *   body, `react.md` = `_react-core` + `_react-csr`) naturally exceed the
 *   raw ceiling because the rendered output is the sum of parts. 1200 is
 *   still well below the pre-refactor bloat baseline.
 */
const RAW_TOKEN_CEILING = 600;
const EXPANDED_TOKEN_CEILING = 1200;

/**
 * Estimate token count for the file. Uses the OpenAI canonical
 * "1 token ≈ 4 characters of English" approximation.
 *
 * This is slightly optimistic for Korean/code-heavy content and slightly
 * pessimistic for pure prose — but stable and reproducible, and the
 * ceiling accounts for the uncertainty.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function collectMd(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => join(dir, f));
}

/**
 * Recursively expand Handlebars `{{> name}}` partial references against
 * the templates directory. Used so that the token budget gate reflects
 * what the LLM actually sees — `react.md` is a thin shell that pulls in
 * `_react-core` + `_react-csr`, and `nextjs.md` pulls in `_react-core`.
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

describe('basis/techTier hint files — budget', () => {
  const files = [
    ...collectMd(join(BASIS_ROOT, 'framework')),
    ...collectMd(join(BASIS_ROOT, 'language')),
  ];

  it('at least one file is present', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  // Raw file budget — prevents authored bloat in any single hint file,
  // whether leaf (`_react-core`) or composite (`react.md` with partial
  // references). The composite file's raw size is small because the
  // body is just `{{> ...}}` references.
  it.each(files.map(f => [f]))(`%s raw is ≤ ${RAW_TOKEN_CEILING} tokens`, (path) => {
    const text = readFileSync(path, 'utf8');
    const tokens = estimateTokens(text);
    expect(
      tokens,
      `${path} raw ${tokens} tokens (chars/4); budget is ${RAW_TOKEN_CEILING}`,
    ).toBeLessThanOrEqual(RAW_TOKEN_CEILING);
  });

  // Expanded budget — measures what the LLM actually sees after
  // Handlebars partials are pulled in. Cap is higher than the raw cap
  // because composite files legitimately grow by partial inclusion.
  it.each(files.map(f => [f]))(`%s expanded is ≤ ${EXPANDED_TOKEN_CEILING} tokens`, (path) => {
    const text = readFileSync(path, 'utf8');
    const expanded = expandPartials(text);
    const tokens = estimateTokens(expanded);
    expect(
      tokens,
      `${path} expanded to ${tokens} tokens (chars/4); budget is ${EXPANDED_TOKEN_CEILING}`,
    ).toBeLessThanOrEqual(EXPANDED_TOKEN_CEILING);
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
});
