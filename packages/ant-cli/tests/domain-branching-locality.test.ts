/**
 * I1 — Domain-Branching Locality (Phase 1)
 *
 * Domain content branching MUST live inside `templates/basis/**` only.
 * Anywhere else, conditionals comparing `domain === 'game'` /
 * `domain === 'service'` (or Handlebars `{{#if (eq domain 'game')}}` etc.)
 * are forbidden — the matrix gate (`isTierActive`) drives partial
 * inclusion instead.
 *
 * Decision-slot comparisons (`{{#if gameEngineCandidates}}`) are still
 * allowed because they are meta-process variables, not domain identity.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const TEMPLATES_ROOT = path.resolve(__dirname, '../src/core/prompt/templates');

function collectMdFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMdFiles(full));
    } else if (entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

function isUnderBasis(file: string): boolean {
  // Inside `templates/basis/` OR inside `templates/jobs/<job>/basis/`.
  const rel = path.relative(TEMPLATES_ROOT, file).replace(/\\/g, '/');
  if (rel.startsWith('basis/')) return true;
  return /^jobs\/[^/]+\/basis\//.test(rel);
}

// Patterns that match domain-name comparisons.
//   - {{#if (eq domain 'game')}}
//   - {{#if eq domain "service"}}
//   - {{#if domain "==" "game"}}    (legacy syntax)
const DOMAIN_BRANCH_RE = /\{\{[#^]\s*if\s+[^}]*?(?:\bdomain\b[^}]*?['"]\s*(game|service)\s*['"]|['"]\s*(game|service)\s*['"][^}]*?\bdomain\b)/g;

describe('I1 — Domain-Branching Locality', () => {
  it('basis/** files MAY contain domain branches (allowed)', () => {
    // Sanity: no offenders by definition; the test enforces no branches
    // outside basis. We assert the lookup function is well-formed by
    // checking a known basis file.
    const basisDomainFile = path.join(TEMPLATES_ROOT, 'basis/domain/game.md');
    if (fs.existsSync(basisDomainFile)) {
      expect(isUnderBasis(basisDomainFile)).toBe(true);
    }
  });

  it('domain content branches outside basis/** are forbidden', () => {
    const allFiles = collectMdFiles(TEMPLATES_ROOT);
    const offenders: Array<{ file: string; matches: string[] }> = [];

    for (const file of allFiles) {
      if (isUnderBasis(file)) continue;
      const src = fs.readFileSync(file, 'utf-8');
      const matches = [...src.matchAll(DOMAIN_BRANCH_RE)].map(m => m[0]);
      if (matches.length > 0) {
        offenders.push({ file: path.relative(TEMPLATES_ROOT, file), matches });
      }
    }

    if (offenders.length > 0) {
      const report = offenders.map(o => `  ${o.file}: ${o.matches.join(' | ')}`).join('\n');
      throw new Error(
        `Domain content branches found outside basis/**.\nMove them to basis/domain/{d}.md or jobs/<job>/basis/domain/{d}.md.\nViolations:\n${report}`,
      );
    }
    expect(offenders).toHaveLength(0);
  });
});
