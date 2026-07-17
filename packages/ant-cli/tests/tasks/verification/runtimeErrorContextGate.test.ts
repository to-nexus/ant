/**
 * `hasUserRuntimeErrorContext` gate + verification base.md Step 1.5 — truth
 * table lock (orbit-mapping-heart RCA).
 *
 * The gate (`buildPlanPrompt.ts`) is `containsRuntimeErrorPattern(directive)
 * || renderPriorErrorTasks(state)?.length > 0`. Two invariants:
 *
 *   I1 — signal correctness: decompose-authored error siblings must NOT fire
 *        the gate (they are planned work, not runtime-failure grounding);
 *        split-born sub-tasks and runtime-error directives must keep firing
 *        (gleam-growing-grace protection from commit 294d9c2ff stays intact).
 *   I2 — terminal totality: when Step 1.5 renders, it must carry the
 *        machine-observability boundary so the sentinel prohibition can never
 *        eliminate every legal terminal output of the verify plan loop.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import {
  FilePromptAdapter,
  initPartials,
} from '../../../src/periphery/adapters/prompt/FilePromptAdapter';
import { containsRuntimeErrorPattern } from '../../../src/core/utils/runtimeErrorPattern';
import { renderPriorErrorTasks } from '../../../src/agents/architect/graph/code/tasks/_shared/verify/prompt/priorErrorTasks';
import type { ArchitectGraphState } from '../../../src/agents/architect/graph/code/state';
import type { CodeTask } from '../../../src/agents/architect/types/task';

const TEMPLATES_DIR = join(__dirname, '../../../src/core/prompt/templates');
const VERIFICATION_BASE = 'jobs/code/nodes/plan/variants/verification/base';

function errorTask(id: string, batchSplitCount?: number): CodeTask {
  return {
    id,
    name: `task-${id}`,
    type: 'error',
    priority: 900,
    description: `desc-${id}`,
    ...(batchSplitCount !== undefined ? { batchSplitCount } : {}),
  } as CodeTask;
}

function gate(directive: string, state: ArchitectGraphState): boolean {
  return (
    containsRuntimeErrorPattern(directive) ||
    (renderPriorErrorTasks(state)?.length ?? 0) > 0
  );
}

describe('hasUserRuntimeErrorContext gate — truth table (I1)', () => {
  it('decompose-authored error siblings alone do NOT fire the gate', () => {
    const state = {
      completedTasksDetails: [errorTask('e1'), errorTask('e2'), errorTask('e3')],
    } as unknown as ArchitectGraphState;
    expect(gate('스펙 문서를 기반으로 코드를 생성해주세요', state)).toBe(false);
  });

  it('split-born error sub-tasks fire the gate (cycle-2 reverify keeps grounding)', () => {
    const state = {
      completedTasksDetails: [errorTask('e1', 1)],
    } as unknown as ArchitectGraphState;
    expect(gate('스펙 문서를 기반으로 코드를 생성해주세요', state)).toBe(true);
  });

  it('runtime-error directive fires the gate regardless of prior tasks (gleam-growing-grace protection)', () => {
    const state = { completedTasksDetails: [] } as unknown as ArchitectGraphState;
    const directive =
      'next dev fails: Error: Cannot find module postcss — build broken at app/globals.css';
    expect(gate(directive, state)).toBe(true);
  });
});

describe('verification base.md Step 1.5 — render contract (I2)', () => {
  let adapter: FilePromptAdapter;

  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
  });

  const baseVars = {
    taskId: 'integration-verification',
    taskName: '통합 검증',
    taskDescription: 'run gates',
    directive: 'some directive',
    userLanguage: 'en',
    runTests: true,
    hasTools: true,
    projectCodeContext: '',
    directoryTree: '',
    violationsText: '',
    isRetry: false,
    languageHints: '',
    hasLanguageHints: false,
    dependencyStatus: '',
    packageManager: 'npm',
    hasPackageManager: true,
    sessionSummary: '',
    hasSessionSummary: false,
    acceptanceSource: '',
    hasAcceptanceSource: false,
    allowPersistentProcesses: true,
    hasPriorExecuteHistory: false,
    analysis: '',
    hasAnalysis: false,
  };

  it('gate OFF → Step 1.5 (cross-reference + reproducer requirement) absent', async () => {
    const rendered = await adapter.render(VERIFICATION_BASE, {
      ...baseVars,
      hasUserRuntimeErrorContext: false,
    });
    expect(rendered).not.toContain('Cross-reference User Report');
    expect(rendered).not.toContain('Reproducer requirement');
    expect(rendered).not.toContain('Machine-observability boundary');
  });

  it('gate ON → Step 1.5 present WITH the machine-observability terminal escape', async () => {
    const rendered = await adapter.render(VERIFICATION_BASE, {
      ...baseVars,
      hasUserRuntimeErrorContext: true,
    });
    expect(rendered).toContain('Cross-reference User Report');
    expect(rendered).toContain('Reproducer requirement');
    // I2 — totality: the sentinel prohibition must ship with its escape.
    expect(rendered).toContain('Machine-observability boundary');
    expect(rendered).toContain('NOT machine-observable');
    expect(rendered).toContain('requires human confirmation');
    // The three-way terminal enumeration keeps at least one legal output per
    // evidence state.
    expect(rendered).toContain('always has a legal terminal');
  });
});
