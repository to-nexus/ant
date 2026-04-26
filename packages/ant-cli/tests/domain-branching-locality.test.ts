/**
 * I1 — Domain-Branching Locality (Phase 1, refined by D27 / v6)
 *
 * Domain content branching MUST live inside one of the following
 * "domain-aware" directories — anywhere else, conditionals comparing
 * `domain === 'game'` / `domain === 'service'` (or Handlebars
 * `{{#if (eq domain 'game')}}` etc.) are forbidden:
 *
 *   - `templates/domain/**`             (workspace identity, job-agnostic)
 *   - `templates/basis/**`              (tier-gated content; some tier
 *                                        partials still need to mention
 *                                        domain-specific framing)
 *   - `templates/jobs/<job>/domain/**`  (job × domain meta-pattern overlay)
 *   - `templates/jobs/<job>/basis/**`   (job × tier overlay)
 *
 * D27 (v6) lifts `domain/` from `basis/domain/` into a sibling directory
 * because `domain` is no longer a TierKey (D23) and basis is, by
 * definition, the set of *tiers* that the domain has gated on. The
 * matrix gate (`isTierActive`) drives partial inclusion; domain
 * identity is layered separately by `PromptBuilder.renderDomainTier`.
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

function isInDomainAwareDir(file: string): boolean {
  // Domain-aware directories where domain branching is legal:
  //   - templates/domain/**            (workspace identity, D27)
  //   - templates/basis/**             (tier-gated content)
  //   - templates/jobs/<job>/domain/** (job × domain overlay, D27)
  //   - templates/jobs/<job>/basis/**  (job × tier overlay)
  const rel = path.relative(TEMPLATES_ROOT, file).replace(/\\/g, '/');
  if (rel.startsWith('domain/')) return true;
  if (rel.startsWith('basis/')) return true;
  if (/^jobs\/[^/]+\/domain\//.test(rel)) return true;
  if (/^jobs\/[^/]+\/basis\//.test(rel)) return true;
  return false;
}

// Patterns that match domain-name comparisons.
//   - {{#if (eq domain 'game')}}
//   - {{#if eq domain "service"}}
//   - {{#if domain "==" "game"}}    (legacy syntax)
const DOMAIN_BRANCH_RE = /\{\{[#^]\s*if\s+[^}]*?(?:\bdomain\b[^}]*?['"]\s*(game|service)\s*['"]|['"]\s*(game|service)\s*['"][^}]*?\bdomain\b)/g;

describe('I1 — Domain-Branching Locality', () => {
  it('domain-aware directories (domain/**, basis/**) MAY contain domain branches', () => {
    // Sanity: assert the lookup function is well-formed by checking a
    // known domain identity file (post-D27, lives at templates/domain/).
    const domainIdentityFile = path.join(TEMPLATES_ROOT, 'domain/game.md');
    if (fs.existsSync(domainIdentityFile)) {
      expect(isInDomainAwareDir(domainIdentityFile)).toBe(true);
    }
    // Tier-gated basis files are also domain-aware.
    const tierBasisDir = path.join(TEMPLATES_ROOT, 'basis');
    if (fs.existsSync(tierBasisDir)) {
      expect(isInDomainAwareDir(path.join(tierBasisDir, 'visualTier/_preamble.md'))).toBe(true);
    }
  });

  it('domain content branches outside domain-aware directories are forbidden', () => {
    const allFiles = collectMdFiles(TEMPLATES_ROOT);
    const offenders: Array<{ file: string; matches: string[] }> = [];

    for (const file of allFiles) {
      if (isInDomainAwareDir(file)) continue;
      const src = fs.readFileSync(file, 'utf-8');
      const matches = [...src.matchAll(DOMAIN_BRANCH_RE)].map(m => m[0]);
      if (matches.length > 0) {
        offenders.push({ file: path.relative(TEMPLATES_ROOT, file), matches });
      }
    }

    if (offenders.length > 0) {
      const report = offenders.map(o => `  ${o.file}: ${o.matches.join(' | ')}`).join('\n');
      throw new Error(
        `Domain content branches found outside domain-aware directories.\nLegal locations: templates/domain/**, templates/basis/**, jobs/<job>/domain/**, jobs/<job>/basis/**.\nViolations:\n${report}`,
      );
    }
    expect(offenders).toHaveLength(0);
  });
});
