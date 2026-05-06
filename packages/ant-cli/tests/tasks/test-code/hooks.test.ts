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
    // test-code batch-split promotion publishes `plan.buildPrompt` and
    // `command.guard`. The plan variant owns test-runner install + feature-
    // slice decision; the command guard rejects install verbs issued by
    // batch-split sub-tasks to prevent lockfile races.
    expect(hooks?.plan?.buildPrompt).toBe(planHook.buildPrompt);
    expect(hooks?.plan?.toolLoopLogTemplate).toBe('jobs/code/nodes/plan/variants/test-code/base');
    // finalizeNudge restates the Format-B decision rule under finalize
    // pressure (sage-blessing-pixel regression: LLM defaulted to Format A
    // when the plan↔tool loop hit PLAN_TOOL_LOOP_MAX).
    expect(hooks?.plan?.finalizeNudge).toBe(planHook.finalizeNudge);
    expect(hooks?.command?.guard).toBe(commandHook.guard);
  });

  it('bundle publishes scheduling + conversations + check + plan + command slots', () => {
    // Slot-level absence — lock parity with ui/design-system precedents
    // so a future drive-by hook addition forces an explicit test update.
    expect(testCodeBundle.decompose).toBeUndefined();
    expect(testCodeBundle.tool).toBeUndefined();
    expect(testCodeBundle.router).toBeUndefined();
    expect(testCodeBundle.orchestrator).toBeUndefined();
    // check.evaluate is published; but budgetExhaustedHint is NOT —
    // generic "Break down the task scope" is correct for test-code.
    expect(testCodeBundle.check?.budgetExhaustedHint).toBeUndefined();
    // plan.buildPrompt is published (test-code variant); extraTemplateVars
    // is not — the variant template has a self-contained var set.
    expect(testCodeBundle.plan?.extraTemplateVars).toBeUndefined();
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

describe('tasks/test-code/hooks/plan.finalizeNudge', () => {
  // Restored per-type finalize nudge (a71234c2 had collapsed all task types
  // onto the task-type-blind FINALIZE_NUDGE; sage-blessing-pixel showed
  // that the test-code parent then defaults to Format A under finalize
  // pressure even when multiple disjoint module groupings were observed,
  // collapsing the parallel sub-task fan-out).
  it('reinforces the Format-B decision rule', () => {
    const body = planHook.finalizeNudge();
    // MUST tell the LLM that disjoint groupings → Format B is required.
    expect(body).toMatch(/Format B/);
    expect(body).toMatch(/disjoint/i);
    expect(body).toMatch(/MUST/);
    // MUST also keep the stop-tools instruction so the LLM does not loop.
    expect(body).toMatch(/Stop calling tools|Do NOT call|Stop reading/i);
    // Must produce a `<plan>` block (single-output requirement).
    expect(body).toMatch(/<plan>/);
  });

  it('names the failure mode as a blind-spot reminder (FPOP "Reminders for Blind Spots")', () => {
    const body = planHook.finalizeNudge();
    expect(body).toMatch(/Blind spot/i);
    // Specifically calls out "defaulting to Format A under pressure".
    expect(body).toMatch(/Format A/);
  });

  it('stays platform-/framework-/language-agnostic (FPOP + ant-prompt rule 3)', () => {
    const body = planHook.finalizeNudge();
    // Project-specific examples from the regression must not leak in.
    expect(body).not.toMatch(/\b(domain|infrastructure|application|features?)\/\w/);
    // Framework / language names from AGENTS.md §3 forbidden list.
    expect(body).not.toMatch(/\b(React|Next\.?js|Tailwind|TypeScript|JavaScript|Python|Go|Java)\b/);
    // No hard file-count thresholds either — the prompt template owns
    // those, the nudge only restates the decision principle.
    expect(body).not.toMatch(/\b(8|9|15)\s*(test\s*)?files?\b/);
  });
});

describe('templates/jobs/code/nodes/(plan|execute)/variants/test-code — Test Script wiring SSOT', () => {
  // Defense for the test-script wiring SSOT split:
  //   - parent plan phase OWNS manifest test-run entry wiring (Step 2.5)
  //   - execute variant must NOT carry a duplicate `## Test Script` section
  //     that would (a) be visible to batch-split sub-tasks (where manifest
  //     edits are forbidden — lockfile race) and (b) duplicate the parent
  //     plan's responsibility (MECE violation).
  // Regression scenario: Format-B parent installs the runner but no phase
  // wires `scripts.test`, causing verification's first cycle to fail with
  // "Missing script: test" and burn retry budget on a one-line fix.
  const planBase = path.join(
    __dirname,
    '../../../src/core/prompt/templates/jobs/code/nodes/plan/variants/test-code/base.md',
  );
  const executeBase = path.join(
    __dirname,
    '../../../src/core/prompt/templates/jobs/code/nodes/execute/variants/test-code/base.md',
  );

  it('plan base template carries Step 2.5 — Wire Test-Run Entry block', () => {
    const text = fs.readFileSync(planBase, 'utf8');
    expect(text).toMatch(/Step 2\.5\s*[—\-]\s*Wire Test-Run Entry/);
    // Responsibility framing — owner is the parent plan phase, not sub-tasks.
    expect(text).toMatch(/parent plan phase['’]?s? exclusive responsibility/i);
    // Tool boundary — manifest wiring uses edit_file, not run_command.
    expect(text).toMatch(/Use `edit_file`/);
  });

  it('plan base template still forbids application source modification (constraint preserved)', () => {
    const text = fs.readFileSync(planBase, 'utf8');
    expect(text).toMatch(/Do NOT modify application source code/);
    // The exception MUST be named explicitly so LLM cannot read the
    // constraint as banning the new Step 2.5 wiring edit.
    expect(text).toMatch(/single permitted manifest-write exception/i);
  });

  it('plan base template warns that wiring must NOT enter the batches[] payload', () => {
    const text = fs.readFileSync(planBase, 'utf8');
    expect(text).toMatch(/Do NOT include the manifest in any `batches\[\]`/);
  });

  it('plan base template carries the install-vs-entry blind-spot reminder', () => {
    const text = fs.readFileSync(planBase, 'utf8');
    expect(text).toMatch(/Installing the runner alone is not sufficient/i);
  });

  it('execute base template no longer carries a `## Test Script` section', () => {
    const text = fs.readFileSync(executeBase, 'utf8');
    expect(text).not.toMatch(/^## Test Script\s*$/m);
    // Also no leftover checkpoint row pointing to the deleted section.
    expect(text).not.toMatch(/\*\*Test script\*\*\s*\|\s*Does the project config/);
  });

  it('execute base template preserves the sub-task manifest-edit prohibition (lockfile race defence)', () => {
    const text = fs.readFileSync(executeBase, 'utf8');
    // The prePlanText (sub-task) branch MUST keep its strict manifest list
    // — that is the OTHER half of the MECE split with the plan-phase wiring.
    expect(text).toMatch(/Do NOT modify `package\.json`/);
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
