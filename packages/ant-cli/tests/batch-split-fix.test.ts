/**
 * Simulation tests for code job defect fixes:
 * 1. Fix 1: verification task must NOT appear in completedTasks after batch split
 * 2. Fix 2: test-code task without test files triggers a violation
 * 3. Fix 3: detectTestFilesFromDisk scans disk (not stale RAG context)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─── Fix 1: Batch-split state machine simulation ───────────────────────────

describe('Fix 1: batch split does not mark verification as done', () => {
  /**
   * Simulates the key interaction:
   *   workerCheckTaskStatus returns _batchSplitCompleted:true
   *   → TaskWorker calls reportBatchSplit (not reportCompletion)
   *   → verification NOT added to completedTasks
   */

  type MockTask = { id: string; name: string; type: string; priority: number; completed?: boolean };

  function makeOrchestrator() {
    const completedTasks: MockTask[] = [];
    const runningTasks = new Map<number, MockTask>();

    const orchestrator = {
      completedTasks,
      runningTasks,

      reportCompletion(workerId: number, task: MockTask) {
        runningTasks.delete(workerId);
        task.completed = true;
        completedTasks.push(task);
      },

      reportBatchSplit(workerId: number, _task: MockTask) {
        // Does NOT add to completedTasks — task is re-enqueued
        runningTasks.delete(workerId);
      },

      reportFailure(workerId: number, task: MockTask, _err: Error) {
        runningTasks.delete(workerId);
      },
    };

    return orchestrator;
  }

  /**
   * Simulates TaskWorker.run() decision logic (lines 78-95 of TaskWorker.ts)
   */
  function workerDecide(
    orchestrator: ReturnType<typeof makeOrchestrator>,
    workerId: number,
    task: MockTask,
    graphResult: Record<string, unknown>,
  ) {
    const batchSplit = graphResult._batchSplitCompleted === true;
    const hasUnresolvedViolations =
      graphResult._taskCompleted !== true &&
      !batchSplit &&
      Array.isArray(graphResult.violations) &&
      (graphResult.violations as unknown[]).length > 0;

    if (batchSplit) {
      orchestrator.reportBatchSplit(workerId, task);
    } else if (hasUnresolvedViolations) {
      orchestrator.reportFailure(workerId, task, new Error('violation'));
    } else {
      orchestrator.reportCompletion(workerId, task);
    }
  }

  it('OLD behavior: _taskCompleted:true from batch split incorrectly calls reportCompletion', () => {
    const orch = makeOrchestrator();
    const verificationTask: MockTask = { id: 'v1', name: 'Build Verification', type: 'verification', priority: 1000 };
    orch.runningTasks.set(0, verificationTask);

    // Simulate OLD workerCheckTaskStatus batch-split return
    const oldGraphResult = {
      _taskCompleted: true,   // ← the bug
      violations: [],
    };

    // OLD decision logic (before fix)
    const batchSplit = false; // old code had no _batchSplitCompleted check
    const hasUnresolvedViolations = oldGraphResult._taskCompleted !== true && oldGraphResult.violations.length > 0;
    if (hasUnresolvedViolations) {
      orch.reportFailure(0, verificationTask, new Error('violation'));
    } else {
      orch.reportCompletion(0, verificationTask); // ← gets called for batch split (BUG)
    }

    // BUG: verification ends up in completedTasks (done) even though it was just re-enqueued
    expect(orch.completedTasks).toContain(verificationTask);
    expect(orch.completedTasks.length).toBe(1);
  });

  it('NEW behavior: _batchSplitCompleted:true calls reportBatchSplit, NOT reportCompletion', () => {
    const orch = makeOrchestrator();
    const verificationTask: MockTask = { id: 'v1', name: 'Build Verification', type: 'verification', priority: 1000 };
    orch.runningTasks.set(0, verificationTask);

    // Simulate NEW workerCheckTaskStatus batch-split return
    const newGraphResult = {
      _taskCompleted: false,      // ← fixed: not completed
      _batchSplitCompleted: true, // ← new flag
      violations: [],
    };

    workerDecide(orch, 0, verificationTask, newGraphResult);

    // FIXED: verification NOT in completedTasks (stays in todo via queue)
    expect(orch.completedTasks).not.toContain(verificationTask);
    expect(orch.completedTasks.length).toBe(0);
    // Worker slot released
    expect(orch.runningTasks.has(0)).toBe(false);
  });

  it('normal task completion still calls reportCompletion', () => {
    const orch = makeOrchestrator();
    const featureTask: MockTask = { id: 'f1', name: 'Feature A', type: 'feature', priority: 100 };
    orch.runningTasks.set(1, featureTask);

    const normalResult = { _taskCompleted: true, violations: [] };
    workerDecide(orch, 1, featureTask, normalResult);

    expect(orch.completedTasks).toContain(featureTask);
    expect(orch.completedTasks.length).toBe(1);
  });

  it('task with violations calls reportFailure, not reportCompletion', () => {
    const orch = makeOrchestrator();
    const failTask: MockTask = { id: 'f2', name: 'Failed Task', type: 'feature', priority: 100 };
    orch.runningTasks.set(2, failTask);

    const violationResult = {
      _taskCompleted: false,
      _batchSplitCompleted: false,
      violations: [{ type: 'incomplete_implementation' }],
    };
    workerDecide(orch, 2, failTask, violationResult);

    expect(orch.completedTasks).not.toContain(failTask);
    expect(orch.completedTasks.length).toBe(0);
  });

  it('multiple batch splits accumulate verifications only once each in done', () => {
    // Simulate the full session: 3 batch splits, each adds verification to queue,
    // finally one verification completes successfully.
    const orch = makeOrchestrator();
    const verTask: MockTask = { id: 'v1', name: 'Build Verification', type: 'verification', priority: 1000 };
    let batchSplitCount = 0;

    // Cycle 1: batch split
    orch.runningTasks.set(0, verTask);
    workerDecide(orch, 0, verTask, { _taskCompleted: false, _batchSplitCompleted: true, violations: [] });
    batchSplitCount++;

    // Cycle 2: batch split
    orch.runningTasks.set(0, verTask);
    workerDecide(orch, 0, verTask, { _taskCompleted: false, _batchSplitCompleted: true, violations: [] });
    batchSplitCount++;

    // Cycle 3: success
    orch.runningTasks.set(0, verTask);
    workerDecide(orch, 0, verTask, { _taskCompleted: true, violations: [] });

    expect(batchSplitCount).toBe(2);
    // Verification appears in done EXACTLY once (final successful completion)
    const verInDone = orch.completedTasks.filter(t => t.id === 'v1');
    expect(verInDone.length).toBe(1);
  });
});

// ─── Fix 2 + Fix 3: detectTestFilesFromDisk ───────────────────────────────

describe('Fix 3: detectTestFilesFromDisk scans filesystem', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-test-'));
    fs.mkdirSync(path.join(tmpDir, 'codebase'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeFs(files: string[]) {
    for (const f of files) {
      const fullPath = path.join(tmpDir, 'codebase', f);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, '// test');
    }
  }

  it('returns false when codebase has no test files', async () => {
    const { detectTestFilesFromDisk } = await import(
      '../src/agents/architect/graph/code/nodes/plan/testFileDetector'
    );
    makeFs(['src/index.ts', 'src/utils.ts']);
    expect(detectTestFilesFromDisk(tmpDir)).toBe(false);
  });

  it('returns true for *.test.ts files', async () => {
    const { detectTestFilesFromDisk } = await import(
      '../src/agents/architect/graph/code/nodes/plan/testFileDetector'
    );
    makeFs(['src/utils.test.ts']);
    expect(detectTestFilesFromDisk(tmpDir)).toBe(true);
  });

  it('returns true for *.spec.ts files in nested directories', async () => {
    const { detectTestFilesFromDisk } = await import(
      '../src/agents/architect/graph/code/nodes/plan/testFileDetector'
    );
    makeFs(['features/trading/model/calculations.spec.ts']);
    expect(detectTestFilesFromDisk(tmpDir)).toBe(true);
  });

  it('returns true for *.test.js files', async () => {
    const { detectTestFilesFromDisk } = await import(
      '../src/agents/architect/graph/code/nodes/plan/testFileDetector'
    );
    makeFs(['src/helper.test.js']);
    expect(detectTestFilesFromDisk(tmpDir)).toBe(true);
  });

  it('skips node_modules', async () => {
    const { detectTestFilesFromDisk } = await import(
      '../src/agents/architect/graph/code/nodes/plan/testFileDetector'
    );
    makeFs(['node_modules/vitest/index.test.ts', 'src/index.ts']);
    expect(detectTestFilesFromDisk(tmpDir)).toBe(false);
  });

  it('returns false when featurePath is undefined', async () => {
    const { detectTestFilesFromDisk } = await import(
      '../src/agents/architect/graph/code/nodes/plan/testFileDetector'
    );
    expect(detectTestFilesFromDisk(undefined)).toBe(false);
  });

  it('returns false when codebase directory does not exist', async () => {
    const { detectTestFilesFromDisk } = await import(
      '../src/agents/architect/graph/code/nodes/plan/testFileDetector'
    );
    expect(detectTestFilesFromDisk('/nonexistent/path')).toBe(false);
  });

  it('existing detectTestFiles(RAG) misses files written during job execution', async () => {
    // PROOF: RAG context was loaded at job start (no test files).
    // detectTestFiles returns false. But detectTestFilesFromDisk finds the file.
    const { detectTestFiles, detectTestFilesFromDisk } = await import(
      '../src/agents/architect/graph/code/nodes/plan/testFileDetector'
    );

    const staleRagContext = {
      filePaths: ['src/index.ts', 'src/utils.ts'],  // test files not in RAG snapshot
      directoryTree: undefined,
    };

    // Simulate: test files were written to disk DURING the job
    makeFs(['src/utils.test.ts']);

    // OLD approach (stale): misses test files → testsRequired = false (BUG)
    expect(detectTestFiles(staleRagContext as any)).toBe(false);

    // NEW approach (disk scan): finds test files → testsRequired = true (FIXED)
    expect(detectTestFilesFromDisk(tmpDir)).toBe(true);
  });
});
