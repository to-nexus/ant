/**
 * Service Virtualization vocabulary alignment regression guard.
 *
 * Phase 2 of the `mock_real_symmetry_ssot` plan renamed the abstract SSOT
 * table from "Mock-use prompt SSOTs (MECE)" to
 * "Service Virtualization prompt SSOTs (MECE)" across:
 *
 *   - `.cursorrules`
 *   - `CLAUDE.md`
 *   - `docs/rubric/SYSTEM-DESIGN-RUBRIC.md`
 *
 * The umbrella concept ("Service Virtualization") MUST anchor every
 * cross-document SSOT table; the leaf vocabulary "mock" remains valid
 * for env vars / adapter labels / fake body — but the abstract table
 * title and partial filenames belong to the umbrella.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const FILES_TO_CHECK = [
  path.join(REPO_ROOT, '.cursorrules'),
  path.join(REPO_ROOT, 'CLAUDE.md'),
  path.join(REPO_ROOT, 'docs/rubric/SYSTEM-DESIGN-RUBRIC.md'),
];

function read(p: string): string {
  return fs.readFileSync(p, 'utf-8');
}

describe('Service Virtualization SSOT — table title alignment', () => {
  it('.cursorrules + CLAUDE.md cite the new "Service Virtualization prompt SSOTs (MECE)" header', () => {
    for (const f of [FILES_TO_CHECK[0], FILES_TO_CHECK[1]]) {
      const src = read(f);
      expect(
        src.includes('Service Virtualization prompt SSOTs (MECE)'),
        `${f} missing new SSOT table title`,
      ).toBe(true);
    }
  });

  it('legacy "Mock-use prompt SSOTs (MECE)" header is REMOVED everywhere', () => {
    for (const f of FILES_TO_CHECK) {
      if (!fs.existsSync(f)) continue;
      const src = read(f);
      expect(
        src.includes('Mock-use prompt SSOTs (MECE)'),
        `${f} still cites the legacy "Mock-use prompt SSOTs (MECE)" header`,
      ).toBe(false);
    }
  });

  it('the rubric Infrastructure Independence section is reframed under Service Virtualization', () => {
    const src = read(FILES_TO_CHECK[2]);
    expect(src).toMatch(/Infrastructure Independence \(Service Virtualization\)/);
    expect(src).toMatch(/Toggle Env Var/);
  });
});
