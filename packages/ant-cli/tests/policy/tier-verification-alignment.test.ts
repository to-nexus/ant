/**
 * Tier-Verification Alignment (Phase 1) — end-to-end invariants.
 *
 * Covers:
 *   1. createTaskQueue's tier-based validation (Tier 2 exactly-1,
 *      Tier 3/4 >= 2 tasks with verification task mandatory).
 *   2. `selfVerifyOnDone` flag passthrough (set at Tier 2, stripped elsewhere).
 *   3. The `error` task's Final Verification auto-enqueue is now a
 *      defense-in-depth fallback (NEVER fires for Tier 2, primary Tier 3/4
 *      paths should emit verification explicitly).
 *   4. The error execute prompt no longer contains the "Run build command …
 *      to verify" contradiction text.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createTaskQueue } from '../../src/agents/architect/graph/code/nodes/decompose/responseParser';
import { onTaskComplete } from '../../src/agents/architect/graph/code/tasks/error/hooks/orchestrator';
import { TASK_PRIORITIES } from '../../src/agents/architect/graph/code/state';
import { TaskQueue } from '../../src/agents/architect/types/task';
import type { CodeTask } from '../../src/agents/architect/types/task';
import { ExecutionTierId } from '@ant/shared';

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// ─────────────────────────────────────────────────────────────
// createTaskQueue — Tier-based validation
// ─────────────────────────────────────────────────────────────

const featureTask = (overrides: Partial<CodeTask> = {}): CodeTask => ({
  id: 'feature-1',
  name: 'Build feature',
  type: 'feature',
  priority: 300,
  description: 'implement X',
  packages: ['shared'],
  ...overrides,
});

const errorTask = (overrides: Partial<CodeTask> = {}): CodeTask => ({
  id: 'error-1',
  name: 'Fix error',
  type: 'error',
  priority: 900,
  description: 'fix Y',
  packages: ['shared'],
  ...overrides,
});

const finalVerificationTask = (): CodeTask => ({
  id: 'final-verification',
  name: 'Final Verification',
  type: 'verification',
  priority: TASK_PRIORITIES.FINAL_VERIFICATION,
  description: 'validate build + tests',
});

describe('createTaskQueue — Tier 2 (Exploratory, single unit of work)', () => {
  it('accepts exactly 1 task with selfVerifyOnDone:true', () => {
    const tasks: CodeTask[] = [
      errorTask({ selfVerifyOnDone: true } as any),
    ];
    const { taskQueue } = createTaskQueue(
      tasks,
      null,
      undefined,
      ExecutionTierId.Exploratory,
    );
    expect(taskQueue.size()).toBe(1);
    expect((taskQueue.getAll()[0] as any).selfVerifyOnDone).toBe(true);
  });

  it('accepts exactly 1 explain task without selfVerifyOnDone', () => {
    const tasks: CodeTask[] = [
      {
        id: 'explain-1',
        name: 'Explain X',
        type: 'explain',
        priority: 200,
        description: 'explain',
        packages: ['shared'],
      },
    ];
    const { taskQueue } = createTaskQueue(
      tasks,
      null,
      undefined,
      ExecutionTierId.Exploratory,
    );
    expect(taskQueue.size()).toBe(1);
  });

  it('throws when Tier 2 emits 0 tasks', () => {
    expect(() =>
      createTaskQueue([], null, undefined, ExecutionTierId.Exploratory),
    ).toThrow(/Tier 2 \(Exploratory.*\) requires EXACTLY one task/);
  });

  it('throws when Tier 2 emits 2+ tasks', () => {
    const tasks: CodeTask[] = [
      featureTask({ selfVerifyOnDone: true } as any),
      errorTask({ id: 'error-2', selfVerifyOnDone: true } as any),
    ];
    expect(() =>
      createTaskQueue(tasks, null, undefined, ExecutionTierId.Exploratory),
    ).toThrow(/Tier 2 \(Exploratory.*\) requires EXACTLY one task/);
  });

  it('throws when Tier 2 non-explain task is missing selfVerifyOnDone:true', () => {
    const tasks: CodeTask[] = [errorTask()];
    expect(() =>
      createTaskQueue(tasks, null, undefined, ExecutionTierId.Exploratory),
    ).toThrow(/missing selfVerifyOnDone:true/);
  });

  it('throws when Tier 2 selfVerifyOnDone is explicitly false on a non-explain task', () => {
    const tasks: CodeTask[] = [errorTask({ selfVerifyOnDone: false } as any)];
    expect(() =>
      createTaskQueue(tasks, null, undefined, ExecutionTierId.Exploratory),
    ).toThrow(/missing selfVerifyOnDone:true/);
  });
});

describe('createTaskQueue — Tier 3/4 (Task / RefsGrounded)', () => {
  it('accepts a feature task + verification task (n=2)', () => {
    const tasks: CodeTask[] = [featureTask(), finalVerificationTask()];
    const { taskQueue } = createTaskQueue(
      tasks,
      null,
      undefined,
      ExecutionTierId.Task,
    );
    expect(taskQueue.size()).toBe(2);
  });

  it('accepts an error task + verification task (n=2) — the former "n=1 error-only" case must now ship verification explicitly', () => {
    const tasks: CodeTask[] = [errorTask(), finalVerificationTask()];
    const { taskQueue } = createTaskQueue(
      tasks,
      null,
      undefined,
      ExecutionTierId.Task,
    );
    expect(taskQueue.size()).toBe(2);
  });

  it('throws when Tier 3 emits only 1 task (allTasksAreRemediation n=1 allowance retired)', () => {
    const tasks: CodeTask[] = [errorTask()];
    expect(() =>
      createTaskQueue(tasks, null, undefined, ExecutionTierId.Task),
    ).toThrow(/requires AT LEAST 2 tasks/);
  });

  it('throws when Tier 4 emits only 1 task', () => {
    const tasks: CodeTask[] = [featureTask()];
    expect(() =>
      createTaskQueue(tasks, null, undefined, ExecutionTierId.RefsGrounded),
    ).toThrow(/requires AT LEAST 2 tasks/);
  });

  it('throws when Tier 3 has 2+ tasks but no verification task', () => {
    const tasks: CodeTask[] = [
      errorTask(),
      errorTask({ id: 'error-2' }),
    ];
    expect(() =>
      createTaskQueue(tasks, null, undefined, ExecutionTierId.Task),
    ).toThrow(/missing a Final Verification task/);
  });

  it('strips selfVerifyOnDone from Tier 3/4 tasks (flag is Tier-2-only)', () => {
    const tasks: CodeTask[] = [
      featureTask({ selfVerifyOnDone: true } as any),
      finalVerificationTask(),
    ];
    const { taskQueue } = createTaskQueue(
      tasks,
      null,
      undefined,
      ExecutionTierId.Task,
    );
    const feat = taskQueue.getAll().find(t => t.type === 'feature');
    expect((feat as any)?.selfVerifyOnDone).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// error/hooks/orchestrator.ts — auto-enqueue is a safety net,
// not the primary path.
// ─────────────────────────────────────────────────────────────

describe('error onTaskComplete — Final Verification auto-enqueue fallback', () => {
  it('NEVER fires for a Tier 2 task (selfVerifyOnDone:true owns inline verification)', () => {
    const queue = new TaskQueue<CodeTask>();
    const completedTask = errorTask({ selfVerifyOnDone: true } as any);

    onTaskComplete({
      task: completedTask,
      taskQueue: queue,
      queueSnapshot: [],
      runningSnapshot: [],
      completedSnapshot: [],
      resolvedAction: undefined,
    });

    expect(queue.size()).toBe(0);
  });

  it('NEVER fires when a Final Verification already exists in queue (Tier 3/4 primary path)', () => {
    const queue = new TaskQueue<CodeTask>();
    queue.push(finalVerificationTask());
    const completedTask = errorTask();

    const sizeBefore = queue.size();
    onTaskComplete({
      task: completedTask,
      taskQueue: queue,
      queueSnapshot: queue.getAll(),
      runningSnapshot: [],
      completedSnapshot: [],
      resolvedAction: undefined,
    });

    expect(queue.size()).toBe(sizeBefore);
  });

  it('fires with a warn when the SSOT is violated (Tier 3 error task without a following Final Verification)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const queue = new TaskQueue<CodeTask>();
    const completedTask = errorTask();

    onTaskComplete({
      task: completedTask,
      taskQueue: queue,
      queueSnapshot: [],
      runningSnapshot: [],
      completedSnapshot: [],
      resolvedAction: undefined,
    });

    expect(queue.size()).toBe(1);
    expect(queue.getAll()[0].type).toBe('verification');
    const warnCalls = warnSpy.mock.calls.map(c => String(c[0] ?? ''));
    expect(warnCalls.some(msg => /Prompt Violation Fallback/i.test(msg))).toBe(true);
    warnSpy.mockRestore();
  });

  it('is a no-op when the completed task is not an error task', () => {
    const queue = new TaskQueue<CodeTask>();
    const completedTask = featureTask();

    onTaskComplete({
      task: completedTask,
      taskQueue: queue,
      queueSnapshot: [],
      runningSnapshot: [],
      completedSnapshot: [],
      resolvedAction: undefined,
    });

    expect(queue.size()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Error variant prompt — "Run build command … to verify" must be gone
// ─────────────────────────────────────────────────────────────

describe('execute/variants/error/rules.md — prompt/guard contradiction removed', () => {
  const rulesPath = path.join(
    __dirname,
    '..',
    '..',
    'src',
    'core',
    'prompt',
    'templates',
    'jobs',
    'code',
    'nodes',
    'execute',
    'variants',
    'error',
    'rules.md',
  );

  it('does NOT contain the obsolete "Run build command from `diagnostics.command` to verify" directive', () => {
    const content = fs.readFileSync(rulesPath, 'utf8');
    expect(content).not.toMatch(/Run build command from `diagnostics\.command` to verify/i);
  });

  it('still references the Tier-Verification Alignment contract (apply-phase + verify cycle)', () => {
    // Post verify-shared refactor: error/rules.md is uniform across tiers
    // (apply phase only — verify-mode is dispatched at the phase layer
    // through `_shared/verify/`). The prompt instructs the LLM to apply
    // fixes and emit <done>; the verification cycle (Tier 3/4 dedicated
    // task OR Tier 2 self-verify reverify) runs the gates separately.
    // The handlebars `{{#if currentTask.selfVerifyOnDone}}` branch was
    // retired alongside the two-cycle refactor.
    const content = fs.readFileSync(rulesPath, 'utf8');
    expect(content).toMatch(/verification cycle/i);
    expect(content).toMatch(/Apply ALL remediation/i);
    expect(content).toMatch(/Do NOT run `build` \/ `test` \/ `typecheck`/);
  });
});

describe('direct/variants/default/rules.md — base layer partials included', () => {
  const rulesPath = path.join(
    __dirname,
    '..',
    '..',
    'src',
    'core',
    'prompt',
    'templates',
    'jobs',
    'code',
    'nodes',
    'direct',
    'variants',
    'default',
    'rules.md',
  );

  it('includes agents/architect/rules', () => {
    const content = fs.readFileSync(rulesPath, 'utf8');
    expect(content).toMatch(/\{\{>\s*agents\/architect\/rules\s*\}\}/);
  });

  it('includes tool-calling-rules-compact, text-format-compact, secure-coding, persistence-schema-rule', () => {
    const content = fs.readFileSync(rulesPath, 'utf8');
    expect(content).toMatch(/tool-calling-rules-compact/);
    expect(content).toMatch(/text-format-compact/);
    expect(content).toMatch(/secure-coding/);
    expect(content).toMatch(/persistence-schema-rule/);
  });

  it('contains the Tier 0 vs Tier 1 distinction (FPOP)', () => {
    const content = fs.readFileSync(rulesPath, 'utf8');
    expect(content).toMatch(/Tier 0 vs Tier 1 Distinction/);
    expect(content).toMatch(/[Vv]erification-unneeded writes|verification is (truly )?un(needed|necessary)/i);
  });
});

describe('direct/variants/default/base.md — antrules + dep-self-contained included', () => {
  const basePath = path.join(
    __dirname,
    '..',
    '..',
    'src',
    'core',
    'prompt',
    'templates',
    'jobs',
    'code',
    'nodes',
    'direct',
    'variants',
    'default',
    'base.md',
  );

  it('includes the antrules partial (codebase/ANTRULES.md injection)', () => {
    const content = fs.readFileSync(basePath, 'utf8');
    expect(content).toMatch(/\{\{>\s*jobs\/code\/base\/injections\/antrules\s*\}\}/);
  });

  it('includes the dep-self-contained partial', () => {
    const content = fs.readFileSync(basePath, 'utf8');
    expect(content).toMatch(/\{\{>\s*jobs\/code\/base\/injections\/dep-self-contained\s*\}\}/);
  });
});
