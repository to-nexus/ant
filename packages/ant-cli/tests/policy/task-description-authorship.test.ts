/**
 * Task Description Authorship sweep — `BaseTask.description` MUST be the
 * LLM-authored per-task scope of work, never the job-level user directive.
 *
 * SSOT (`AGENTS.md` "Task Description Authorship"):
 *
 *   - Assigning `state.directive` / `state.overrideDirective` (or a variable
 *     holding them) to `task.description` is forbidden — the directive is
 *     job-level and reaches every prompt on its own channel.
 *   - A second field carrying per-task scope alongside `description` is
 *     forbidden (the historical `DesignTask.sectionScope` split is the
 *     defect's original form — commit e6f409f03e added the parallel field
 *     instead of replacing the directive copy, leaving a half-fix).
 *   - Floor: non-empty after trim, enforced at task creation
 *     (`isTaskDescriptionAuthored` / `MissingTaskDescriptionViolation`).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createDefaultTask,
  createExplainTask,
} from '../../src/agents/architect/graph/design/nodes/decompose/defaults.js';
import { buildSpecRevisionDecomposition } from '../../src/agents/architect/graph/design/nodes/decompose/specDecompose.js';
import {
  validateTaskDescriptions,
  MissingTaskDescriptionViolation,
  buildMissingTaskDescriptionViolationFraming,
} from '../../src/agents/architect/graph/code/nodes/decompose/validation.js';

const repoRoot = path.resolve(__dirname, '../..');

// Every file that constructs BaseTask objects (LLM parse-throughs, synthetic
// factories, split helpers). A rename must update this list — silent-skip
// would let a directive assignment creep back in unobserved.
const TASK_CREATING_FILES = [
  'src/agents/architect/graph/design/nodes/decompose/specDecompose.ts',
  'src/agents/architect/graph/design/nodes/decompose/uiDesignDecompose.ts',
  'src/agents/architect/graph/design/nodes/decompose/gameArtDesignDecompose.ts',
  'src/agents/architect/graph/design/nodes/decompose/systemDesignDecompose.ts',
  'src/agents/architect/graph/design/nodes/decompose/defaults.ts',
  'src/agents/architect/graph/design/nodes/decompose/prdSync.ts',
  'src/agents/architect/graph/design/nodes/revise.ts',
  'src/agents/architect/graph/code/nodes/decompose/responseParser.ts',
  'src/agents/architect/graph/code/nodes/revise/index.ts',
  'src/agents/architect/graph/code/tasks/_shared/batchSplit/process.ts',
  'src/agents/architect/graph/code/tasks/error/hooks/orchestrator.ts',
];

// `sectionScope` may exist ONLY as a local variable in the system-design
// execute intent (catalog-computed section assignment). These surfaces must
// stay at zero occurrences (code, after comment strip) — a hit means a
// parallel per-task scope field returned.
const SECTION_SCOPE_FORBIDDEN = [
  'src/agents/architect/types/task.ts',
  'src/agents/architect/graph/design/nodes/decompose',
  'src/agents/architect/graph/design/nodes/plan',
  'src/agents/architect/graph/design/nodes/execute/intent/spec.ts',
  'src/agents/architect/graph/design/nodes/execute/intent/selfCheck.ts',
];
const SECTION_SCOPE_SOLE_PRODUCER =
  'src/agents/architect/graph/design/nodes/execute/intent/system.ts';

function mustRead(rel: string): string {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) {
    throw new Error(
      `task-description-authorship sweep: "${rel}" does not exist. ` +
      `If the file was renamed or removed, update the sweep list — ` +
      `silent-skip would let violations creep in unobserved.`,
    );
  }
  return fs.readFileSync(abs, 'utf8');
}

function listTsFiles(rel: string, acc: string[] = []): string[] {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) {
    throw new Error(
      `task-description-authorship sweep: path "${rel}" does not exist — update the sweep list.`,
    );
  }
  if (fs.statSync(abs).isFile()) {
    acc.push(rel);
    return acc;
  }
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const child = path.join(rel, entry.name);
    if (entry.isDirectory()) listTsFiles(child, acc);
    else if (entry.isFile() && entry.name.endsWith('.ts')) acc.push(child);
  }
  return acc;
}

// Strip line comments and block comments (naive but sufficient — the swept
// sources keep code and comments on structurally distinct lines).
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('task description authorship — static sweeps', () => {
  // Catches `description: directive`, `description: state.directive`,
  // `description: state.overrideDirective || …`, `description: directive || '…'`.
  const directiveAssignment = /description:\s*[^,\n}]*\bdirective\b/i;

  for (const rel of TASK_CREATING_FILES) {
    it(`${path.basename(rel)} — no directive-as-description assignment`, () => {
      const src = stripComments(mustRead(rel));
      const hit = src.match(directiveAssignment);
      expect(
        hit,
        hit ? `forbidden assignment in ${rel}: "${hit[0]}"` : undefined,
      ).toBeNull();
    });
  }

  it('sectionScope has exactly one producer (execute/intent/system.ts)', () => {
    const offenders: string[] = [];
    for (const surface of SECTION_SCOPE_FORBIDDEN) {
      for (const rel of listTsFiles(surface)) {
        if (stripComments(mustRead(rel)).includes('sectionScope')) {
          offenders.push(rel);
        }
      }
    }
    expect(
      offenders,
      `parallel scope field returned: ${offenders.join(', ')}`,
    ).toEqual([]);

    // The surviving single producer must still exist — if system-design's
    // computed sectionScope is refactored away, retire this row deliberately.
    expect(stripComments(mustRead(SECTION_SCOPE_SOLE_PRODUCER))).toContain('sectionScope');
  });

  it('spec decompose LLM contract emits the canonical "description" key (no "scope")', () => {
    const src = mustRead(
      'src/agents/architect/graph/design/nodes/decompose/specDecompose.ts',
    );
    // Prompt example must carry the canonical key so the Kanban streaming
    // reader (`kanbanUpdate.ts` raw.description) sees it mid-stream.
    expect(src).toMatch(/"description":"Scope of thinking/);
    // The SpecTask contract must not regrow a parallel `scope` field.
    const iface = src.match(/interface SpecTask \{[\s\S]*?\}/)?.[0];
    expect(iface).toBeDefined();
    expect(iface!).toMatch(/description: string/);
    expect(iface!).not.toMatch(/\bscope\s*:\s*string/);
  });
});

describe('task description authorship — synthetic factories never leak the directive', () => {
  const TOKEN = 'ZZDIRECTIVE_TOKEN_ZZ';

  it('createDefaultTask — constant, non-empty', () => {
    const t = createDefaultTask();
    expect(t.description.trim().length).toBeGreaterThan(0);
    expect(t.description).not.toContain(TOKEN);
  });

  it('createExplainTask — constant, ignores state.directive', () => {
    const t = createExplainTask({
      directive: TOKEN,
      resolvedAction: { intentGroup: 'design-ui' },
    } as any);
    expect(t.description.trim().length).toBeGreaterThan(0);
    expect(t.description).not.toContain(TOKEN);
  });

  it('buildSpecRevisionDecomposition — deterministic scope references the document, not the directive', async () => {
    const state = {
      directive: TOKEN,
      overrideDirective: TOKEN,
      context: { featurePath: '/feat' },
      deps: {
        fileSystem: {
          fileExists: async () => false,
          readFile: async () => { throw new Error('ENOENT'); },
        },
      },
    } as any;
    const r = await buildSpecRevisionDecomposition(state, 'wallet-login.md');
    expect(r.tasks).toHaveLength(1);
    expect(r.tasks[0].description.trim().length).toBeGreaterThan(0);
    expect(r.tasks[0].description).not.toContain(TOKEN);
    expect(r.tasks[0].description).toContain('wallet-login.md');
  });
});

describe('task description authorship — code-job floor is typed and framed', () => {
  const task = (description: unknown) =>
    ({ id: 't-1', name: 'Sample Task', type: 'feature', priority: 300, description }) as any;

  const rows: Array<{ label: string; description: unknown; throws: boolean }> = [
    { label: 'undefined', description: undefined, throws: true },
    { label: 'empty string', description: '', throws: true },
    { label: 'whitespace only', description: '   ', throws: true },
    { label: 'valid', description: 'Implement the session store', throws: false },
  ];

  for (const row of rows) {
    it(`description=${row.label} → ${row.throws ? 'throws' : 'passes'}`, () => {
      const run = () => validateTaskDescriptions([task(row.description)]);
      if (row.throws) {
        expect(run).toThrow(MissingTaskDescriptionViolation);
      } else {
        expect(run).not.toThrow();
      }
    });
  }

  it('framing names the offending task', () => {
    let violation: MissingTaskDescriptionViolation | undefined;
    try {
      validateTaskDescriptions([task('')]);
    } catch (e) {
      violation = e as MissingTaskDescriptionViolation;
    }
    expect(violation).toBeInstanceOf(MissingTaskDescriptionViolation);
    expect(violation!.message).toContain('t-1');
    const framing = buildMissingTaskDescriptionViolationFraming(violation!);
    expect(framing).toContain('Sample Task');
    expect(framing).toContain('description');
  });
});
