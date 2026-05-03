/**
 * Output Tag Policy Lint — anti-pattern + partial-content invariants.
 *
 * Locks two layers of the Output Tag Matrix:
 *
 *   1. Anti-pattern wording (free text shown to user, pre-tag prose is
 *      visible, "outside the tags" rationale, etc.) does NOT exist
 *      anywhere in the prompt template tree EXCEPT the canonical
 *      `output-tag-policy.md` partial. Every other site that needs to
 *      restate the rule MUST cite the contract — never duplicate it.
 *
 *   2. The canonical partial itself MUST contain the two strict
 *      invariants (first-token discipline + no cross-axis nesting) and
 *      MUST list `<reply>` as the narrative tag. If any of these
 *      sentinels disappear, the contract has drifted.
 *
 * Catches the regression class where a node prompt re-introduces
 * "free text outside any tag is shown verbatim" — the exact wording
 * that motivated this whole channel separation.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const TEMPLATES_DIR = join(
  __dirname,
  '../../src/core/prompt/templates',
);
const POLICY_PATH = join(
  TEMPLATES_DIR,
  'jobs/shared/injections/output-tag-policy.md',
);

function walkMd(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walkMd(full, out);
    else if (entry.endsWith('.md')) out.push(full);
  }
  return out;
}

const ALL_TEMPLATES = walkMd(TEMPLATES_DIR);
const NON_POLICY_TEMPLATES = ALL_TEMPLATES.filter((p) => p !== POLICY_PATH);

describe('Output Tag Policy — partial content invariants', () => {
  const body = readFileSync(POLICY_PATH, 'utf8');

  it('declares first-token discipline (Invariant 1)', () => {
    expect(body).toMatch(/Invariant 1.*First-token discipline/i);
    expect(body).toMatch(/very first.*output token MUST be `<`/i);
  });

  it('declares no cross-axis nesting (Invariant 2)', () => {
    expect(body).toMatch(/Invariant 2.*No nesting/i);
    expect(body).toMatch(/MUST NOT nest/i);
  });

  it('lists the five intent axes by name', () => {
    for (const axis of [
      'artifact',
      'narrative',
      'control',
      'decision',
      'metadata',
    ]) {
      expect(body).toContain(`| ${axis} |`);
    }
  });

  it('names <reply> as the narrative tag', () => {
    expect(body).toMatch(/narrative.*`<reply>`/);
  });

  it('explicitly disambiguates <reply> from <clarify>', () => {
    expect(body).toMatch(/`<reply>`/);
    expect(body).toMatch(/`<clarify>`/);
    expect(body.toLowerCase()).toMatch(/halts the job/);
  });
});

describe('Output Tag Policy — anti-pattern lint across all templates', () => {
  // Wording that contradicts Invariant 1 / Invariant 2 — banned outside
  // the canonical partial. Each pattern carries a one-line rationale.
  const ANTI_PATTERNS: { pattern: RegExp; reason: string }[] = [
    {
      pattern: /pre-.*text will be shown.*verbatim/i,
      reason:
        'Anti-pattern: teaches the LLM that pre-tag prose is shown to the user verbatim. Contradicts Invariant 1 (first-token discipline).',
    },
    {
      pattern: /text\s+OUTSIDE\s+the\s+`?<\w+>`?\s+tag/i,
      reason:
        'Anti-pattern: legitimises free text outside any registered tag — the very channel the matrix closes.',
    },
    {
      pattern: /reasoning before a tool call.*shown as chat text/i,
      reason: 'Anti-pattern: legitimises pre-tool-call free text as chat output.',
    },
    {
      pattern: /respond directly in chat text only/i,
      reason:
        'Anti-pattern: instructs free-text response without specifying the `<reply>` wrapper.',
    },
  ];

  for (const { pattern, reason } of ANTI_PATTERNS) {
    it(`anti-pattern not present anywhere outside the canonical partial: ${pattern.source.slice(0, 50)}…`, () => {
      const violators: string[] = [];
      for (const path of NON_POLICY_TEMPLATES) {
        const text = readFileSync(path, 'utf8');
        if (pattern.test(text)) {
          violators.push(path.replace(TEMPLATES_DIR, '<templates>'));
        }
      }
      expect(
        violators,
        `${reason}\n\nFound in:\n${violators.join('\n')}`,
      ).toEqual([]);
    });
  }

  it('the canonical partial is the SSOT (file exists)', () => {
    expect(() => readFileSync(POLICY_PATH, 'utf8')).not.toThrow();
  });
});
