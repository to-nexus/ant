/**
 * file-modularization prompt authoring guard — vivid-orbiting-dodge RCA (Fix C).
 *
 * The split guidance told the model HOW to split a monolith (entry point
 * re-exports submodules) but never to resolve the emptied original. So a split
 * task left a 2765-line duplicate test monolith in place, whose stale
 * assertions then failed and needed a whole extra remediation task to delete.
 *
 * This locks the post-split cleanup principle into the injection: the original
 * must be resolved (source → thin re-export; test file → deleted, since it is
 * discovered by the runner, not imported).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../..');
const FILE_MODULARIZATION = path.join(
  REPO_ROOT,
  'src/core/prompt/templates/jobs/code/nodes/execute/injections/file-modularization.md',
);

describe('file-modularization.md — post-split cleanup principle', () => {
  const body = fs.readFileSync(FILE_MODULARIZATION, 'utf8');

  it('instructs resolving the original after relocation (no residual duplicate)', () => {
    expect(body).toMatch(/after relocation/i);
    expect(body).toMatch(/re-export/i);
    expect(body).toMatch(/deleted?/i);
  });

  it('distinguishes import-target files (re-export) from discovered test files (delete)', () => {
    // Test files are discovered by a runner, not imported → original is deleted.
    expect(body).toMatch(/runner/i);
    expect(body).toMatch(/discover/i);
    expect(body).toMatch(/import/i);
  });

  it('stays platform-neutral (no framework/library names)', () => {
    expect(body).not.toMatch(/\bReact\b|\bNext\.js\b|\bTailwind\b|\bVitest\b|\bJest\b/);
  });
});
