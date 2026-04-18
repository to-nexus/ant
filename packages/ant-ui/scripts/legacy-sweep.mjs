#!/usr/bin/env node
/**
 * Async UI Policy — legacy sweep.
 *
 * Fails the build if any of the following appear outside their allowed
 * locations:
 *   - Loader2                  (allowed: primitives/)
 *   - animate-spin             (allowed: primitives/)
 *   - animate-pulse            (allowed: primitives/)
 *   - projectConfigExists      (removed; replaced by selectors)
 *   - useConfigLoader          (removed; replaced by store subscription)
 *   - connection.noConfig      (removed; empty state uses async.empty.projectConfig)
 *
 * Kept as a node script (not shell) so it runs identically on macOS/Linux
 * and inside CI even when `rg` is absent. See
 * docs/architecture/ui-async-policy.md §11 for context.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const ROOT = new URL('../src/', import.meta.url).pathname;

const ALLOWED_DIRS = [
  `presentation${sep}components${sep}common${sep}async${sep}primitives`,
  `i18n${sep}locales`,
];

const PATTERNS = [
  { name: 'Loader2', re: /\bLoader2\b/ },
  { name: 'animate-spin', re: /\banimate-spin\b/ },
  { name: 'animate-pulse', re: /\banimate-pulse\b/ },
  { name: 'projectConfigExists', re: /\bprojectConfigExists\b/ },
  { name: 'useConfigLoader', re: /\buseConfigLoader\b/ },
  { name: 'connection.noConfig', re: /connection\.noConfig/ },
];

function isAllowed(path) {
  return ALLOWED_DIRS.some((d) => path.includes(d));
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry)) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const hits = [];
for (const f of files) {
  if (isAllowed(f)) continue;
  const text = readFileSync(f, 'utf8');
  text.split('\n').forEach((line, idx) => {
    for (const { name, re } of PATTERNS) {
      if (re.test(line)) hits.push({ file: f, line: idx + 1, pattern: name, text: line.trim() });
    }
  });
}

if (hits.length > 0) {
  console.error('[legacy-sweep] Async UI Policy violations:');
  for (const h of hits) {
    console.error(`  ${h.file}:${h.line}  [${h.pattern}]  ${h.text}`);
  }
  console.error(
    `\nAllowed directories: ${ALLOWED_DIRS.join(', ')}\n`
    + 'See docs/architecture/ui-async-policy.md for the policy.',
  );
  process.exit(1);
}

console.log(`[legacy-sweep] OK — scanned ${files.length} files, 0 violations.`);
