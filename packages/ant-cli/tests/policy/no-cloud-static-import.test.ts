/**
 * OSS / Cloud seam — P0.9 guard #1: NO static `@ant/cloud` import anywhere.
 *
 * The physical extraction depends on `@ant/cloud` being reachable ONLY through
 * the indirected dynamic import in `cloudPlugin.ts` (`const spec = '@ant/cloud'`
 * → `import(spec)`). A bundler cannot statically resolve that, and the package
 * is an optionalDependency, so the OSS build compiles + boots without it.
 *
 * If any file regains a static form — `import … from '@ant/cloud'`, a literal
 * `import('@ant/cloud')`, or `require('@ant/cloud')` — the OSS build breaks (the
 * specifier becomes a hard dependency). This guard fails the moment that happens.
 *
 * Plain comments / doc-strings that mention `@ant/cloud` are fine; only the
 * import FORMS are forbidden.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '../../src');
const PLUGIN = join(SRC, 'core/cloud/cloudPlugin.ts');

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      out.push(...walkTs(full));
    } else if (/\.(ts|tsx|cts|mts)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

// Drop whole comment lines so a doc-string mentioning the specifier never trips
// the import-form scan. Line-based (not a regex block stripper) so a `/*`
// sequence inside a string literal can't wipe surrounding code.
function stripComments(src: string): string {
  return src
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');
}

const STATIC_IMPORT_FORMS = [
  /\bfrom\s+['"]@ant\/cloud(\/[^'"]*)?['"]/, // import … from '@ant/cloud'
  /\bimport\s*\(\s*['"]@ant\/cloud(\/[^'"]*)?['"]\s*\)/, // import('@ant/cloud') literal
  /\brequire\s*\(\s*['"]@ant\/cloud(\/[^'"]*)?['"]\s*\)/, // require('@ant/cloud')
];

describe('OSS/Cloud seam — no static @ant/cloud import', () => {
  const files = walkTs(SRC);

  it('finds source files to scan', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('no file uses a static/literal import form of @ant/cloud', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const code = stripComments(readFileSync(f, 'utf8'));
      if (STATIC_IMPORT_FORMS.some((re) => re.test(code))) {
        offenders.push(relative(SRC, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('cloudPlugin.ts is the single site that names the specifier, via an indirected const', () => {
    const plugin = readFileSync(PLUGIN, 'utf8');
    // The specifier lives in a const so bundlers leave it as a runtime import.
    expect(plugin).toMatch(/const\s+spec\s*=\s*['"]@ant\/cloud['"]/);
    expect(plugin).toMatch(/import\(\s*\/\*\s*@vite-ignore\s*\*\/\s*spec\s*\)/);
    // Even cloudPlugin itself must not carry a static form (the indirection
    // is the whole point).
    expect(STATIC_IMPORT_FORMS.some((re) => re.test(stripComments(plugin)))).toBe(false);
  });
});
