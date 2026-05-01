/**
 * I4 — Basis Partial Invariant (Phase 1, F-2)
 *
 * `templates/basis/**` is intentionally excluded from Handlebars partial
 * registration ([FilePromptAdapter.ts L76–78]). Anything inside
 * `basis/**` that emits `{{> }}` is broken at runtime — the partial name
 * cannot resolve.
 *
 * Likewise, files under `jobs/**\/basis/**` MUST NOT include partials by
 * `basis/...` paths because those partials never get registered. They may
 * include partials in the `jobs/...` namespace (which IS registered) and
 * may use private partials co-located in the same `jobs/.../basis/...`
 * tree using the `_*-private.md` naming convention.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const TEMPLATES_ROOT = path.resolve(
  __dirname,
  '../../src/core/prompt/templates',
);

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

const PARTIAL_INCLUDE_RE = /\{\{>\s*([\w/\-]+)/g;

describe('I4 — basis partial invariant', () => {
  it('templates/basis/** files MUST NOT use any {{> }} include', () => {
    const root = path.join(TEMPLATES_ROOT, 'basis');
    const files = collectMdFiles(root);
    const offenders: Array<{ file: string; matches: string[] }> = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf-8');
      const matches = [...src.matchAll(PARTIAL_INCLUDE_RE)].map(m => m[0]);
      if (matches.length > 0) {
        offenders.push({ file: path.relative(TEMPLATES_ROOT, file), matches });
      }
    }
    if (offenders.length > 0) {
      const report = offenders
        .map(o => `  ${o.file}: ${o.matches.join(', ')}`)
        .join('\n');
      throw new Error(
        `templates/basis/** must not contain partial includes — they are not registered.\nViolations:\n${report}`,
      );
    }
    expect(offenders).toHaveLength(0);
  });

  it('templates/jobs/**/basis/** files MUST NOT include partials by `basis/...` path', () => {
    const jobsRoot = path.join(TEMPLATES_ROOT, 'jobs');
    if (!fs.existsSync(jobsRoot)) return;
    const offenders: Array<{ file: string; matches: string[] }> = [];

    for (const job of fs.readdirSync(jobsRoot)) {
      const basisDir = path.join(jobsRoot, job, 'basis');
      if (!fs.existsSync(basisDir)) continue;
      const files = collectMdFiles(basisDir);
      for (const file of files) {
        const src = fs.readFileSync(file, 'utf-8');
        const bad = [...src.matchAll(/\{\{>\s*basis\//g)].map(m => m[0]);
        if (bad.length > 0) {
          offenders.push({ file: path.relative(TEMPLATES_ROOT, file), matches: bad });
        }
      }
    }

    if (offenders.length > 0) {
      const report = offenders.map(o => `  ${o.file}: ${o.matches.join(', ')}`).join('\n');
      throw new Error(
        `jobs/**/basis/** files must not include partials by 'basis/...' path — those partials are not registered.\nViolations:\n${report}`,
      );
    }
    expect(offenders).toHaveLength(0);
  });
});
