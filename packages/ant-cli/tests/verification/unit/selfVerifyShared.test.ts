/**
 * Self-verify shared infrastructure regression tests.
 *
 * Locks the contract introduced by the verify-shared refactor:
 *
 *   - Tier 2 self-verify task (error/feature/ui/setup with
 *     `selfVerifyOnDone:true`) routes through the same `_shared/verify/`
 *     hook surface as a Tier 3/4 dedicated verification task once it
 *     enters verify-mode (`state._verifyEntered === true`).
 *   - The `<done>` arm of `executeRouter` flips `_verifyEntered=true` for
 *     self-verify tasks via the single-writer `markVerifyEntered` helper.
 *   - The composed bundle's `check.evaluate` returns the verify-mode
 *     `verification_incomplete` violation when gates remain unsatisfied
 *     after `<done>` — this is the silent-bug guard for the
 *     `onyx-building-fence` incident.
 *   - Apply-phase budget exhaustion uses the generic hint; verify-phase
 *     uses the verification hint (only when the bundle has wired it
 *     statically — composeBundle does NOT default it).
 *   - explain task (Tier 2 with `selfVerifyOnDone:false`) does NOT enter
 *     verify-mode.
 *
 * Jurisdiction guard:
 *
 *   - rg-style assertion that no caller mutates `_verifyEntered` outside
 *     `markVerifyEntered`/`resetVerifyEntered`.
 *   - rg-style assertion that the legacy `tasks/verification/model/*`
 *     paths and `self-verify-inline.md` partial no longer exist.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

import {
  composeBundle,
  requiresVerification,
  isVerifyEntered,
  markVerifyEntered,
  resetVerifyEntered,
  VerificationSession,
} from '../../../src/agents/architect/graph/code/tasks/_shared/verify';
import { evaluate as verifyEvaluate } from '../../../src/agents/architect/graph/code/tasks/_shared/verify/checkEvaluate';
import { routeAfterDone as verifyRouteAfterDone } from '../../../src/agents/architect/graph/code/tasks/_shared/verify/router';
import { hooks as errorHooks } from '../../../src/agents/architect/graph/code/tasks/error';
import { hooks as featureHooks } from '../../../src/agents/architect/graph/code/tasks/feature';
import { hooks as uiHooks } from '../../../src/agents/architect/graph/code/tasks/ui';
import { hooks as setupHooks } from '../../../src/agents/architect/graph/code/tasks/setup';
import { hooks as verificationHooks } from '../../../src/agents/architect/graph/code/tasks/verification';

import type { ArchitectGraphState } from '../../../src/agents/architect/graph/code/state';
import type { CodeTask } from '../../../src/agents/architect/types/task';

// ────────────────────────────────────────────────────────────────────────────
// requiresVerification predicate — Tier-Verification Alignment SSOT
// ────────────────────────────────────────────────────────────────────────────

describe('requiresVerification predicate', () => {
  it('verification task type → true', () => {
    expect(requiresVerification({ type: 'verification' })).toBe(true);
  });

  it('priority >= FINAL_VERIFICATION (1000) → true (defensive)', () => {
    expect(requiresVerification({ priority: 1000 })).toBe(true);
  });

  it('selfVerifyOnDone:true → true (Tier 2 self-verify)', () => {
    expect(requiresVerification({ type: 'error', selfVerifyOnDone: true })).toBe(true);
    expect(requiresVerification({ type: 'feature', selfVerifyOnDone: true })).toBe(true);
    expect(requiresVerification({ type: 'ui', selfVerifyOnDone: true })).toBe(true);
    expect(requiresVerification({ type: 'setup', selfVerifyOnDone: true })).toBe(true);
  });

  it('Tier 3+ task (no selfVerifyOnDone) → false', () => {
    expect(requiresVerification({ type: 'error' })).toBe(false);
    expect(requiresVerification({ type: 'feature' })).toBe(false);
    expect(requiresVerification({ type: 'ui' })).toBe(false);
    expect(requiresVerification({ type: 'setup' })).toBe(false);
  });

  it('explain task (Tier 2 with selfVerifyOnDone:false) → false', () => {
    expect(requiresVerification({ type: 'explain', selfVerifyOnDone: false })).toBe(false);
  });

  it('null/undefined task → false', () => {
    expect(requiresVerification(null)).toBe(false);
    expect(requiresVerification(undefined)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// _verifyEntered channel — single-writer SSOT
// ────────────────────────────────────────────────────────────────────────────

describe('_verifyEntered channel — single writer via markVerifyEntered', () => {
  function makeState(overrides: Partial<ArchitectGraphState> = {}): ArchitectGraphState {
    return {
      _verifyEntered: false,
      ...overrides,
    } as ArchitectGraphState;
  }

  it('isVerifyEntered defaults to false when channel is undefined', () => {
    const state = {} as ArchitectGraphState;
    expect(isVerifyEntered(state)).toBe(false);
  });

  it('markVerifyEntered flips channel to true', () => {
    const state = makeState();
    expect(isVerifyEntered(state)).toBe(false);
    markVerifyEntered(state);
    expect(isVerifyEntered(state)).toBe(true);
  });

  it('markVerifyEntered is idempotent', () => {
    const state = makeState();
    markVerifyEntered(state);
    markVerifyEntered(state);
    markVerifyEntered(state);
    expect(isVerifyEntered(state)).toBe(true);
  });

  it('resetVerifyEntered flips channel back to false (task boundary)', () => {
    const state = makeState();
    markVerifyEntered(state);
    expect(isVerifyEntered(state)).toBe(true);
    resetVerifyEntered(state);
    expect(isVerifyEntered(state)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// composeBundle — verify-mode dispatch surface across all 4 self-verify task types
// ────────────────────────────────────────────────────────────────────────────

describe('composeBundle — verify-mode dispatch wires the same hooks for every task type', () => {
  const bundles = [
    { name: 'error', hooks: errorHooks },
    { name: 'feature', hooks: featureHooks },
    { name: 'ui', hooks: uiHooks },
    { name: 'setup', hooks: setupHooks },
  ];

  for (const { name, hooks } of bundles) {
    describe(`tasks/${name}`, () => {
      it(`exposes function-shaped verify-mode dispatch slots`, () => {
        expect(typeof hooks.plan?.initSession).toBe('function');
        expect(typeof hooks.plan?.checkRetryTermination).toBe('function');
        expect(typeof hooks.command?.guard).toBe('function');
        expect(typeof hooks.check?.evaluate).toBe('function');
        expect(typeof hooks.tool?.onEvent).toBe('function');
        expect(typeof hooks.router?.routeAfterDone).toBe('function');
        expect(typeof hooks.orchestrator?.hasOwnAttemptCounter).toBe('function');
        expect(typeof hooks.orchestrator?.attemptCount).toBe('function');
        expect(typeof hooks.orchestrator?.restoreIntoWorkerState).toBe('function');
      });

      it(`hasOwnAttemptCounter(task) routes apply-vs-verify based on requiresVerification`, () => {
        const tier3Task: CodeTask = { id: 't1', type: name, name: 't1', priority: 100 } as any;
        const tier2SelfVerifyTask: CodeTask = {
          id: 't2',
          type: name,
          name: 't2',
          priority: 100,
          selfVerifyOnDone: true,
        } as any;
        const fn = hooks.orchestrator?.hasOwnAttemptCounter as any;
        expect(fn(tier3Task)).toBe(false);
        expect(fn(tier2SelfVerifyTask)).toBe(true);
      });
    });
  }

  it('verification task bundle uses static hasOwnAttemptCounter:true (always owns Session)', () => {
    expect(verificationHooks.orchestrator?.hasOwnAttemptCounter).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// check.evaluate — Tier 2 silent-bug guard (onyx-building-fence)
// ────────────────────────────────────────────────────────────────────────────

describe('check.evaluate — Tier 2 self-verify silent-bug guard', () => {
  function makeVerifyState(opts: {
    isComplete: boolean;
    verifyEntered: boolean;
  }): ArchitectGraphState {
    const session = VerificationSession.createFresh({ isTs: true, hasTests: true });
    if (opts.isComplete) {
      session.onCommand('typecheck', true);
      session.onCommand('build', true);
      session.onCommand('test', true);
    }
    return {
      _verifyEntered: opts.verifyEntered,
      verification: session,
      currentTask: {
        id: 'sv-error-1',
        type: 'error',
        name: 'Self-verify error task',
        priority: 100,
        selfVerifyOnDone: true,
      },
    } as ArchitectGraphState;
  }

  it('returns verification_incomplete when verify-mode is active and gates are unsatisfied', async () => {
    const state = makeVerifyState({ isComplete: false, verifyEntered: true });
    // The Tier 2 self-verify error task: composeBundle's check.evaluate
    // dispatches to verify-mode evaluate when `_verifyEntered === true`.
    const violation = await errorHooks.check?.evaluate?.(state);
    expect(violation).not.toBeNull();
    expect(violation?.type).toBe('verification_incomplete');
    expect(violation?.severity).toBe('critical');
    expect(violation?.isRetryable).toBe(true);
  });

  it('returns null when all required gates have passed', async () => {
    const state = makeVerifyState({ isComplete: true, verifyEntered: true });
    const violation = await errorHooks.check?.evaluate?.(state);
    expect(violation).toBeNull();
  });

  it('returns null in apply phase (verify-mode not yet entered) — apply has no check', async () => {
    const state = makeVerifyState({ isComplete: false, verifyEntered: false });
    const violation = await errorHooks.check?.evaluate?.(state);
    expect(violation).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// routeAfterDone — apply→reverify transition
// ────────────────────────────────────────────────────────────────────────────

describe('routeAfterDone — apply→reverify transition for Tier 2 self-verify', () => {
  it('returns "plan" when files were modified + no Session yet (first reverify entry)', () => {
    const state = {
      planText: 'remediation plan body',
      _executeModifiedFiles: true,
      verification: undefined,
      currentTask: { id: 't', type: 'error', selfVerifyOnDone: true } as any,
    } as ArchitectGraphState;
    expect(verifyRouteAfterDone(state)).toBe('plan');
  });

  it('returns "checkTaskStatus" when no plan (apply phase had nothing to do)', () => {
    const state = {
      planText: '',
      _executeModifiedFiles: false,
      verification: undefined,
      currentTask: { id: 't', type: 'error', selfVerifyOnDone: true } as any,
    } as ArchitectGraphState;
    expect(verifyRouteAfterDone(state)).toBe('checkTaskStatus');
  });

  it('returns "checkTaskStatus" when no files modified', () => {
    const state = {
      planText: 'remediation plan',
      _executeModifiedFiles: false,
      verification: undefined,
      currentTask: { id: 't', type: 'error', selfVerifyOnDone: true } as any,
    } as ArchitectGraphState;
    expect(verifyRouteAfterDone(state)).toBe('checkTaskStatus');
  });

  it('returns "checkTaskStatus" when session already complete (verify-mode finished)', () => {
    const session = VerificationSession.createFresh({ isTs: true, hasTests: true });
    session.onCommand('typecheck', true);
    session.onCommand('build', true);
    session.onCommand('test', true);
    const state = {
      planText: 'reverify plan',
      _executeModifiedFiles: true,
      verification: session,
      currentTask: { id: 't', type: 'error', selfVerifyOnDone: true } as any,
    } as ArchitectGraphState;
    expect(verifyRouteAfterDone(state)).toBe('checkTaskStatus');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Jurisdiction guards — `_verifyEntered` writer SSOT + legacy path retirement
// ────────────────────────────────────────────────────────────────────────────

const SRC_ROOT = resolve(__dirname, '../../../src');

function* walkFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walkFiles(full);
    else if (st.isFile() && (entry.endsWith('.ts') || entry.endsWith('.tsx'))) yield full;
  }
}

describe('jurisdiction guard — `_verifyEntered` channel single writer', () => {
  it('only `markVerifyEntered.ts` and `checkTaskStatus/index.ts` mutate `_verifyEntered`', () => {
    // Acceptable mutators:
    //   - markVerifyEntered.ts (the helper itself)
    //   - checkTaskStatus/index.ts (task-boundary reset)
    //   - graph.ts (channel default declaration via Annotation)
    //   - state.ts (interface declaration)
    const ALLOWED = new Set([
      resolve(SRC_ROOT, 'agents/architect/graph/code/tasks/_shared/verify/markVerifyEntered.ts'),
      resolve(SRC_ROOT, 'agents/architect/graph/code/nodes/checkTaskStatus/index.ts'),
      resolve(SRC_ROOT, 'agents/architect/graph/code/graph.ts'),
      resolve(SRC_ROOT, 'agents/architect/graph/code/state.ts'),
    ]);
    const offenders: string[] = [];
    const writePattern = /\bstate\._verifyEntered\s*=|_verifyEntered\s*:\s*(true|false)\b/;
    for (const file of walkFiles(SRC_ROOT)) {
      const content = readFileSync(file, 'utf8');
      if (writePattern.test(content) && !ALLOWED.has(file)) {
        offenders.push(file.replace(SRC_ROOT, '<src>'));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('jurisdiction guard — legacy verification paths fully retired', () => {
  it('tasks/verification/model/{Session,gates,snapshot,planHash,errors,configSnapshot}.ts files do NOT exist', () => {
    const verifModel = resolve(
      SRC_ROOT,
      'agents/architect/graph/code/tasks/verification/model',
    );
    const ghosts = ['Session.ts', 'gates.ts', 'snapshot.ts', 'planHash.ts', 'errors.ts', 'configSnapshot.ts'];
    for (const ghost of ghosts) {
      expect(existsSync(join(verifModel, ghost))).toBe(false);
    }
    // `is.ts` is the verification task type's identifier and stays.
    expect(existsSync(join(verifModel, 'is.ts'))).toBe(true);
  });

  it('tasks/verification/hooks/{plan,execute,command,check,router,orchestrator,tool}.ts files do NOT exist', () => {
    const verifHooks = resolve(
      SRC_ROOT,
      'agents/architect/graph/code/tasks/verification/hooks',
    );
    const ghosts = ['plan.ts', 'execute.ts', 'command.ts', 'check.ts', 'router.ts', 'orchestrator.ts', 'tool.ts'];
    for (const ghost of ghosts) {
      expect(existsSync(join(verifHooks, ghost))).toBe(false);
    }
    // `decompose.ts` and `conversations.ts` are verification-task-only
    // hooks (always-exclusive flag + `node:execute:verification:<id>`
    // conversation key) — they stay in the verification bundle.
    expect(existsSync(join(verifHooks, 'decompose.ts'))).toBe(true);
    expect(existsSync(join(verifHooks, 'conversations.ts'))).toBe(true);
  });

  it('execute/injections/self-verify-inline.md no longer exists', () => {
    const partial = resolve(
      SRC_ROOT,
      'core/prompt/templates/jobs/code/nodes/execute/injections/self-verify-inline.md',
    );
    expect(existsSync(partial)).toBe(false);
  });

  it('no source file imports from `tasks/verification/model/*` (use _shared/verify/* instead)', () => {
    const offenders: string[] = [];
    // Match any import path that resolves into tasks/verification/model/{Session|gates|snapshot|planHash|errors|configSnapshot}.
    // The retained `model/is.ts` is allowed — exclude it explicitly.
    const importPattern = /from\s+['"][^'"]*tasks\/verification\/model\/(?!is)([A-Za-z]+)['"]/;
    for (const file of walkFiles(SRC_ROOT)) {
      const content = readFileSync(file, 'utf8');
      if (importPattern.test(content)) {
        offenders.push(file.replace(SRC_ROOT, '<src>'));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no source file imports from `tasks/verification/hooks/{plan,execute,command,check,router,orchestrator,tool}` (use _shared/verify/* instead)', () => {
    const offenders: string[] = [];
    const importPattern = /from\s+['"][^'"]*tasks\/verification\/hooks\/(plan|execute|command|check|router|orchestrator|tool)['"]/;
    for (const file of walkFiles(SRC_ROOT)) {
      const content = readFileSync(file, 'utf8');
      if (importPattern.test(content)) {
        offenders.push(file.replace(SRC_ROOT, '<src>'));
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Direct verify-mode evaluate sanity check (independent of composeBundle wiring)
// ────────────────────────────────────────────────────────────────────────────

describe('verifyEvaluate — direct usage', () => {
  it('returns null when state.verification is undefined (apply-phase / non-verify task)', () => {
    const state = { verification: undefined } as ArchitectGraphState;
    expect(verifyEvaluate(state)).toBeNull();
  });

  it('returns null when session is complete', () => {
    const session = VerificationSession.createFresh({ isTs: true, hasTests: false });
    session.onCommand('typecheck', true);
    session.onCommand('build', true);
    const state = { verification: session, commandHistory: [] } as unknown as ArchitectGraphState;
    expect(verifyEvaluate(state)).toBeNull();
  });

  it('returns verification_incomplete with first-missing-gate detail', () => {
    const session = VerificationSession.createFresh({ isTs: true, hasTests: true });
    // No gates passed.
    const state = { verification: session, commandHistory: [] } as unknown as ArchitectGraphState;
    const violation = verifyEvaluate(state);
    expect(violation).not.toBeNull();
    expect(violation?.type).toBe('verification_incomplete');
    expect(violation?.message).toMatch(/Type check|tsc/i);
  });
});
