/**
 * Service Virtualization Mock↔Real Contract Parity verification — Phase 4
 * regression guard for `tasks/_shared/verify/parity/`.
 *
 * 6 case truth table (per plan §7.4):
 *
 *   1. virtualizationSnapshot empty            → parityCheck skip
 *   2. business connection, real unreachable   → apply pass + skip + warning
 *   3. business connection, real reachable     → both passes pass → done
 *   4. apply variant fails                     → parity_apply_failed (retryable)
 *   5. real variant fails                      → parity_real_failed (retryable)
 *   6. real failure with DTO mismatch markers  → parity_dto_mismatch (retryable)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parityCheck,
  parityCheckEvaluate,
  type ParityDeps,
  type BusinessConnection,
} from '../../src/agents/architect/graph/code/tasks/_shared/verify/parity';
import type { ArchitectGraphState } from '../../src/agents/architect/graph/code/state';

const SAMPLE_CONNECTION: BusinessConnection = {
  name: 'stripe-api',
  toggleEnvVar: 'USE_MOCK_STRIPE_API',
  url: 'https://api.stripe.example/health',
};

function makeState(overrides: Partial<ArchitectGraphState> = {}): ArchitectGraphState {
  return {
    currentTask: { id: 't1', name: 'verify', type: 'verification', priority: 1000 },
    context: { featurePath: '/tmp/ant-feature' },
    virtualizationSnapshot: { hasBusinessConnection: true },
    _verifyEntered: true,
    ...overrides,
  } as unknown as ArchitectGraphState;
}

function makeDeps(overrides: Partial<ParityDeps> = {}): ParityDeps {
  return {
    runVariant: vi.fn(async () => ({
      passed: true,
      output: '',
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    })),
    probeReal: vi.fn(async () => ({
      outcomes: [
        { name: SAMPLE_CONNECTION.name, url: SAMPLE_CONNECTION.url, reachable: true, detail: 'HEAD → 200' },
      ],
      allReachable: true,
      noneReachable: false,
    })),
    loadBusinessConnections: vi.fn(async () => [SAMPLE_CONNECTION]),
    ...overrides,
  };
}

describe('parityCheck — 6 case truth table', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('case 1: virtualizationSnapshot empty → skip (no violation, passed)', async () => {
    const state = makeState({ virtualizationSnapshot: undefined } as any);
    const deps = makeDeps();
    const result = await parityCheck(state, deps);
    expect(result.violation).toBeNull();
    expect(result.passed).toBe(true);
    // None of the heavy work should have fired.
    expect(deps.loadBusinessConnections).not.toHaveBeenCalled();
    expect(deps.runVariant).not.toHaveBeenCalled();
    expect(deps.probeReal).not.toHaveBeenCalled();
  });

  it('case 2: real endpoint unreachable → apply passes, real skipped + warning emitted', async () => {
    const probeReal = vi.fn(async () => ({
      outcomes: [{
        name: SAMPLE_CONNECTION.name,
        url: SAMPLE_CONNECTION.url,
        reachable: false,
        detail: 'ECONNREFUSED',
      }],
      allReachable: false,
      noneReachable: true,
    }));
    const runVariant = vi.fn(async () => ({
      passed: true, output: '', exitCode: 0, durationMs: 10, timedOut: false,
    }));
    const deps = makeDeps({ probeReal, runVariant });
    const state = makeState();

    const result = await parityCheck(state, deps);
    expect(result.violation).toBeNull();
    expect(result.passed).toBe(true);
    expect(result.warning).toMatch(/production variant skipped/i);
    expect(result.warning).toContain('ECONNREFUSED');
    // Apply variant ran exactly once; real variant did NOT run.
    expect(runVariant).toHaveBeenCalledTimes(1);
    expect(runVariant.mock.calls[0][0].env.USE_MOCK).toBe('true');
    expect(runVariant.mock.calls[0][0].env[SAMPLE_CONNECTION.toggleEnvVar]).toBe('true');
  });

  it('case 3: both passes pass → no violation, no warning, two runVariant calls (true then false)', async () => {
    const runVariant = vi.fn(async () => ({
      passed: true, output: '', exitCode: 0, durationMs: 12, timedOut: false,
    }));
    const deps = makeDeps({ runVariant });
    const state = makeState();

    const result = await parityCheck(state, deps);
    expect(result.violation).toBeNull();
    expect(result.passed).toBe(true);
    expect(result.warning).toBeUndefined();
    expect(runVariant).toHaveBeenCalledTimes(2);
    expect(runVariant.mock.calls[0][0].env[SAMPLE_CONNECTION.toggleEnvVar]).toBe('true');
    expect(runVariant.mock.calls[1][0].env[SAMPLE_CONNECTION.toggleEnvVar]).toBe('false');
  });

  it('case 4: apply variant fails → parity_apply_failed (retryable, real never runs)', async () => {
    const runVariant = vi.fn(async () => ({
      passed: false,
      output: 'TypeError: Cannot read properties of undefined',
      exitCode: 1,
      durationMs: 50,
      timedOut: false,
    }));
    const deps = makeDeps({ runVariant });
    const state = makeState();

    const result = await parityCheck(state, deps);
    expect(result.violation).not.toBeNull();
    expect(result.violation!.type).toBe('parity_apply_failed');
    expect(result.violation!.isRetryable).toBe(true);
    expect(result.violation!.severity).toBe('critical');
    expect(result.violation!.message).toContain('USE_MOCK=true');
    expect(result.violation!.message).toContain('TypeError');
    expect(result.passed).toBe(false);
    // Real-side spawn skipped.
    expect(runVariant).toHaveBeenCalledTimes(1);
    expect(deps.probeReal).not.toHaveBeenCalled();
  });

  it('case 5: real variant fails (no DTO markers) → parity_real_failed, apply pass info preserved', async () => {
    const runVariant = vi.fn()
      // Apply pass — succeeds.
      .mockResolvedValueOnce({
        passed: true, output: 'apply ok', exitCode: 0, durationMs: 11, timedOut: false,
      })
      // Real pass — fails with non-DTO error.
      .mockResolvedValueOnce({
        passed: false,
        output: 'Connection refused: localhost:5432',
        exitCode: 2,
        durationMs: 22,
        timedOut: false,
      });
    const deps = makeDeps({ runVariant });
    const state = makeState();

    const result = await parityCheck(state, deps);
    expect(result.violation).not.toBeNull();
    expect(result.violation!.type).toBe('parity_real_failed');
    expect(result.violation!.isRetryable).toBe(true);
    // Apply pass info preserved in the message tail.
    expect(result.violation!.message).toContain('passed');
    expect(result.violation!.message).toContain('Connection refused');
    expect(result.passed).toBe(false);
  });

  it('case 6: real failure with DTO mismatch markers → parity_dto_mismatch (retryable)', async () => {
    const runVariant = vi.fn()
      .mockResolvedValueOnce({
        passed: true, output: 'all tests passed', exitCode: 0, durationMs: 11, timedOut: false,
      })
      .mockResolvedValueOnce({
        passed: false,
        // Real-only marker — apply output had no such pattern.
        output: "Expected number, got string at field 'amount'\nTypeError: invalid",
        exitCode: 1,
        durationMs: 22,
        timedOut: false,
      });
    const deps = makeDeps({ runVariant });
    const state = makeState();

    const result = await parityCheck(state, deps);
    expect(result.violation).not.toBeNull();
    expect(result.violation!.type).toBe('parity_dto_mismatch');
    expect(result.violation!.isRetryable).toBe(true);
    expect(result.violation!.message).toContain('DTO shape divergence');
    expect(result.violation!.message).toContain('apply (USE_MOCK=true)');
    expect(result.violation!.message).toContain('real (USE_MOCK=false)');
    // The mismatch markers themselves surface in the violation message
    // so the next plan cycle has actionable signal.
    expect(result.violation!.message).toContain('Expected');
  });
});

describe('parityCheckEvaluate — verify-mode gate', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());

  it('returns null when not in verify-mode (prevents apply-phase fire)', async () => {
    const state = makeState({ _verifyEntered: false } as any);
    const violation = await parityCheckEvaluate(state);
    expect(violation).toBeNull();
  });
});

describe('parityCheck — guard ordering', () => {
  it('returns null when featurePath is missing (cannot spawn)', async () => {
    const state = makeState({ context: undefined } as any);
    const deps = makeDeps();
    const result = await parityCheck(state, deps);
    expect(result.violation).toBeNull();
    expect(result.passed).toBe(true);
    expect(deps.loadBusinessConnections).not.toHaveBeenCalled();
  });

  it('returns null when no business connections found on disk (degrades silently)', async () => {
    const deps = makeDeps({ loadBusinessConnections: vi.fn(async () => []) });
    const state = makeState();
    const result = await parityCheck(state, deps);
    expect(result.violation).toBeNull();
    expect(result.passed).toBe(true);
    expect(deps.runVariant).not.toHaveBeenCalled();
  });

  it('returns null when runVariant reports skippedReason (no command inferred)', async () => {
    const runVariant = vi.fn(async () => ({
      passed: true, output: '', exitCode: null, durationMs: 0, timedOut: false,
      skippedReason: 'no command inferred',
    }));
    const deps = makeDeps({ runVariant });
    const state = makeState();
    const result = await parityCheck(state, deps);
    expect(result.violation).toBeNull();
    expect(result.passed).toBe(true);
    // Real pass never attempted because apply was a silent no-op.
    expect(runVariant).toHaveBeenCalledTimes(1);
  });
});
