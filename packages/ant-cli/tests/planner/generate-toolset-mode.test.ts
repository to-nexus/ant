/**
 * Regression — game plan job wrote code + saved nothing (idle-lapping-manor).
 *
 * The planner authors a NEW document (generate mode) exclusively via the
 * `<file>` output tag, which is create-capable (`mkdir -p` + `writeFile`).
 * `edit_file` (a) cannot create a missing file and (b) short-circuits the
 * generate node before the `<file>` writer runs — so if generate advertises
 * `edit_file`, a tool-writing turn silently produces no output. Only refactor
 * (rev-plan) edits an EXISTING document and legitimately needs `edit_file`.
 *
 * `plannerToolsForMode` is the SSOT for that split; this pins it.
 */

import { describe, it, expect } from 'vitest';
import { plannerToolsForMode } from '../../src/agents/planner/graph/plan/nodes/tools';

const names = (mode: 'generate' | 'refactor' | 'explain') =>
  plannerToolsForMode(mode).map(t => t.name);

describe('plannerToolsForMode', () => {
  it('generate: NO edit_file (write path is the <file> tag only)', () => {
    expect(names('generate')).not.toContain('edit_file');
  });

  it('explain: NO edit_file (read-only)', () => {
    expect(names('explain')).not.toContain('edit_file');
  });

  it('refactor: HAS edit_file (edits the existing PRD in place)', () => {
    expect(names('refactor')).toContain('edit_file');
  });

  it('all modes keep read tools for workspace/codebase orientation', () => {
    for (const mode of ['generate', 'refactor', 'explain'] as const) {
      expect(names(mode)).toEqual(
        expect.arrayContaining(['read_workspace_file', 'list_workspace_files']),
      );
    }
  });
});
