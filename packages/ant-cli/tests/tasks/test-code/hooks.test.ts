/**
 * L2 — `tasks/test-code/hooks/*` adapter invariants.
 *
 * Locks the contract for T6 call-site flips:
 *   - scheduling.preTestgenBarrier  — true (block while feature/setup runs)
 *   - conversations.convKey         — `node:execute:test-code:<id>`
 *   - check.evaluate                — async; returns violation when no
 *                                     test files are found on disk, null
 *                                     when at least one exists
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

import {
  preTestgenBarrier,
  blocksDoc,
} from '../../../src/agents/architect/graph/code/tasks/test-code/hooks/scheduling';
import * as convHook from '../../../src/agents/architect/graph/code/tasks/test-code/hooks/conversations';
import { evaluate as checkEvaluate } from '../../../src/agents/architect/graph/code/tasks/test-code/hooks/check';
import { hooks as testCodeBundle, isTestCodeTask } from '../../../src/agents/architect/graph/code/tasks/test-code';
import { hooksForTaskType } from '../../../src/agents/architect/graph/code/tasks/_shared/registry';

import type { CodeTask } from '../../../src/agents/architect/types/task';
import type { ArchitectGraphState } from '../../../src/agents/architect/graph/code/state';

function task(id: string, overrides: Partial<CodeTask> = {}): CodeTask {
  return {
    id,
    name: id,
    type: 'test-code',
    priority: 400,
    description: `task ${id}`,
    ...overrides,
  } as CodeTask;
}

function stateWithFeaturePath(featurePath?: string): ArchitectGraphState {
  return { context: { featurePath } } as unknown as ArchitectGraphState;
}

function mkTmpFeature(contents: Record<string, string> = {}): string {
  // detectTestFilesFromDisk scans `${featurePath}/codebase` — mirror that layout.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-testcode-hook-'));
  const codebaseRoot = path.join(dir, 'codebase');
  fs.mkdirSync(codebaseRoot, { recursive: true });
  for (const [relPath, body] of Object.entries(contents)) {
    const abs = path.join(codebaseRoot, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, 'utf8');
  }
  return dir;
}

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) {
    const d = tmpDirs.pop()!;
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  vi.restoreAllMocks();
});

function tmpFeature(contents: Record<string, string> = {}): string {
  const d = mkTmpFeature(contents);
  tmpDirs.push(d);
  return d;
}

describe('tasks/_shared/registry — test-code entry', () => {
  it('returns the test-code bundle', () => {
    const hooks = hooksForTaskType('test-code');
    expect(hooks).toBe(testCodeBundle);
    // Consumer flag
    expect(hooks?.scheduling?.preTestgenBarrier).toBe(true);
    // Producer flag (T6b-ε): test-code work activates the doc barrier so
    // doc tasks wait for tests to finish before describing the codebase.
    expect(hooks?.scheduling?.blocksDoc).toBe(true);
    expect(hooks?.conversations?.convKey).toBe(convHook.convKey);
    expect(hooks?.check?.evaluate).toBe(checkEvaluate);
  });

  it('bundle publishes only scheduling + conversations + check slots', () => {
    // Slot-level absence — lock parity with ui/design-system precedents
    // so a future drive-by hook addition forces an explicit test update.
    expect(testCodeBundle.plan).toBeUndefined();
    expect(testCodeBundle.decompose).toBeUndefined();
    expect(testCodeBundle.tool).toBeUndefined();
    expect(testCodeBundle.command).toBeUndefined();
    expect(testCodeBundle.router).toBeUndefined();
    expect(testCodeBundle.orchestrator).toBeUndefined();
    // check.evaluate is published; but budgetExhaustedHint is NOT —
    // generic "Break down the task scope" is correct for test-code.
    expect(testCodeBundle.check?.budgetExhaustedHint).toBeUndefined();
  });

  it('scheduling exposes only testgen-consumer + doc-producer — no other flags', () => {
    // Consumer flags: only preTestgenBarrier.
    expect(testCodeBundle.scheduling?.preTestgenBarrier).toBe(true);
    expect(testCodeBundle.scheduling?.preDocBarrier).toBeUndefined();
    expect(testCodeBundle.scheduling?.preUiBarrier).toBeUndefined();
    expect(testCodeBundle.scheduling?.preIntegrationBarrier).toBeUndefined();
    // Producer flags: only blocksDoc. blocksTestgen=undefined is
    // intentional — self-activation would block sibling test-code
    // tasks from parallel scheduling. Regression guard.
    expect(testCodeBundle.scheduling?.blocksDoc).toBe(true);
    expect(testCodeBundle.scheduling?.blocksUi).toBeUndefined();
    expect(testCodeBundle.scheduling?.blocksTestgen).toBeUndefined();
    expect(testCodeBundle.scheduling?.blocksIntegration).toBeUndefined();
  });
});

describe('tasks/test-code/hooks/scheduling', () => {
  it('preTestgenBarrier — true', () => {
    expect(preTestgenBarrier).toBe(true);
  });

  it('blocksDoc — true (producer flag activates doc barrier)', () => {
    expect(blocksDoc).toBe(true);
  });
});

describe('tasks/test-code/hooks/conversations', () => {
  it('convKey — task-id-scoped', () => {
    expect(convHook.convKey(task('t1'))).toBe('node:execute:test-code:t1');
  });
});

describe('tasks/test-code/hooks/check', () => {
  it('evaluate — returns violation when no test files exist', async () => {
    const featurePath = tmpFeature({
      'src/main.ts': 'export const x = 1;',
    });
    const v = await checkEvaluate(stateWithFeaturePath(featurePath));
    expect(v).not.toBeNull();
    expect(v?.type).toBe('incomplete_implementation');
    expect(v?.severity).toBe('critical');
    expect(v?.isRetryable).toBe(true);
    expect(v?.message).toContain('test-code');
  });

  it('evaluate — returns null when a *.test.ts file exists', async () => {
    const featurePath = tmpFeature({
      'src/main.ts': 'export const x = 1;',
      'src/main.test.ts': 'import { x } from "./main";',
    });
    const v = await checkEvaluate(stateWithFeaturePath(featurePath));
    expect(v).toBeNull();
  });

  it('evaluate — returns null when a *.spec.js file exists', async () => {
    const featurePath = tmpFeature({
      'src/legacy.spec.js': 'test("a", () => {});',
    });
    const v = await checkEvaluate(stateWithFeaturePath(featurePath));
    expect(v).toBeNull();
  });

  it('evaluate — returns violation when featurePath is undefined', async () => {
    const v = await checkEvaluate(stateWithFeaturePath(undefined));
    expect(v?.type).toBe('incomplete_implementation');
  });
});

describe('tasks/test-code/model/is — isTestCodeTask', () => {
  // Introduced in T6b-κ so `nodes/plan/planGeneration.ts
  // taskRequiresPlan` can delegate the skip-planning predicate to the
  // per-task SSOT instead of keeping a `task.type !== 'test-code'`
  // literal in the phase layer.
  it('returns true only for test-code tasks', () => {
    expect(isTestCodeTask({ type: 'test-code' })).toBe(true);
    expect(isTestCodeTask({ type: 'feature' })).toBe(false);
    expect(isTestCodeTask({ type: 'verification' })).toBe(false);
    expect(isTestCodeTask({ type: 'doc' })).toBe(false);
  });

  it('handles null / undefined / missing type defensively', () => {
    expect(isTestCodeTask(null)).toBe(false);
    expect(isTestCodeTask(undefined)).toBe(false);
    expect(isTestCodeTask({})).toBe(false);
  });
});
