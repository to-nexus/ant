/**
 * Priority isolation sweep — phase-layer code MUST NEVER perform a
 * semantic comparison against `task.priority`.
 *
 * Three-Axis SSOT (`AGENTS.md` "Three-Axis Task Modeling"):
 *
 *   - `task.type` and `task.band` are the only legal scheduling
 *     discriminators read by phase-layer code (orchestrator / router /
 *     parallel / nodes).
 *   - `task.priority` is the TaskQueue's sort key only — semantic
 *     comparisons (`priority === FINAL_VERIFICATION`, band windows,
 *     `priority < 300`, etc.) are forbidden outside the decompose
 *     `priority → band` mapping site (`responseParser.deriveBandFromPriority`).
 *
 * This sweep ripgreps the phase-layer .ts files and asserts ZERO
 * matches for `*.priority` followed by a numeric / TASK_PRIORITIES
 * comparator. Violations indicate either (a) a priority comparison
 * leaked back into phase code, or (b) a new SSOT site needs to be
 * documented as an explicit exception below.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');

// Phase layers under sweep — orchestrator / parallel / routers / phase
// nodes (decompose / plan / execute / checkTaskStatus / detect / triage)
// across every job graph + the cross-job graph helpers under
// `agents/common/graph`. The `tasks/{type}/hooks/scheduling.ts` files
// are bundle code, NOT phase code; they are SSOT for "my band means
// scheduling role X" and CAN read priority (e.g. doc bundle's
// design-job tokens/foundation priority bands).
const PHASE_DIRS = [
  // Code job — task-aware phases
  'src/agents/architect/graph/code/parallel',
  'src/agents/architect/graph/code/routers',
  'src/agents/architect/graph/code/nodes/plan',
  'src/agents/architect/graph/code/nodes/execute',
  'src/agents/architect/graph/code/nodes/checkTaskStatus',
  'src/agents/architect/graph/code/nodes/detect',
  'src/agents/architect/graph/code/nodes/resolve',
  'src/agents/architect/graph/code/nodes/direct',
  'src/agents/architect/graph/code/nodes/learn',
  'src/agents/architect/graph/code/nodes/revise',
  'src/agents/architect/graph/code/nodes/tool',
  // Design job
  'src/agents/architect/graph/design/nodes',
  // Other jobs
  'src/agents/architect/graph/ask/nodes',
  'src/agents/architect/graph/learn/nodes',
  // Cross-job graph + nodes (loadDocumentsForRAC, triage, plan, detect, resolve, conversations).
  // Triage lives at `agents/common/graph/nodes/triage` (cross-job), not under code/.
  'src/agents/common/graph',
];

// Decompose is the single phase-layer site that MAY translate priority
// into a semantic value (the priority→band mapping). The sweep skips
// `responseParser.ts` so that one site doesn't trip the gate.
const DECOMPOSE_EXCEPTION = path.normalize(
  'src/agents/architect/graph/code/nodes/decompose/responseParser.ts',
);

// `tasks/_shared/batchSplit/process.ts` legitimately reads priority
// for the Path A `parent − 1` clamp (`Math.max(1, parent - 1)`). That
// is pure arithmetic on a sort key, not a semantic comparison.
// Allowlisted explicitly so the sweep stays focused on comparisons.
const BATCH_SPLIT_EXCEPTION = path.normalize(
  'src/agents/architect/graph/code/tasks/_shared/batchSplit/process.ts',
);

function listTsFiles(dir: string, acc: string[] = []): string[] {
  const abs = path.join(repoRoot, dir);
  if (!fs.existsSync(abs)) {
    throw new Error(
      `priority-isolation sweep: PHASE_DIRS entry "${dir}" does not exist. ` +
      `If a phase directory was renamed or removed, update PHASE_DIRS — ` +
      `silent-skip would let priority comparisons creep in unobserved.`,
    );
  }
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listTsFiles(rel, acc);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      acc.push(rel);
    }
  }
  return acc;
}

describe('priority isolation sweep — phase layer reads no semantic priority', () => {
  // Match `<expr>.priority <op> <number-or-TASK_PRIORITIES.X>`.
  // Both directions are caught (literal LHS would still need .priority
  // somewhere in the statement; we keep it strict to .priority on the LHS).
  const numericCmp = /\.priority\s*[<>!=]=?\s*\d+/g;
  const constantCmp = /\.priority\s*[<>!=]=?\s*TASK_PRIORITIES\./g;

  for (const dir of PHASE_DIRS) {
    it(`${dir} — zero priority comparisons`, () => {
      const files = listTsFiles(dir);
      const violations: { file: string; matches: string[] }[] = [];
      for (const rel of files) {
        if (rel === DECOMPOSE_EXCEPTION) continue;
        if (rel === BATCH_SPLIT_EXCEPTION) continue;
        const src = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
        const hits = [
          ...(src.match(numericCmp) ?? []),
          ...(src.match(constantCmp) ?? []),
        ];
        if (hits.length > 0) {
          violations.push({ file: rel, matches: hits });
        }
      }
      expect(violations).toEqual([]);
    });
  }

  it('priority→band SSOT lives at exactly one site', () => {
    // The decompose responseParser is the ONLY phase code that may
    // translate priority into a semantic band. If a second site appears
    // (e.g. someone re-introduces a priority window check in plan or
    // execute), priority comparisons fragment again and the deadlock
    // surface re-opens.
    const decompose = fs.readFileSync(
      path.join(repoRoot, DECOMPOSE_EXCEPTION),
      'utf8',
    );
    expect(decompose).toContain('deriveBandFromPriority');
    expect(decompose).toMatch(/TASK_PRIORITIES\.SHARED_FOUNDATION/);
    expect(decompose).toMatch(/TASK_PRIORITIES\.INTEGRATION_MIN/);
  });
});
