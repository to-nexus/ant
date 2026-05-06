/**
 * `_shared/verify/parity` — Service Virtualization Mock↔Real Contract Parity
 * verification (Phase 4 of the `mock_real_symmetry_ssot` plan).
 *
 * Goal: catch silent divergence between the production adapter and its
 * virtualized (mock / fake) twin BEFORE the user swaps the toggle in
 * production. The verification cycle already exercises one side per run;
 * parity adds a structural second pass against the opposite side and
 * compares observable shape.
 *
 * Two-pass orchestration:
 *
 *   1. **Apply pass** — `USE_MOCK_*=true` for every business connection.
 *      Build/test/typecheck must pass. Failure → `parity_apply_failed`
 *      (retryable). This pass is mandatory whenever parity runs because
 *      the virtualized adapter is reachable on every host (no network).
 *   2. **Real pass** — probe each business connection's URL; if any
 *      target is reachable, run the same gate command with
 *      `USE_MOCK_*=false`. If none are reachable, skip with a
 *      `non-retryable warning` (the user is offline / behind a firewall;
 *      this is not an adapter-pair defect). If reachable but the gate
 *      fails → `parity_real_failed` (retryable).
 *   3. **DTO symmetry heuristic** — when both passes ran, scan the second
 *      pass's tail for type-mismatch keywords that did NOT appear in the
 *      first pass (`Expected … got …`, `TypeError`, `not assignable to
 *      type`). Hits → `parity_dto_mismatch` (retryable). This is a
 *      best-effort string heuristic; the typecheck inside each variant
 *      is the structural first line of defence.
 *
 * Activation gates (the orchestrator returns `null` early on any false):
 *
 *   - `state.virtualizationSnapshot?.hasBusinessConnection === true`
 *     (Phase 2 channel — set by the resolve node).
 *   - The shared verify-mode predicate (`isVerifyEntered(state)` for
 *     self-verify Tier 2; verification task type is verify-mode by
 *     definition).
 *   - `state.context?.featurePath` is defined (we cannot spawn without
 *     a workspace root).
 *
 * Wiring:
 *
 *   - `verification` task bundle wires `parityCheckEvaluate` directly on
 *     its `check` slot (verification is verify-mode by definition).
 *   - `composeBundle()` wraps every Tier 2 self-verify task's `check`
 *     slot to call `parityCheckEvaluate` AFTER the apply check, so
 *     `error` / `feature` / `ui` / `setup` bundles inherit parity
 *     automatically.
 *
 * Output: a single `Violation` (or `null`). The violation's `message`
 * carries enough variant detail (output tail, exit codes, probe outcomes)
 * for the next plan cycle to root-cause the divergence — the parity
 * partial in the verify-mode plan prompt teaches the LLM how to read it.
 */

import type { ArchitectGraphState, Violation } from '../../../../state';
import { isVerifyEntered } from '../markVerifyEntered';
import { getTechTier, effectiveTechTier } from '@ant/shared';
import {
  variantSpecFor,
  runVariant,
  type VariantOutcome,
  type VariantSpec,
} from './runVariant';
import { probeReal, type ProbeTarget, type ProbeRealResult } from './probeReal';
import {
  loadBusinessConnectionsFromDisk,
  type ConnectionRecord,
} from './loadConnections';

/** Discovered business connection — caller may inject (tests). */
export type BusinessConnection = ConnectionRecord;

/**
 * Dependency-injection seam for tests. All defaults use the real
 * implementations (`probeReal` + `runVariant` + disk-based connection
 * loader keyed off `state.context.featurePath`).
 */
export interface ParityDeps {
  runVariant: (spec: VariantSpec) => Promise<VariantOutcome>;
  probeReal: (targets: readonly ProbeTarget[]) => Promise<ProbeRealResult>;
  /**
   * Resolve the project's business connections. The default scans
   * `<featurePath>/codebase/.env.example` (and one level of monorepo
   * children) for `# @connection business {name}` annotations — same
   * scan radius used by `buildVirtualizationSnapshot`. Tests inject a
   * fixed list to bypass disk I/O.
   */
  loadBusinessConnections: (
    state: ArchitectGraphState,
  ) => Promise<BusinessConnection[]>;
}

const defaultDeps: ParityDeps = {
  runVariant,
  probeReal,
  loadBusinessConnections: (state) =>
    loadBusinessConnectionsFromDisk(state.context?.featurePath),
};

const DTO_MISMATCH_PATTERNS: ReadonlyArray<RegExp> = [
  /\bExpected\b[^.\n]{0,80}\bgot\b/i,
  /\bTypeError\b/,
  /not assignable to type\b/i,
  /\bproperty\s+'\w+'\s+is\s+missing\b/i,
];

function detectDtoMismatch(applyOutput: string, realOutput: string): string[] {
  const hits: string[] = [];
  for (const pattern of DTO_MISMATCH_PATTERNS) {
    const realMatch = realOutput.match(pattern);
    if (realMatch && !applyOutput.match(pattern)) {
      hits.push(realMatch[0]);
    }
  }
  return hits;
}

function pickPackageManager(state: ArchitectGraphState): string | undefined {
  const taskTiers = state.currentTask?.techTiers;
  const tier = taskTiers?.length ? effectiveTechTier(taskTiers) : getTechTier(state);
  const pm = tier?.packageManager;
  return pm ?? state._detectedPackageManager ?? undefined;
}

function envOverrides(
  connections: BusinessConnection[],
  active: boolean,
): Record<string, string> {
  const value = active ? 'true' : 'false';
  const out: Record<string, string> = { USE_MOCK: value };
  for (const c of connections) {
    out[c.toggleEnvVar] = value;
  }
  return out;
}

function summarizeProbe(result: ProbeRealResult): string {
  if (result.outcomes.length === 0) return 'no probe targets';
  return result.outcomes
    .map((o) => `${o.name} (${o.url}) → ${o.detail}`)
    .join('; ');
}

function summarizeVariant(label: string, outcome: VariantOutcome): string {
  const head = `${label}: exit=${outcome.exitCode ?? 'null'} duration=${outcome.durationMs}ms`;
  const tail = outcome.timedOut
    ? ' [TIMED OUT]'
    : outcome.skippedReason
      ? ` [skipped: ${outcome.skippedReason}]`
      : '';
  return `${head}${tail}`;
}

export interface ParityResult {
  /** Violation to surface to checkTaskStatus, or null when parity passed / skipped silently. */
  violation: Violation | null;
  /**
   * Optional warning text — emitted on stdout only (not retryable). Filled
   * when the real pass was skipped because no production endpoint
   * responded. Surfaces so users see "we did NOT verify the real path".
   */
  warning?: string;
  /** Diagnostic flag set when neither apply nor real produced a violation. */
  passed: boolean;
}

/**
 * Pure orchestration entry point. Tests inject `deps`; production callers
 * use the default `parityCheckEvaluate` adapter below which fixes
 * `deps = defaultDeps`.
 */
export async function parityCheck(
  state: ArchitectGraphState,
  deps: ParityDeps = defaultDeps,
): Promise<ParityResult> {
  if (!state.virtualizationSnapshot?.hasBusinessConnection) {
    return { violation: null, passed: true };
  }
  const featurePath = state.context?.featurePath;
  if (!featurePath) {
    return { violation: null, passed: true };
  }

  const connections = await deps.loadBusinessConnections(state);
  if (connections.length === 0) {
    // virtualizationSnapshot says yes but on-disk scan returned no
    // concrete connections. Happens when annotation grammar drifted or
    // the env file moved between resolve-time scan and parity-time
    // scan. Treat as "no observation" rather than failing the cycle.
    return { violation: null, passed: true };
  }

  const packageManager = pickPackageManager(state);

  // Pass 1 — virtualized variant (USE_MOCK=true).
  const applySpec = variantSpecFor(
    featurePath,
    envOverrides(connections, true),
    packageManager,
  );
  const apply = await deps.runVariant(applySpec);

  if (apply.skippedReason) {
    // No package manager mapping → no observation. Silent skip.
    console.log(`ℹ️ [parity] Apply variant skipped: ${apply.skippedReason}`);
    return { violation: null, passed: true };
  }

  if (!apply.passed) {
    return {
      violation: {
        type: 'parity_apply_failed',
        severity: 'critical',
        isRetryable: true,
        message:
          'Service Virtualization parity check — virtualized variant (USE_MOCK=true) failed.\n' +
          summarizeVariant('apply', apply) +
          `\n--- output (tail) ---\n${apply.output}`,
        suggestedFix:
          'Inspect the virtualized adapter implementation. The mock body MUST satisfy the same TypeScript interface as the production adapter and pass build/typecheck/test under USE_MOCK=true.',
      },
      passed: false,
    };
  }

  // Pass 2 — production variant (USE_MOCK=false), gated by a real probe.
  const probe = await deps.probeReal(
    connections.map((c) => ({ name: c.name, url: c.url })),
  );
  if (probe.noneReachable) {
    return {
      violation: null,
      warning:
        'Service Virtualization parity check — production variant skipped: no business connection responded. ' +
        'Adapter-pair parity was verified for the virtualized side only.\n' +
        `Probe outcomes: ${summarizeProbe(probe)}`,
      passed: true,
    };
  }

  const realSpec = variantSpecFor(
    featurePath,
    envOverrides(connections, false),
    packageManager,
  );
  const real = await deps.runVariant(realSpec);

  if (real.skippedReason) {
    // Same as apply — degrade gracefully.
    console.log(`ℹ️ [parity] Real variant skipped: ${real.skippedReason}`);
    return { violation: null, passed: true };
  }

  if (!real.passed) {
    const dtoHits = detectDtoMismatch(apply.output, real.output);
    if (dtoHits.length > 0) {
      return {
        violation: {
          type: 'parity_dto_mismatch',
          severity: 'critical',
          isRetryable: true,
          message:
            'Service Virtualization parity check — DTO shape divergence between virtualized and production variants.\n' +
            `Mismatch markers (only in production pass): ${dtoHits.join(' | ')}\n` +
            summarizeVariant('apply (USE_MOCK=true)', apply) + ' [passed]\n' +
            summarizeVariant('real (USE_MOCK=false)', real) + '\n' +
            `--- production output (tail) ---\n${real.output}`,
          suggestedFix:
            'Align the virtualized adapter\'s return type with the production adapter\'s observable DTO. Field names, types, optionality, and error mapping MUST be identical — only concrete values may differ.',
        },
        passed: false,
      };
    }
    return {
      violation: {
        type: 'parity_real_failed',
        severity: 'critical',
        isRetryable: true,
        message:
          'Service Virtualization parity check — production variant (USE_MOCK=false) failed while virtualized variant passed.\n' +
          summarizeVariant('apply (USE_MOCK=true)', apply) + ' [passed]\n' +
          summarizeVariant('real (USE_MOCK=false)', real) + '\n' +
          `Probe outcomes: ${summarizeProbe(probe)}\n` +
          `--- production output (tail) ---\n${real.output}`,
        suggestedFix:
          'The production adapter diverges from the virtualized adapter in observable behaviour even though the real endpoint is reachable. Re-check field mapping, error handling, and request/response wiring of the production adapter.',
      },
      passed: false,
    };
  }

  return { violation: null, passed: true };
}

/**
 * `check.evaluate` adapter — wraps `parityCheck` for the TaskCheckHook
 * interface. Only fires in verify-mode (verification task or self-verify
 * Tier 2 after apply→reverify transition). Returns `null` when parity
 * passed, was skipped, or activation gates failed.
 *
 * Warnings emitted via `result.warning` are surfaced to console only —
 * they are NOT returned as violations because non-retryable warnings
 * would short-circuit the retry path through `checkTaskStatus`'s
 * `retryableViolations.length === 0` branch (see Retry Authority SSOT).
 */
export async function parityCheckEvaluate(
  state: ArchitectGraphState,
): Promise<Violation | null> {
  if (!isVerifyEntered(state)) return null;
  const result = await parityCheck(state);
  if (result.warning) {
    console.warn(`⚠️ [parity] ${result.warning}`);
  }
  return result.violation;
}
