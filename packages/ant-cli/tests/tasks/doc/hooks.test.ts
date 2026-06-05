/**
 * L2 — `tasks/doc/hooks/*` adapter invariants.
 *
 * Locks the contract for T6 call-site flips:
 *   - scheduling.preDocBarrier  — true (block while `blocksDoc` producers
 *                                  setup / feature / test-code run)
 *   - conversations.convKey     — `node:execute:doc:<id>`
 *   - registry entry            — `hooksForTaskType('doc')` returns the bundle
 *
 * Doc is a barrier sink only: it consumes `preDocBarrier` and MUST NOT
 * publish any producer flag. In particular `blocksDoc=undefined` is a
 * deliberate regression guard — self-activation would make sibling doc
 * tasks block each other from parallel scheduling. The scheduling
 * assertions below lock this invariant at the slot level.
 */

import { describe, it, expect } from 'vitest';

import {
  preDocBarrier,
  classify as schedClassify,
} from '../../../src/agents/architect/graph/code/tasks/doc/hooks/scheduling';
import * as convHook from '../../../src/agents/architect/graph/code/tasks/doc/hooks/conversations';
import { hooks as docBundle } from '../../../src/agents/architect/graph/code/tasks/doc';
import { hooksForTaskType } from '../../../src/agents/architect/graph/code/tasks/_shared/registry';

import type { CodeTask } from '../../../src/agents/architect/types/task';

function task(id: string, overrides: Partial<CodeTask> = {}): CodeTask {
  return {
    id,
    name: id,
    type: 'doc',
    priority: 450,
    description: `task ${id}`,
    ...overrides,
  } as CodeTask;
}

describe('tasks/_shared/registry — doc entry', () => {
  it('returns the doc bundle', () => {
    const hooks = hooksForTaskType('doc');
    expect(hooks).toBe(docBundle);
    expect(hooks?.scheduling?.preDocBarrier).toBe(true);
    expect(hooks?.conversations?.convKey).toBe(convHook.convKey);
  });

  it('bundle publishes scheduling + conversations + execute + plan(dispatch-only) slots', () => {
    // Slot-level inventory — mirrors the ui / test-code precedents so a
    // future drive-by hook addition forces an explicit test update
    // (and forces the author to justify it in index.ts).
    //
    // `plan` carries ONLY the R1 dispatch flags (`requiresPlanText` /
    // `usesToolLoop` / `skipPlanRunExecute`) — the SSOT replacement for the
    // legacy `isDocTask(task)` predicate inside
    // `nodes/plan/llm/requiresPlan.ts`. No buildPrompt / extraTemplateVars
    // / variant template, since doc still flows through the generic
    // plan base path. `skipPlanRunExecute` tells `outcome/finalize.ts` that
    // doc's empty plan body is NOT a no-op completion — execute (docgen)
    // must still run to write the docs.
    expect(docBundle.plan).toEqual({
      requiresPlanText: false,
      usesToolLoop: false,
      skipPlanRunExecute: true,
    });
    expect(docBundle.decompose).toBeUndefined();
    expect(docBundle.check).toBeUndefined();
    expect(docBundle.tool).toBeUndefined();
    expect(docBundle.command).toBeUndefined();
    expect(docBundle.router).toBeUndefined();
    expect(docBundle.orchestrator).toBeUndefined();
  });

  it('scheduling exposes only the doc consumer flag — no other consumer or producer flags', () => {
    // Consumer flags: only preDocBarrier.
    expect(docBundle.scheduling?.preDocBarrier).toBe(true);
    expect(docBundle.scheduling?.preUiBarrier).toBeUndefined();
    expect(docBundle.scheduling?.preTestgenBarrier).toBeUndefined();
    expect(docBundle.scheduling?.preIntegrationBarrier).toBeUndefined();
    // Producer flags: ALL undefined. Doc is a barrier sink only; it
    // must NEVER activate a barrier for other task types. In particular
    // blocksDoc=undefined is a deliberate regression guard — a doc
    // task that produces the doc barrier would block sibling doc tasks
    // from parallel scheduling (self-blocking).
    expect(docBundle.scheduling?.blocksUi).toBeUndefined();
    expect(docBundle.scheduling?.blocksTestgen).toBeUndefined();
    expect(docBundle.scheduling?.blocksDoc).toBeUndefined();
    expect(docBundle.scheduling?.blocksIntegration).toBeUndefined();
    // classify — priority-band classifier. Dual-role: design-job tasks
    // all carry `type: 'doc'` and use priority bands (100–199 tokens,
    // 200–299 assets) to drive the `hasPreAssetsWork` /
    // `hasPreSpecWork` barriers. Code-job doc tasks at priority 800
    // fall outside both bands and the classifier returns `false`
    // cleanly.
    expect(typeof docBundle.scheduling?.classify).toBe('function');
  });
});

describe('tasks/doc/hooks/scheduling', () => {
  it('preDocBarrier — true', () => {
    expect(preDocBarrier).toBe(true);
  });

  describe('classify — dual-role (design-job tokens/assets + code-job doc@800 inert)', () => {
    it('priority 100–199 ⇒ isTokens (design-job tokens band)', () => {
      expect(schedClassify(task('tokens-100', { priority: 100 }))).toEqual({
        isTokens: true,
        isFoundation: false,
      });
      expect(schedClassify(task('tokens-150', { priority: 150 }))).toEqual({
        isTokens: true,
        isFoundation: false,
      });
      expect(schedClassify(task('tokens-199', { priority: 199 }))).toEqual({
        isTokens: true,
        isFoundation: false,
      });
    });

    it('priority 200–299 ⇒ isFoundation (design-job assets band)', () => {
      expect(schedClassify(task('assets-200', { priority: 200 }))).toEqual({
        isTokens: false,
        isFoundation: true,
      });
      expect(schedClassify(task('assets-299', { priority: 299 }))).toEqual({
        isTokens: false,
        isFoundation: true,
      });
    });

    it('code-job doc@800 ⇒ no classify flags set (inert)', () => {
      expect(schedClassify(task('doc-800', { priority: 800 }))).toEqual({
        isTokens: false,
        isFoundation: false,
      });
    });

    it('priority < 100 ⇒ no flags (design-job emits priority >= 100)', () => {
      expect(schedClassify(task('low', { priority: 50 }))).toEqual({
        isTokens: false,
        isFoundation: false,
      });
    });
  });
});

describe('tasks/doc/hooks/conversations', () => {
  it('convKey — task-id-scoped', () => {
    expect(convHook.convKey(task('d1'))).toBe('node:execute:doc:d1');
    expect(convHook.convKey(task('readme'))).toBe('node:execute:doc:readme');
  });
});
