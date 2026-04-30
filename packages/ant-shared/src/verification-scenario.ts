/**
 * Verification Scenario Harness — shared types.
 *
 * These types are the contract between the scenario fixture files
 * (packages/ant-cli/tests/verification-scenarios/scenarios/Sxx/*.json)
 * and the runtime runner (to be added in packages/ant-cli/scripts).
 * They are defined in @ant/shared so future tooling (UI, CLI, evaluator)
 * can depend on a single schema.
 *
 * Full design: docs/testing/verification-scenarios.md
 */

import type { TaskType } from './task';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Execution mode — F10 solution
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Three-way switch that controls how commands behave inside a scenario run.
 *
 * | Mode    | Real cmd? | Inject applied? | Intended use |
 * |---------|-----------|-----------------|--------------|
 * | real    | yes       | no              | Regression against real tool-chain (tsc, pnpm, jest) |
 * | overlay | yes       | yes             | Deterministic stderr needed for downstream branches (e.g. _lastPlanHash repeat) |
 * | stub    | no        | yes             | State-driven branches where stderr content does not matter |
 *
 * Guard rails the runner enforces (see docs):
 *   - `real` + inject.json present → error (prevents hidden stubs)
 *   - `stub`  + real error fixture → warn (real bug may be masked)
 */
export type ScenarioMode = 'real' | 'overlay' | 'stub';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Command injection rules — mirrors utils/commandInject.ts wire format.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface ScenarioCommandInjectRule {
  /** Regex pattern (string form) matched against each command the tool node runs. */
  pattern: string;
  /** Exit code to report (defaults to 0 when omitted). */
  exitCode?: number;
  /** stdout text appended (overlay) or returned (stub). */
  stdout?: string;
  /** stderr text appended (overlay) or returned (stub). */
  stderr?: string;
  /** Human-readable tag surfaced in runner logs. */
  tag?: string;
}

export interface ScenarioCommandInjectFile {
  rules: ScenarioCommandInjectRule[];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Session seed schema — frontmatter for L2 fixture entry state.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Minimal shape of a verification / error task seeded into the queue.
 *
 * Decision (F8): `TaskStatus` has no 'error' value — task failure is expressed
 * through `violations` and the `verification` snapshot, not task status. Seed
 * always uses `status: 'todo'`.
 */
export interface ScenarioSeedTask {
  id: string;
  name: string;
  type: TaskType;
  priority: number;
  status: 'todo';
  description?: string;
  /**
   * Pre-built planText from a previous batch split. When present, the plan
   * node skips diagnostic generation entirely (plan bypass — F1 solution).
   */
  prePlanText?: string;
}

/**
 * Persisted verification-cycle state. Mirrors `VerificationSnapshot`
 * (tasks/verification/model/snapshot.ts) but declared here so `@ant/shared`
 * stays decoupled from the cli-internal gate union. Seed files use `string`
 * for gate names to avoid importing the Gate type at the @ant/shared layer.
 */
export interface ScenarioVerificationSnapshot {
  required: string[];
  passed: string[];
  attempts: number;
  planHistoryHashes: string[];
  depHash?: string;
  installNeeded?: boolean;
  batchSplitCount?: number;
}

/**
 * Subset of ArchitectGraphState seeded on disk at session.seed.json.
 *
 * This is deliberately a loose shape — the runner writes it verbatim into
 * `sessions/architect/code.json` and the plan node's resolve path then
 * hydrates the full state. Unknown fields are passed through.
 *
 * Post-T4b-β: verification cycle state is carried by the `verification`
 * snapshot only. The legacy `_verificationTracker` / `_verificationAttempts`
 * / `_appliedPlanHistory` / `_depFileHash` / `_installNeeded` fields were
 * removed alongside their ArchitectGraphState counterparts.
 */
export interface ScenarioSessionSeed {
  taskQueue: ScenarioSeedTask[];
  currentTask: null;
  completedTasks: string[];
  retries: number;
  maxRetries: number;

  /**
   * Optional verification snapshot. When omitted, the plan node's
   * `initSession` hook populates a fresh session from the runtime
   * environment (detected TypeScript project + presence of test files).
   * When seeded with an empty `required` array, the hook hydrates only
   * the gate set while preserving `attempts` / history metadata — used
   * by the budget-exhausted scenarios (S05).
   */
  verification?: ScenarioVerificationSnapshot;

  recursionCount?: number;
  recursionLimit?: number;

  /**
   * Optional pre-populated interruption record. When omitted, the runner
   * injects a default `user_stopped` interruption so the resume detection
   * in runCodeGraph fires.
   */
  interruption?: {
    reason: string;
    message?: string;
    timestamp?: string;
    canResume?: boolean;
    metadata?: Record<string, unknown>;
  };

  [key: string]: unknown;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Expected outcome — what the runner diffs against the final session state.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Assertion expressed as "a task of {type} must appear in the queue and its
 * prePlanText must contain {prePlanTextIncludes}".
 *
 * `_batchSplitCount` is resolved against
 * `task.resumeState.verification.batchSplitCount` (post-T4b-β). For
 * scenarios authored during the coexistence window the runner also
 * accepts the legacy `task._batchSplitCount` field so existing seeds do
 * not need re-migrating; new seeds should express the assertion against
 * the Session snapshot.
 */
export interface ScenarioExpectedQueueTask {
  type: TaskType;
  prePlanTextIncludes?: string;
  _batchSplitCount?: number;
}

export interface ScenarioExpectedOutcome {
  /**
   * Ordered list of node names visited during the run. May contain a prefix
   * subset of the actual sequence; use '*' as a wildcard for any node.
   */
  routeSequence?: string[];
  /**
   * Tasks that must be present in the final queue (superset-match:
   * extra queue entries are allowed unless `exact: true`).
   */
  taskQueueAfterSplit?: ScenarioExpectedQueueTask[];
  /** State flags that must have been set true at some point during the run. */
  flagSet?: string[];
  /**
   * Violation types that must have been raised (superset-match).
   * Example: ['verification_incomplete'] for S08.
   */
  violations?: string[];
  /** When true, queue contents must match exactly (length + types + order). */
  exact?: boolean;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Top-level scenario descriptor.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface ScenarioConfig {
  /** Human-readable name, must match the directory prefix (e.g. `multi-file-build-errors-split`). */
  name: string;
  /** One-line description for --list output. */
  description?: string;
  /** Execution mode — see ScenarioMode for semantics. */
  mode: ScenarioMode;
  /**
   * Optional upper bound on total runtime (milliseconds). The runner aborts
   * and marks the scenario failed when exceeded. Defaults to 60_000.
   */
  timeoutMs?: number;
  /**
   * Expected child-process exit behaviour. Separates "intended throw" (e.g.
   * retries-exhausted in S09) from "accidental crash" so the runner can
   * distinguish them.
   *
   *   - `0`        — child must exit 0 (normal completion)
   *   - `'nonzero'` — child must exit non-zero (e.g. plan node throws when
   *                   `retries >= maxRetries`)
   *   - `'any'`    — either exit code acceptable (default; back-compat with
   *                   scenarios that assert only on session state)
   */
  expectedChildExitCode?: 0 | 'nonzero' | 'any';
  /**
   * Optional environment overrides passed to the child process. Only a small
   * allow-list of keys (e.g. `RECURSION_LIMIT`) is honoured — arbitrary keys
   * are ignored so scenarios cannot leak infrastructure toggles like
   * `ANT_REDIS_URL`.
   */
  env?: Record<string, string>;
  /** Expectations the runner checks after the job terminates. */
  expected: ScenarioExpectedOutcome;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Runner output — stable shape so CI / evaluators can parse results.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface ScenarioRunResult {
  scenarioId: string;
  name: string;
  passed: boolean;
  durationMs: number;
  runDir: string;
  /** Observed route sequence for debugging when `expected.routeSequence` fails. */
  observedRouteSequence?: string[];
  /** Human-readable diff when the run fails. */
  diffSummary?: string;
  /** Non-fatal warnings — kept alongside pass=true (e.g. stub mode advised warn). */
  warnings?: string[];
}
