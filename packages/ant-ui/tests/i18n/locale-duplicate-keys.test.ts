/**
 * Locale JSON duplicate-key guard.
 *
 * RCA (May 2026): `viewMode` was declared TWICE in `nav.json` (ko + en).
 * `JSON.parse` silently kept the second occurrence and dropped the first,
 * so `viewMode.agents` / `viewMode.code` resolved to `undefined` at
 * runtime. i18next then echoed the raw key name back to the GNB —
 * users saw literal `viewMode.agents` chips in production builds.
 *
 * The bug was invisible to TypeScript, vite, prettier, and JSON.parse,
 * which made it a recurring foot-gun. This guard walks every locale
 * JSON with a tiny lexer that records key names per object-context and
 * fails the build if any object declares the same key twice at the same
 * nesting level. Catches the failure mode at its source — no need to
 * also lint every i18next caller.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

interface Duplicate {
  file: string;
  key: string;
  line: number;
}

/**
 * Tiny lexer that tracks per-object key sets. Strict JSON only (no
 * comments, no trailing commas) — sufficient because the entire locale
 * tree is `.json`. We deliberately do NOT use `JSON.parse` here: parsing
 * is exactly the step that swallows the duplicates we are trying to find.
 */
function findDuplicateKeys(text: string, file: string): Duplicate[] {
  const findings: Duplicate[] = [];
  const stack: Array<Set<string>> = [];
  let i = 0;
  const n = text.length;
  let inString = false;
  let escaped = false;
  let buf = '';

  while (i < n) {
    const c = text[i];
    if (escaped) {
      escaped = false;
      i++;
      continue;
    }
    if (c === '\\' && inString) {
      escaped = true;
      i++;
      continue;
    }
    if (c === '"') {
      if (!inString) {
        inString = true;
        buf = '';
        i++;
        continue;
      }
      inString = false;
      // Decide whether the closed string is a key (followed by `:`) or a value.
      let j = i + 1;
      while (j < n && /\s/.test(text[j])) j++;
      if (text[j] === ':') {
        const top = stack[stack.length - 1];
        if (top) {
          if (top.has(buf)) {
            findings.push({
              file,
              key: buf,
              line: text.slice(0, i).split('\n').length,
            });
          }
          top.add(buf);
        }
      }
      i++;
      continue;
    }
    if (inString) {
      buf += c;
      i++;
      continue;
    }
    if (c === '{') {
      stack.push(new Set());
      i++;
      continue;
    }
    if (c === '}') {
      stack.pop();
      i++;
      continue;
    }
    i++;
  }
  return findings;
}

function walkLocaleFiles(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkLocaleFiles(p, out);
    else if (entry.name.endsWith('.json')) out.push(p);
  }
}

describe('locale JSON files', () => {
  it('must not declare the same key twice at any nesting level', () => {
    const localesDir = path.resolve(__dirname, '../../src/i18n/locales');
    expect(fs.existsSync(localesDir)).toBe(true);

    const files: string[] = [];
    walkLocaleFiles(localesDir, files);
    expect(files.length).toBeGreaterThan(0);

    const allFindings: Duplicate[] = [];
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf-8');
      // Sanity: file must be valid JSON. If not, that's a separate failure
      // surface (vite would also blow up at runtime).
      expect(() => JSON.parse(text), `${f} is not valid JSON`).not.toThrow();
      allFindings.push(...findDuplicateKeys(text, f));
    }

    if (allFindings.length > 0) {
      // Make the error message actionable: list every offending file/key/line.
      const rel = (p: string) => path.relative(process.cwd(), p);
      const report = allFindings
        .map(d => `  - ${rel(d.file)}:${d.line} duplicates key "${d.key}"`)
        .join('\n');
      throw new Error(
        `Duplicate JSON keys found in locale files (last occurrence silently overrides earlier ones — i18next will echo the raw key name in the UI):\n${report}`,
      );
    }
  });
});
