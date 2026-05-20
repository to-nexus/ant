/**
 * Plan termination SSOT — only `plan-tools-batch.md`'s Finalization Discipline
 * section may carry the *predicate* authority deciding when to emit `<plan>`.
 *
 * Other plan-phase template files (variants/*, plan/base.md, plan/rules.md,
 * shared injections) must NOT introduce variant phrasings of "emit plan
 * promptly", "stop reading once", "do NOT continue calling tools", etc.
 * Such variants compete with the SSOT predicate and produce the multi-gate
 * ambiguity that was the root of the `metal-curbing-grasp` / dotv1 cycling.
 *
 * Regression guard: a future PR that re-introduces a stopping cue in a
 * variant base.md or in the unconditional plan base/rules will fail this
 * test and be redirected back to the SSOT site.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const TEMPLATES_DIR = join(
  __dirname,
  '../../src/core/prompt/templates/jobs/code',
);

// The single SSOT site allowed to carry termination-predicate language.
const SSOT_RELATIVE_PATH = 'base/injections/plan-tools-batch.md';

// Predicate phrasings that signal the LLM "stop calling tools / emit plan".
// Any of these appearing OUTSIDE the SSOT file is a fragmentation violation.
const FORBIDDEN_PHRASINGS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /emit\s+`?<plan>`?\s+promptly/i, label: '"emit <plan> promptly"' },
  { pattern: /produce\s+`?<plan>`?\s+promptly/i, label: '"produce <plan> promptly"' },
  { pattern: /stop\s+reading\s+(once|when)/i, label: '"stop reading once/when"' },
  { pattern: /do\s+NOT\s+continue\s+calling\s+tools/i, label: '"do NOT continue calling tools"' },
  { pattern: /after\s+observation[^.]*emit/i, label: '"after observation ... emit"' },
  {
    pattern: /sufficient\s+information\s+is\s+gathered/i,
    label: '"sufficient information is gathered"',
  },
];

function walkMd(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const e of entries) {
    const full = join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) {
      files.push(...walkMd(full));
    } else if (e.endsWith('.md')) {
      files.push(full);
    }
  }
  return files;
}

describe('plan-phase termination SSOT', () => {
  it('only plan-tools-batch.md may carry termination predicate language', () => {
    const planDir = join(TEMPLATES_DIR, 'nodes/plan');
    const planFiles = walkMd(planDir);
    const sharedDir = join(TEMPLATES_DIR, 'shared');
    const sharedFiles = walkMd(sharedDir);
    const allCheckFiles = [...planFiles, ...sharedFiles];

    const violations: Array<{ file: string; phrase: string; line: number; snippet: string }> = [];

    for (const file of allCheckFiles) {
      const content = readFileSync(file, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        for (const { pattern, label } of FORBIDDEN_PHRASINGS) {
          if (pattern.test(lines[i])) {
            violations.push({
              file: file.replace(TEMPLATES_DIR + '/', ''),
              phrase: label,
              line: i + 1,
              snippet: lines[i].trim().slice(0, 120),
            });
          }
        }
      }
    }

    if (violations.length > 0) {
      const msg = violations
        .map(v => `  ${v.file}:${v.line} — ${v.phrase}\n    "${v.snippet}"`)
        .join('\n');
      throw new Error(
        `plan-phase termination phrasing found outside SSOT (${SSOT_RELATIVE_PATH}). ` +
          `Move authority to plan-tools-batch.md Finalization Discipline, ` +
          `or rephrase as type-specific guidance that does NOT use predicate language:\n${msg}`,
      );
    }
  });

  it('plan-tools-batch.md Finalization Discipline carries an observable predicate (Yes / No branches)', () => {
    const ssot = readFileSync(join(TEMPLATES_DIR, SSOT_RELATIVE_PATH), 'utf8');
    expect(ssot).toContain('Finalization Discipline');
    expect(ssot).toContain('Observable termination predicate');
    expect(ssot).toMatch(/-\s*\*\*Yes\*\*\s*→/);
    expect(ssot).toMatch(/-\s*\*\*No\*\*\s*→/);
    expect(ssot).toContain('emit `<plan>` in your next response');
    // Recursion-budget blind spot kept (named differently than before).
    expect(ssot).toContain('{{remainingRecursionBudget}}');
  });

  it('test-code variant carries the re-split escape hatch (≥ 8 files OR 4+ modules)', () => {
    const variant = readFileSync(
      join(TEMPLATES_DIR, 'nodes/plan/variants/test-code/base.md'),
      'utf8',
    );
    expect(variant).toContain('Re-split escape hatch');
    expect(variant).toContain('8 distinct test files');
    expect(variant).toContain('4+ disjoint module groupings');
    expect(variant).toContain('{{batchSplitCount}}');
    // The previous unconditional block must be gone.
    expect(variant).not.toMatch(/Do NOT propose\s+`batches\[\]`\s+again/);
  });
});
