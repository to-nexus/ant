/**
 * Phase 3.4 lint guard — silent .catch(() => undefined) patterns inside the
 * cleanup paths.
 *
 * The cascade fix removed silent error swallowing in cleanupProject /
 * deleteFeature so partial deletes can no longer hide behind a swallowed warn.
 * This guard pins ONLY those specific method bodies — defensive
 * fire-and-forget calls in `startIDE` (e.g. setContainerHostname) are out of
 * scope and remain valid.
 *
 * Methods in scope:
 *   - IDEService.cleanupProject (lines 53–137 region)
 *   - ProjectService.deleteFeature (lines containing "deleteFeature")
 */

import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');

const SILENT_CATCH_RX = /\.catch\(\s*\(\s*\)\s*=>\s*(?:undefined|null|\{\s*\})\s*\)/;

/**
 * Extract the body of a method by name. Tracks brace depth from the opening
 * brace on the declaration line so the right closing brace is matched.
 */
function extractMethodBody(src: string, methodSignatureRx: RegExp): string {
  const lines = src.split('\n');
  let inMethod = false;
  let braceDepth = 0;
  const out: string[] = [];
  for (const line of lines) {
    if (!inMethod) {
      if (methodSignatureRx.test(line)) {
        inMethod = true;
        // Count braces on the signature line itself.
        for (const ch of line) {
          if (ch === '{') braceDepth++;
          else if (ch === '}') braceDepth--;
        }
        out.push(line);
        if (braceDepth === 0 && /\}/.test(line)) {
          // single-line method body
          break;
        }
        continue;
      }
    } else {
      out.push(line);
      for (const ch of line) {
        if (ch === '{') braceDepth++;
        else if (ch === '}') braceDepth--;
      }
      if (braceDepth === 0) break;
    }
  }
  return out.join('\n');
}

describe('silent-catch lint guard', () => {
  it('IDEService.cleanupProject body has no silent .catch(() => undefined|null|{})', async () => {
    const full = path.join(ROOT, 'src/periphery/adapters/ide/IDEService.ts');
    const src = await readFile(full, 'utf-8');
    const body = extractMethodBody(src, /async cleanupProject\(/);
    expect(body, 'extractMethodBody returned empty').not.toBe('');
    expect(SILENT_CATCH_RX.test(body), `Silent catch found inside IDEService.cleanupProject body:\n${body}`).toBe(false);
  });

  it('ProjectService.deleteFeature body has no silent .catch(() => undefined|null|{})', async () => {
    const full = path.join(ROOT, 'src/periphery/adapters/http/services/ProjectService/index.ts');
    const src = await readFile(full, 'utf-8');
    const body = extractMethodBody(src, /async deleteFeature\(/);
    expect(body, 'extractMethodBody returned empty').not.toBe('');
    expect(SILENT_CATCH_RX.test(body), `Silent catch found inside ProjectService.deleteFeature body:\n${body}`).toBe(false);
  });
});
