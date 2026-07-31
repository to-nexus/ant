/**
 * Class-of-bug injection family — wiring gate.
 *
 * Some code-job partials carry a *class-of-bug* principle rather than
 * gate-specific content: they apply to every code-authoring surface, so they
 * are hard-wired with `{{> }}` at every plan / execute / direct variant rather
 * than resolved per-gate by `AutoInjectionResolver`. Because the wiring is
 * hand-written per file, a new variant (or a new family member) silently misses
 * sites unless the set is asserted.
 *
 * This locks the WIRING, not the prose: which sites include each member, and
 * that every member reaches the same set. Rewording a partial must never break
 * this test.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const TEMPLATES = path.join(__dirname, '../../src/core/prompt/templates');

/**
 * Every code-authoring surface a class-of-bug principle must reach. `doc` /
 * `explain` variants are intentionally absent — they author prose, not code.
 */
const SITES = [
  'jobs/code/nodes/direct/variants/default/base.md',
  'jobs/code/nodes/plan/base.md',
  'jobs/code/nodes/plan/variants/verification/base.md',
  'jobs/code/nodes/plan/variants/error/base.md',
  'jobs/code/nodes/execute/variants/default/base.md',
  'jobs/code/nodes/execute/variants/seam/base.md',
  'jobs/code/nodes/execute/variants/verification/base.md',
  'jobs/code/nodes/execute/variants/error/base.md',
] as const;

/** One row per family member. Add a row when a new class-of-bug partial lands. */
const FAMILY = [
  'dep-self-contained',
  'observable-fallback',
] as const;

function read(rel: string): string {
  return fs.readFileSync(path.join(TEMPLATES, rel), 'utf-8');
}

describe('class-of-bug injection family', () => {
  it.each(FAMILY)('%s exists as a partial', (member) => {
    const p = path.join(TEMPLATES, `jobs/code/base/injections/${member}.md`);
    expect(fs.existsSync(p), `missing partial: ${member}.md`).toBe(true);
    expect(read(`jobs/code/base/injections/${member}.md`).trim().length).toBeGreaterThan(0);
  });

  it.each(FAMILY)('%s is included at every code-authoring site', (member) => {
    const include = `{{> jobs/code/base/injections/${member}}}`;
    const missing = SITES.filter((site) => !read(site).includes(include));
    expect(missing, `${member} not wired at: ${missing.join(', ')}`).toEqual([]);
  });

  it('no family member is wired anywhere the others are not', () => {
    const siteSetOf = (member: string) =>
      SITES.filter((s) => read(s).includes(`{{> jobs/code/base/injections/${member}}}`));
    const sets = FAMILY.map((m) => siteSetOf(m).join('|'));
    expect(new Set(sets).size, `family wiring diverged: ${JSON.stringify(sets)}`).toBe(1);
  });
});
