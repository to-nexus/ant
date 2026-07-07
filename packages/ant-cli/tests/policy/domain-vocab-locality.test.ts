/**
 * Domain-Vocabulary Locality (P2 guard — game-domain defect follow-up)
 *
 * Sibling of `domain-branching-locality.test.ts`. That test catches
 * Handlebars `{{#if (eq domain …)}}` branches; this one catches the
 * *class of bug* it cannot see — service-domain English vocabulary
 * hard-coded into always-on (non-overlay) templates, which silently
 * privileges the service domain even though symmetric domain overlays
 * exist.
 *
 * Two independent scans:
 *
 *  - **Set A — service-only vocabulary** (`WCAG`, `SOC2`, `NewsData.io`,
 *    `Product Manager`, …): forbidden in always-on templates but LEGAL in
 *    the domain-aware overlays (`templates/domain/**`, `templates/basis/**`,
 *    `jobs/<job>/domain/**`, `jobs/<job>/basis/**`) — e.g.
 *    `jobs/design/domain/service.md` legitimately enumerates service
 *    compliance concerns. Bare `PRD` is NOT on this list: after the
 *    GDD→PRD unification the plan document is the domain-neutral PRD in
 *    every domain, so `PRD` is universal vocabulary.
 *
 *  - **Set B — the retired `GDD` concept** (`GDD`, `Game Design Document`,
 *    `PRD / GDD`): forbidden EVERYWHERE, overlays included. A game
 *    project's plan document is a PRD (`plan/prd.md`) that carries game
 *    sections via the `domain==='game'` overlay — "GDD" is no longer a
 *    distinct artifact name and must not reappear in any template.
 *
 * A line may opt out with an explicit `<!-- domain-vocab-ok: <reason> -->`
 * marker on the same line, for the rare legitimate mention. Prefer
 * rewording over the marker; the tree is expected to pass with zero
 * markers today.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const TEMPLATES_ROOT = path.resolve(__dirname, '../../src/core/prompt/templates');
const ALLOWLIST_MARKER = 'domain-vocab-ok';

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

// Mirrors `domain-branching-locality.test.ts`: the four domain-aware
// directories where domain-specific vocabulary is legal.
function isInDomainAwareDir(file: string): boolean {
  const rel = path.relative(TEMPLATES_ROOT, file).replace(/\\/g, '/');
  if (rel.startsWith('domain/')) return true;
  if (rel.startsWith('basis/')) return true;
  if (/^jobs\/[^/]+\/domain\//.test(rel)) return true;
  if (/^jobs\/[^/]+\/basis\//.test(rel)) return true;
  return false;
}

// Set A — service-only vocabulary. Case-sensitive on acronyms / brand
// names / capitalised roles so neutral prose is never caught.
const SERVICE_VOCAB: Array<{ label: string; re: RegExp }> = [
  { label: 'Product Manager', re: /\bProduct Manager\b/ },
  { label: 'Persona(s)', re: /\bPersonas?\b/ },
  { label: 'WCAG', re: /\bWCAG\b/ },
  { label: 'SOC2', re: /\bSOC ?2\b/ },
  { label: 'HIPAA', re: /\bHIPAA\b/ },
  { label: 'GDPR', re: /\bGDPR\b/ },
  { label: 'SLA', re: /\bSLAs?\b/ },
  { label: 'NewsData.io', re: /NewsData\.io/ },
  { label: 'CryptoPanic', re: /CryptoPanic/ },
];

// Set B — the retired GDD concept, forbidden in every template.
const GDD_CONCEPT: Array<{ label: string; re: RegExp }> = [
  { label: 'GDD', re: /\bGDD\b/ },
  { label: 'Game Design Document', re: /Game Design Document/i },
  { label: 'PRD / GDD', re: /PRD\s*\/\s*GDD/ },
];

function scanLines(
  file: string,
  tokens: Array<{ label: string; re: RegExp }>,
): Array<{ line: number; label: string; text: string }> {
  const src = fs.readFileSync(file, 'utf-8');
  const hits: Array<{ line: number; label: string; text: string }> = [];
  src.split('\n').forEach((text, i) => {
    if (text.includes(ALLOWLIST_MARKER)) return;
    for (const { label, re } of tokens) {
      if (re.test(text)) hits.push({ line: i + 1, label, text: text.trim().slice(0, 120) });
    }
  });
  return hits;
}

function formatOffenders(
  offenders: Array<{ file: string; hits: Array<{ line: number; label: string; text: string }> }>,
): string {
  return offenders
    .map(o => `  ${o.file}\n${o.hits.map(h => `    :${h.line} [${h.label}] ${h.text}`).join('\n')}`)
    .join('\n');
}

describe('Domain-Vocabulary Locality', () => {
  const allFiles = collectMdFiles(TEMPLATES_ROOT);

  it('Set A — service-only vocabulary is absent from always-on (non-overlay) templates', () => {
    const offenders: Array<{ file: string; hits: ReturnType<typeof scanLines> }> = [];
    for (const file of allFiles) {
      if (isInDomainAwareDir(file)) continue; // overlays may carry service vocab
      const hits = scanLines(file, SERVICE_VOCAB);
      if (hits.length > 0) offenders.push({ file: path.relative(TEMPLATES_ROOT, file), hits });
    }
    if (offenders.length > 0) {
      throw new Error(
        'Service-domain vocabulary found in always-on (non-overlay) templates. ' +
          'Move it into a domain overlay (jobs/<job>/domain/service.md) or reword to be ' +
          'domain-neutral. Overlays under domain/** and basis/** are exempt.\nViolations:\n' +
          formatOffenders(offenders),
      );
    }
    expect(offenders).toHaveLength(0);
  });

  it('Set B — the retired "GDD" concept is absent from every template (overlays included)', () => {
    const offenders: Array<{ file: string; hits: ReturnType<typeof scanLines> }> = [];
    for (const file of allFiles) {
      const hits = scanLines(file, GDD_CONCEPT);
      if (hits.length > 0) offenders.push({ file: path.relative(TEMPLATES_ROOT, file), hits });
    }
    if (offenders.length > 0) {
      throw new Error(
        'The retired "GDD" concept was found in a template. A game project\'s plan ' +
          'document is a PRD (`plan/prd.md`) that carries game sections via the ' +
          '`domain===\'game\'` overlay — use "PRD", never "GDD".\nViolations:\n' +
          formatOffenders(offenders),
      );
    }
    expect(offenders).toHaveLength(0);
  });
});
