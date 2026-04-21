/**
 * Verification Scenario — diff engine.
 *
 * Evaluates a {@link ScenarioExpectedOutcome} against the observed output of a
 * child run:
 *   - `observedRouteSequence` comes from `ANT_VERIFICATION_TRACE_FILE`.
 *   - `finalSession` is the parsed `sessions/architect/code.json` after the
 *     child process exits.
 *
 * Every assertion returns a list of human-readable failure strings — the
 * runner aggregates them into a single `diffSummary` field of
 * `ScenarioRunResult`. An empty list means pass.
 *
 * Design constraints (see docs/testing/verification-scenarios.md §3):
 *   - `routeSequence` is a prefix-subset with `'*'` wildcard.
 *   - `taskQueueAfterSplit` is superset-match unless `exact: true`.
 *   - `flagSet` consults the trace file *and* the final session, since most
 *     transient flags (_batchSplitRequeued etc.) are true-at-some-point
 *     signals that may be cleared before the session is written back.
 */

import type {
  ScenarioExpectedOutcome,
  ScenarioExpectedQueueTask,
} from '@ant/shared';
import type { TraceEntry } from '../../../src/utils/verificationTrace';

export interface DiffInput {
  expected: ScenarioExpectedOutcome;
  observedRoute: string[];
  finalSession: any;
  trace: TraceEntry[];
}

export interface DiffResult {
  passed: boolean;
  failures: string[];
}

export function assertExpectedOutcome(input: DiffInput): DiffResult {
  const failures: string[] = [];

  if (input.expected.routeSequence) {
    failures.push(...checkRouteSequence(input.expected.routeSequence, input.observedRoute));
  }

  if (input.expected.taskQueueAfterSplit) {
    failures.push(...checkTaskQueue(
      input.expected.taskQueueAfterSplit,
      input.finalSession?.state?.taskQueue ?? [],
      input.expected.exact === true,
    ));
  }

  if (input.expected.flagSet) {
    failures.push(...checkFlagSet(input.expected.flagSet, input.finalSession, input.trace));
  }

  if (input.expected.violations) {
    failures.push(...checkViolations(input.expected.violations, input.finalSession, input.trace));
  }

  return { passed: failures.length === 0, failures };
}

/**
 * Check that `expected` appears as a (possibly non-contiguous) prefix inside
 * `observed`, allowing `'*'` to match any single node. We require the nodes
 * to appear in order, but tolerate extra nodes in between — this matches
 * the semantics documented in the design doc ("prefix subset").
 */
function checkRouteSequence(expected: string[], observed: string[]): string[] {
  let obsIdx = 0;
  for (const exp of expected) {
    let matched = false;
    while (obsIdx < observed.length) {
      const cur = observed[obsIdx++];
      if (exp === '*' || cur === exp) { matched = true; break; }
    }
    if (!matched) {
      return [`routeSequence mismatch: expected "${exp}" not found after index ${obsIdx} in observed [${observed.join(', ')}]`];
    }
  }
  return [];
}

function checkTaskQueue(
  expected: ScenarioExpectedQueueTask[],
  actual: any[],
  exact: boolean,
): string[] {
  const failures: string[] = [];

  if (exact) {
    if (expected.length !== actual.length) {
      failures.push(`taskQueue length mismatch (exact=true): expected ${expected.length}, got ${actual.length}`);
    }
    const n = Math.min(expected.length, actual.length);
    for (let i = 0; i < n; i++) {
      const exp = expected[i];
      const act = actual[i];
      failures.push(...checkOneTask(`[${i}]`, exp, act));
    }
    return failures;
  }

  // Superset match: for each expected task, find at least one matching entry.
  const remaining = [...actual];
  expected.forEach((exp, i) => {
    const matchIdx = remaining.findIndex(task => oneTaskMatches(exp, task));
    if (matchIdx === -1) {
      failures.push(`taskQueue missing expected[${i}]: type=${exp.type}${exp.prePlanTextIncludes ? `, prePlanText⊃"${exp.prePlanTextIncludes}"` : ''}`);
    } else {
      remaining.splice(matchIdx, 1);
    }
  });
  return failures;
}

/**
 * Reads the batch-split cycle count from wherever it legitimately lives
 * post-T4b-β. The counter moved off `CodeTask._batchSplitCount` into the
 * `VerificationSession` snapshot that rides on `resumeState.verification`.
 * Falls back to the legacy task-field only so scenarios authored during
 * the coexistence window keep working; current seeds never populate it.
 */
function readBatchSplitCount(task: any): number {
  const fromSnapshot = task?.resumeState?.verification?.batchSplitCount;
  if (typeof fromSnapshot === 'number') return fromSnapshot;
  const fromTask = task?._batchSplitCount;
  if (typeof fromTask === 'number') return fromTask;
  return 0;
}

function oneTaskMatches(exp: ScenarioExpectedQueueTask, act: any): boolean {
  if (!act || act.type !== exp.type) return false;
  if (exp.prePlanTextIncludes) {
    const text = (act.prePlanText ?? '') as string;
    if (!text.includes(exp.prePlanTextIncludes)) return false;
  }
  if (exp._batchSplitCount !== undefined) {
    if (readBatchSplitCount(act) !== exp._batchSplitCount) return false;
  }
  return true;
}

function checkOneTask(label: string, exp: ScenarioExpectedQueueTask, act: any): string[] {
  const failures: string[] = [];
  if (!act) { failures.push(`task${label} missing`); return failures; }
  if (act.type !== exp.type) {
    failures.push(`task${label}.type: expected ${exp.type}, got ${act.type}`);
  }
  if (exp.prePlanTextIncludes && !((act.prePlanText ?? '') as string).includes(exp.prePlanTextIncludes)) {
    failures.push(`task${label}.prePlanText does not include "${exp.prePlanTextIncludes}"`);
  }
  if (exp._batchSplitCount !== undefined) {
    const actCount = readBatchSplitCount(act);
    if (actCount !== exp._batchSplitCount) {
      failures.push(`task${label}._batchSplitCount: expected ${exp._batchSplitCount}, got ${actCount}`);
    }
  }
  return failures;
}

function checkFlagSet(flagNames: string[], session: any, trace: TraceEntry[]): string[] {
  const failures: string[] = [];
  const state = session?.state ?? {};
  const traceFlagSet = new Set<string>();
  for (const entry of trace) {
    const extras = (entry.extra ?? {}) as Record<string, unknown>;
    if (Array.isArray(extras.flagSet)) {
      for (const f of extras.flagSet) if (typeof f === 'string') traceFlagSet.add(f);
    }
  }
  for (const name of flagNames) {
    const fromSession = Boolean(state[name]);
    const fromTrace = traceFlagSet.has(name);
    if (!fromSession && !fromTrace) {
      failures.push(`flag "${name}" was never set true (neither in final session nor trace)`);
    }
  }
  return failures;
}

function checkViolations(expectedTypes: string[], session: any, trace: TraceEntry[]): string[] {
  const seen = new Set<string>();
  const stateViolations = session?.state?.violations ?? session?.state?.lastViolations ?? [];
  if (Array.isArray(stateViolations)) {
    for (const v of stateViolations) {
      if (v && typeof v.type === 'string') seen.add(v.type);
    }
  }
  // Trace may carry violation info via execute/enforce nodes (extra.violations)
  for (const entry of trace) {
    const extras = (entry.extra ?? {}) as Record<string, unknown>;
    if (Array.isArray(extras.violations)) {
      for (const v of extras.violations) {
        if (v && typeof (v as any).type === 'string') seen.add((v as any).type as string);
      }
    }
  }
  const failures: string[] = [];
  for (const t of expectedTypes) {
    if (!seen.has(t)) failures.push(`expected violation type "${t}" was never raised`);
  }
  return failures;
}
