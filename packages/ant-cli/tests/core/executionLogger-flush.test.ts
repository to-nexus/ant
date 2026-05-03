/**
 * Regression test — vast-curling-perch C-3
 *
 * **What this guards**
 *
 * `ExecutionLogger.appendEvent` queues writes through a per-instance
 * `writeQueue` Promise chain. Phase code (`route_decision` /
 * `plan_finalize` / `batch_split` / `tool_call` / etc.) fires events
 * non-blocking via `void logger.logXxx(...).catch(...)`.
 *
 * In the original incident every fire site used a **dynamic** import
 * (`import('...').then(({ getExecutionLogger }) => ...)`). The dynamic
 * import deferred the actual `appendEvent` call across multiple
 * micro-tasks, so `writeQueue` was NEVER updated synchronously at the
 * call site. When the worker exited (graceful drain, SIGTERM, or the
 * orchestrator clearing the logger) before the dynamic import resolved,
 * the event was lost without trace and the cycle-2 verification
 * snapshot's `debug/logs/` directory stayed empty.
 *
 * The fix removes every dynamic import in favour of a static one, so
 * `getExecutionLogger().log...()` updates `writeQueue` synchronously and
 * `flushExecutionLogger(jobId)` is guaranteed to drain every queued
 * event regardless of process exit timing.
 *
 * These tests verify the contract the fix relies on — the writeQueue
 * IS in fact updated synchronously, `flush()` does drain it, and
 * concurrent fire-and-forget calls all reach disk.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  ExecutionLogger,
  flushExecutionLogger,
  flushAllExecutionLoggers,
  getExecutionLogger,
  clearExecutionLogger,
} from '../../src/core/utils/executionLogger';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'execlog-flush-'));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function readLogFile(jobId: string): Promise<any[]> {
  const logPath = path.join(
    tmpRoot,
    'sessions',
    'architect',
    'debug',
    'logs',
    `log-${jobId}.json`,
  );
  const raw = await fs.readFile(logPath, 'utf-8');
  return JSON.parse(raw) as any[];
}

describe('ExecutionLogger — vast-curling-perch C-3 fix', () => {
  it('synchronously updates writeQueue at the call site (root cause guard)', async () => {
    const jobId = 'sync-queue-test';
    const logger = getExecutionLogger({
      featurePath: tmpRoot,
      jobId,
      jobType: 'code',
    });

    // Fire-and-forget: drop the returned promise on the floor (matches
    // every phase-code call site after the fix).
    void logger.logRouteDecision('task-1', {
      router: 'routeAfterDone',
      decision: 'plan',
      inputs: { step: 4 },
    });

    // Drain via the public flush API. If the queue had NOT been
    // updated synchronously (e.g. behind a dynamic import), this
    // flush would resolve before the event reaches disk and the file
    // would not exist.
    await flushExecutionLogger(jobId);

    const events = await readLogFile(jobId);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('route_decision');
    expect(events[0].data.decision).toBe('plan');

    await clearExecutionLogger(jobId);
  });

  it('flush drains many concurrent fire-and-forget events in order', async () => {
    const jobId = 'concurrent-flush-test';
    const logger = getExecutionLogger({
      featurePath: tmpRoot,
      jobId,
      jobType: 'code',
    });

    const N = 25;
    for (let i = 0; i < N; i++) {
      void logger.log('batch_split', { seq: i, action: 'created' }, `task-${i}`);
    }

    await flushExecutionLogger(jobId);

    const events = await readLogFile(jobId);
    expect(events).toHaveLength(N);
    // Per-event ordering is preserved by the writeQueue chain.
    for (let i = 0; i < N; i++) {
      expect(events[i].data.seq).toBe(i);
      expect(events[i].taskId).toBe(`task-${i}`);
    }

    await clearExecutionLogger(jobId);
  });

  it('flushAllExecutionLoggers drains every active logger', async () => {
    const ids = ['job-a', 'job-b', 'job-c'];
    for (const id of ids) {
      const logger = getExecutionLogger({
        featurePath: tmpRoot,
        jobId: id,
        jobType: 'code',
      });
      void logger.log('plan_finalize', { jobId: id, decision: 'done' }, `t-${id}`);
    }

    await flushAllExecutionLoggers();

    for (const id of ids) {
      const events = await readLogFile(id);
      expect(events).toHaveLength(1);
      expect(events[0].data.jobId).toBe(id);
    }

    for (const id of ids) {
      await clearExecutionLogger(id);
    }
  });

  it('flushExecutionLogger is a safe no-op for unknown jobIds', async () => {
    await expect(
      flushExecutionLogger('never-instantiated-job'),
    ).resolves.toBeUndefined();
  });

  it('flush survives an appendEvent error and still drains subsequent writes', async () => {
    const jobId = 'flush-after-error';
    const logger = new ExecutionLogger({
      featurePath: tmpRoot,
      jobId,
      jobType: 'code',
    });

    // Force the writeQueue to absorb one rejected appendEvent. Inject
    // a JSON value that cannot be serialized (BigInt) — `JSON.stringify`
    // throws inside `appendEvent`, exercising the queue's catch arm.
    void logger.log('thinking_only', { bad: BigInt(1) as any });
    void logger.log('thinking_only', { good: true });

    await logger.flush();

    // Only the good event lands. The bad call was caught by `log()`'s
    // try/catch (it never even hit the queue).
    const events = await readLogFile(jobId);
    expect(events).toHaveLength(1);
    expect(events[0].data.good).toBe(true);
  });
});

describe('design graph executionLogger fire pattern contract', () => {
  const targetFiles = [
    path.join(__dirname, '..', '..', 'src', 'agents', 'architect', 'graph', 'design', 'graph.ts'),
    path.join(__dirname, '..', '..', 'src', 'agents', 'architect', 'graph', 'design', 'parallel', 'workerGraph.ts'),
    path.join(__dirname, '..', '..', 'src', 'agents', 'architect', 'graph', 'design', 'nodes', 'plan', 'index.ts'),
    path.join(__dirname, '..', '..', 'src', 'agents', 'architect', 'graph', 'design', 'nodes', 'plan', 'dispatchOnly.ts'),
    path.join(__dirname, '..', '..', 'src', 'agents', 'architect', 'graph', 'design', 'nodes', 'learn', 'index.ts'),
  ];

  const dynamicImportPattern = /await\s+import\((['"`])[^'"`]*core\/utils\/executionLogger\1\)/;
  const importThenPattern = /import\((['"`])[^'"`]*core\/utils\/executionLogger\1\)\.then/;
  const requirePattern = /require\((['"`])[^'"`]*core\/utils\/executionLogger\1\)/;

  it.each(targetFiles)('does not use dynamic executionLogger import in %s', async (filePath) => {
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).not.toMatch(dynamicImportPattern);
    expect(content).not.toMatch(importThenPattern);
    expect(content).not.toMatch(requirePattern);
  });
});
