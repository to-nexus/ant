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

const BASIS_ROOT = join(__dirname, '../src/core/prompt/templates/jobs/code/basis/techTier');

const ALLOWED_FRAMEWORK = ['nextjs', 'react', 'react-native', 'nestjs', 'gin'];
const ALLOWED_LANGUAGE = ['typescript-browser', 'typescript-node', 'go'];

const ALLOWED_SECTIONS = [
  '## Forbidden Patterns',
  '## Symptom → Upstream Cues',
  '## Version Notes',
  '## Toolchain Compatibility',
];

/**
 * Token budget ceiling — plan §2.2 hard target: ≤ 400 tokens per file.
 *
 * Measured with the OpenAI canonical estimator (`Math.ceil(chars / 4)`),
 * which is accurate enough for the English-prose hint files (±10 %).
 * If a file is genuinely on the boundary, the 5-10 % slack inherent in
 * the estimator covers it. Going above 400 indicates the file has grown
 * beyond the 4-section Hints-layer contract.
 */
const TOKEN_CEILING = 400;

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

describe('basis/techTier hint files — budget', () => {
  const files = [
    ...collectMd(join(BASIS_ROOT, 'framework')),
    ...collectMd(join(BASIS_ROOT, 'language')),
  ];

  it('at least one file is present', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map(f => [f]))(`%s is ≤ ${TOKEN_CEILING} tokens`, (path) => {
    const text = readFileSync(path, 'utf8');
    const tokens = estimateTokens(text);
    expect(
      tokens,
      `${path} estimated ${tokens} tokens (chars/4); budget is ${TOKEN_CEILING}`,
    ).toBeLessThanOrEqual(TOKEN_CEILING);
  });
});

describe('basis/techTier hint files — allowed filenames', () => {
  it('framework directory contains only allowed entries', () => {
    const dir = join(BASIS_ROOT, 'framework');
    if (!existsSync(dir)) return;
    const names = readdirSync(dir)
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace(/\.md$/, ''));
    for (const name of names) {
      expect(ALLOWED_FRAMEWORK, `framework/${name}.md not in allowed set`).toContain(name);
    }
  });

  it('language directory contains only allowed entries', () => {
    const dir = join(BASIS_ROOT, 'language');
    if (!existsSync(dir)) return;
    const names = readdirSync(dir)
      .filter(f => f.endsWith('.md'))
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
