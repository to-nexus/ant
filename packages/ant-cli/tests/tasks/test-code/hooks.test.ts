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
import * as planHook from '../../../src/agents/architect/graph/code/tasks/test-code/hooks/plan';
import * as commandHook from '../../../src/agents/architect/graph/code/tasks/test-code/hooks/command';
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
    // test-code is NON-forking: it rides the shared plan/execute templates,
    // so it publishes `plan.extraTemplateVars` (type-specific vars) NOT
    // `plan.buildPrompt`, and NO `toolLoopLogTemplate`. The command guard is
    // preserved — it rejects install verbs issued by batch-split sub-tasks to
    // prevent lockfile races.
    expect(hooks?.plan?.buildPrompt).toBeUndefined();
    expect(hooks?.plan?.extraTemplateVars).toBe(planHook.extraTemplateVars);
    expect(hooks?.plan?.toolLoopLogTemplate).toBeUndefined();
    expect(hooks?.command?.guard).toBe(commandHook.guard);
  });

  it('bundle publishes scheduling + conversations + check + plan + command slots', () => {
    // Slot-level absence — lock parity with ui/design-system precedents
    // so a future drive-by hook addition forces an explicit test update.
    expect(testCodeBundle.decompose).toBeUndefined();
    expect(testCodeBundle.tool).toBeUndefined();
    expect(testCodeBundle.router).toBeUndefined();
    expect(testCodeBundle.orchestrator).toBeUndefined();
    // check.evaluate is published; but noDoneSignalHint is NOT —
    // generic "Break down the task scope" is correct for test-code.
    expect(testCodeBundle.check?.noDoneSignalHint).toBeUndefined();
    // NON-forking: extraTemplateVars is published; buildPrompt is NOT —
    // test-code composes the shared `jobs/code/nodes/plan/base` template
    // (like ui/design-system) and only contributes type-specific vars.
    expect(testCodeBundle.plan?.buildPrompt).toBeUndefined();
    expect(testCodeBundle.plan?.extraTemplateVars).toBe(planHook.extraTemplateVars);
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

describe('tasks/test-code/hooks/command.guard', () => {
  // The guard fires only on batch-split sub-tasks (prePlanText present).
  // Parent test-code tasks legitimately install the test runner during
  // their plan phase, so passing `currentTaskHasPrePlanText=false`
  // (equivalent to no prePlanText) must let every command through.
  function subCtx(overrides: Record<string, unknown> = {}): any {
    return {
      activePhase: 'execute',
      currentTaskType: 'test-code',
      currentTaskHasPrePlanText: true,
      fileSystem: undefined,
      chatStatus: undefined,
      workingDir: '/tmp',
      ...overrides,
    };
  }

  function parentCtx(overrides: Record<string, unknown> = {}): any {
    return subCtx({ currentTaskHasPrePlanText: undefined, ...overrides });
  }

  it('blocks npm install on sub-tasks', () => {
    const result = commandHook.guard(subCtx(), { command: 'npm install vitest' });
    expect(result?.content).toMatch(/\[Policy\]/);
    expect(result?.content).toMatch(/BLOCKED/);
    expect(result?.content).toMatch(/parent test-code/i);
    expect(result?.error).toBeUndefined();
  });

  it('blocks every package-manager install verb on sub-tasks', () => {
    const verbs = [
      'npm install',
      'npm i',
      'npm ci',
      'npm add lodash',
      'pnpm install',
      'pnpm add vitest',
      'pnpm i',
      'yarn install',
      'yarn add vitest',
      'pip install pytest',
      'pip3 install pytest',
      'poetry add pytest',
      'poetry install',
      'bundle install',
      'cargo add serde',
      'cargo install cargo-edit',
      'go get github.com/stretchr/testify',
    ];
    for (const cmd of verbs) {
      const result = commandHook.guard(subCtx(), { command: cmd });
      expect(result?.content, `should block: ${cmd}`).toMatch(/\[Policy\]/);
      expect(result?.content, `should block: ${cmd}`).toMatch(/BLOCKED/);
    }
  });

  it('rejection carries a commandExecuted side-effect with exitCode -1', () => {
    const result = commandHook.guard(subCtx(), { command: 'pnpm add vitest' });
    expect(result?.sideEffects).toEqual([
      expect.objectContaining({ type: 'commandExecuted', exitCode: -1, success: false }),
    ]);
  });

  it('allows read-only / test-writing commands on sub-tasks', () => {
    // The guard is scoped narrowly to install-class verbs; file-write,
    // inspection, and test-running commands are either handled by other
    // layers (file tools) or by the cross-task Go build policy in
    // codeCommandPolicy.
    expect(commandHook.guard(subCtx(), { command: 'ls src/' })).toBeNull();
    expect(commandHook.guard(subCtx(), { command: 'cat tsconfig.json' })).toBeNull();
    expect(commandHook.guard(subCtx(), { command: 'pnpm why vitest' })).toBeNull();
    expect(commandHook.guard(subCtx(), { command: 'mkdir -p src/__tests__' })).toBeNull();
  });

  it('parent test-code tasks (no prePlanText) may install — guard returns null', () => {
    // Parents are allowed to install; they own this responsibility
    // exclusively (see plan variant). Running install at the parent
    // level serializes naturally because the parent holds the
    // preTestgenBarrier slot before any sub-task exists.
    expect(commandHook.guard(parentCtx(), { command: 'pnpm add -D vitest @types/node' })).toBeNull();
    expect(commandHook.guard(parentCtx(), { command: 'npm install jest' })).toBeNull();
    expect(commandHook.guard(parentCtx(), { command: 'pip install pytest' })).toBeNull();
  });

  it('parent test-code tasks also pass through non-install commands', () => {
    expect(commandHook.guard(parentCtx(), { command: 'cat package.json' })).toBeNull();
    expect(commandHook.guard(parentCtx(), { command: 'ls src/' })).toBeNull();
    expect(commandHook.guard(parentCtx(), { command: 'npx vitest --version' })).toBeNull();
  });

  it('install-like substrings in unrelated commands are not blocked', () => {
    // The guard uses word-boundary anchored patterns, so paths or script
    // names that contain "install" as a substring (e.g. `./scripts/install-deps.sh`
    // has `install` but no subcommand) do not accidentally trigger the block.
    expect(commandHook.guard(subCtx(), { command: 'ls install' })).toBeNull();
    expect(commandHook.guard(subCtx(), { command: 'echo "install me"' })).toBeNull();
  });

  it('blocks any verification gate command (verifies declared) on parent and sub-tasks', () => {
    // Test-code tasks generate test files only — running typecheck /
    // build / test belongs to the dedicated verification task. The
    // gate-classification SSOT is the LLM's `verifies` declaration; if
    // it is set, the guard rejects regardless of phase or sub/parent
    // distinction. See `docs/tmp/gate-classification-postmortem.md`.
    for (const verifies of ['typecheck', 'build', 'test'] as const) {
      const sub = commandHook.guard(subCtx(), { command: 'whatever', verifies });
      expect(sub?.content).toMatch(/\[Policy\]/);
      expect(sub?.content).toMatch(/test-code tasks/i);
      const parent = commandHook.guard(parentCtx(), { command: 'whatever', verifies });
      expect(parent?.content).toMatch(/\[Policy\]/);
    }
  });
});

describe('templates test-code overlays (non-forking) — Test Script wiring SSOT', () => {
  // After the non-forking conversion the test-code-specific content lives in
  // gated overlay partials, NOT in self-contained variant templates:
  //   - plan: `nodes/plan/injections/test-code-protocol.md`
  //   - execute: `nodes/execute/injections/test-code-task.md`
  // Invariants preserved across the move:
  //   - parent plan phase OWNS manifest test-run entry wiring (Step 2.5)
  //   - the manifest must never enter a batch slice
  //   - sub-tasks (prePlanText) are forbidden from editing the manifest
  //     (lockfile race) — the OTHER half of the MECE split.
  const planOverlay = path.join(
    __dirname,
    '../../../src/core/prompt/templates/jobs/code/nodes/plan/injections/test-code-protocol.md',
  );
  const executeOverlay = path.join(
    __dirname,
    '../../../src/core/prompt/templates/jobs/code/nodes/execute/injections/test-code-task.md',
  );

  it('plan overlay carries the Step 2.5 — Wire test-run entry block (parent-owned)', () => {
    const text = fs.readFileSync(planOverlay, 'utf8');
    expect(text).toMatch(/Step 2\.5\s*[—\-]\s*Wire the test-run entry/i);
    // Parent-owned framing.
    expect(text).toMatch(/belong to the parent/i);
    // Tool boundary — manifest wiring uses edit_file, not run_command.
    expect(text).toMatch(/`edit_file`/);
    expect(text).toMatch(/not via `run_command`/);
  });

  it('plan overlay carries the install-vs-entry blind-spot reminder', () => {
    const text = fs.readFileSync(planOverlay, 'utf8');
    expect(text).toMatch(/Installing the runner is not sufficient/i);
  });

  it('plan overlay forbids placing a manifest / shared config into a slice', () => {
    const text = fs.readFileSync(planOverlay, 'utf8');
    expect(text).toMatch(/Never place a dependency manifest or shared test config/i);
  });

  it('plan overlay sub-task branch tells the child to author its own implementation (slim-shape)', () => {
    const text = fs.readFileSync(planOverlay, 'utf8');
    // slim-shape: the parent declares the boundary; the child authors impl.
    expect(text).toMatch(/Author your own `implementation`/i);
    // and must NOT install / edit the manifest.
    expect(text).toMatch(/Do NOT propose installing/i);
  });

  it('execute overlay preserves the sub-task manifest-edit prohibition (lockfile race defence)', () => {
    const text = fs.readFileSync(executeOverlay, 'utf8');
    // The prePlanText (sub-task) branch keeps the manifest-edit prohibition.
    expect(text).toMatch(/Do NOT modify any dependency manifest/i);
    expect(text).toMatch(/`package\.json`/);
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
