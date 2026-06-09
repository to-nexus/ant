import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  detectOutputStall,
  normalizeStderrLineSig,
  pushLineSig,
  DEFAULT_REPEAT_GRACE_MS,
  DEFAULT_REPEAT_THRESHOLD,
  DEFAULT_NO_OUTPUT_MS,
  DEFAULT_SERVER_DETECTION_MS,
  ProgressSupervisor,
  type ProgressSignal,
  type SupervisorThresholds,
} from '../../src/agents/common/tool/handlers/progressSupervisor';

function buildMap(lines: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const line of lines) pushLineSig(m, line);
  return m;
}

const baseThresholds: SupervisorThresholds = {
  serverDetectionMs: DEFAULT_SERVER_DETECTION_MS,
  serverOutputPattern: /listening\s+on|started\s+.*(?:server|port)|server\s+(?:started|running|listening)|port\s+\d{4,5}|:\d{4,5}\b/i,
  repeatGraceMs: DEFAULT_REPEAT_GRACE_MS,
  repeatThreshold: DEFAULT_REPEAT_THRESHOLD,
  noOutputMs: DEFAULT_NO_OUTPUT_MS,
  hardTimeoutMs: 10 * 60_000,
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Pure helpers — preserved from prior watchdog test contract
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('normalizeStderrLineSig', () => {
  it('collapses numeric tokens so progress counters match', () => {
    expect(normalizeStderrLineSig('Generating static pages (1/4)')).toBe(
      normalizeStderrLineSig('Generating static pages (3/4)'),
    );
  });

  it('trims to 80 chars so long suffixes do not defeat the counter', () => {
    const long = 'Error: '.padEnd(200, 'x');
    expect(normalizeStderrLineSig(long).length).toBeLessThanOrEqual(80);
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(normalizeStderrLineSig('   ')).toBe('');
    expect(normalizeStderrLineSig('\n')).toBe('');
  });
});

describe('pushLineSig', () => {
  it('increments count for repeat signatures', () => {
    const m = buildMap([
      'Error: Event handlers cannot be passed',
      'Error: Event handlers cannot be passed',
      'Error: Event handlers cannot be passed',
    ]);
    expect(m.size).toBe(1);
    expect([...m.values()][0]).toBe(3);
  });

  it('skips package-manager banner lines so they do not act as new signatures', () => {
    const m = buildMap([
      '> pulse-landing@1.0.0 build /codebase',
      '> next build',
      'Error: something',
    ]);
    expect(m.has('Error: something')).toBe(true);
    expect([...m.keys()].some(k => k.startsWith('>'))).toBe(false);
  });

  it('skips empty/whitespace lines', () => {
    const m = buildMap(['', '   ', 'real line']);
    expect(m.size).toBe(1);
  });
});

describe('detectOutputStall', () => {
  const now = 1_000_000_000_000;

  it('returns null while the command is still within the grace period', () => {
    const m = buildMap(Array(10).fill('static page generation timing out'));
    const startedAt = now - (DEFAULT_REPEAT_GRACE_MS - 1_000);
    expect(detectOutputStall(m, startedAt, { now })).toBeNull();
  });

  it('fires once the grace elapsed AND the dominant signature crossed the threshold', () => {
    const m = buildMap(Array(DEFAULT_REPEAT_THRESHOLD).fill('static page generation timing out'));
    const startedAt = now - (DEFAULT_REPEAT_GRACE_MS + 10_000);
    const stall = detectOutputStall(m, startedAt, { now });
    expect(stall).not.toBeNull();
    expect(stall?.repeat).toBe(DEFAULT_REPEAT_THRESHOLD);
    expect(stall?.signature).toBe('static page generation timing out');
  });

  it('does not fire when output is varied even past the grace period', () => {
    const m = buildMap([
      'Compiling page A',
      'Compiling page B',
      'Optimizing chunks',
      'Emitting output',
      'Done',
    ]);
    const startedAt = now - (DEFAULT_REPEAT_GRACE_MS * 2);
    expect(detectOutputStall(m, startedAt, { now })).toBeNull();
  });

  it('picks the dominant signature when multiple errors compete', () => {
    const m = buildMap([
      'warning X',
      'warning X',
      'error Y',
      'error Y',
      'error Y',
      'error Y',
      'error Y',
      'error Y',
    ]);
    const startedAt = now - (DEFAULT_REPEAT_GRACE_MS * 2);
    const stall = detectOutputStall(m, startedAt, { now });
    expect(stall?.signature).toBe('error Y');
    expect(stall?.repeat).toBe(6);
  });

  it('fires when Next-style progress counters collapse to a single normalized signature (stuck retry loop)', () => {
    const m = buildMap([
      'Generating static pages (0/4)',
      'Generating static pages (1/4)',
      'Generating static pages (2/4)',
      'Generating static pages (3/4)',
    ]);
    const startedAt = now - (DEFAULT_REPEAT_GRACE_MS + 5_000);
    const stall = detectOutputStall(m, startedAt, { now });
    expect(stall).not.toBeNull();
    expect(stall?.repeat).toBeGreaterThanOrEqual(DEFAULT_REPEAT_THRESHOLD);
  });

  it('respects custom graceMs / repeatThreshold for test harnesses', () => {
    const m = buildMap(Array(3).fill('same line'));
    const startedAt = now - 2_000;
    expect(detectOutputStall(m, startedAt, { now, graceMs: 1_000, repeatThreshold: 3 })).toEqual({
      signature: 'same line',
      repeat: 3,
    });
  });

  it('a new Map instance starts with count 0 — re-entry must not leak (verification retry contract)', () => {
    const cycle1 = buildMap(Array(DEFAULT_REPEAT_THRESHOLD).fill('pnpm build error'));
    const past = now - (DEFAULT_REPEAT_GRACE_MS + 1_000);
    expect(detectOutputStall(cycle1, past, { now })).not.toBeNull();

    const cycle2 = new Map<string, number>();
    pushLineSig(cycle2, 'pnpm build error');
    expect(detectOutputStall(cycle2, past, { now })).toBeNull();
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ProgressSupervisor — 4-signal SSOT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('ProgressSupervisor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function settle(): Promise<void> {
    // Flush microtasks so resolved promises propagate to awaiters.
    await Promise.resolve();
    await Promise.resolve();
  }

  it('fires serverStartedPattern when serverDetectionMs elapses and output matches', async () => {
    const sup = new ProgressSupervisor({
      command: 'node server.js',
      thresholds: baseThresholds,
    });
    sup.ingestChunk('listening on port 3000\n');

    const sigPromise = sup.signal();
    await vi.advanceTimersByTimeAsync(baseThresholds.serverDetectionMs);
    const signal = await sigPromise;

    expect(signal.kind).toBe('serverStartedPattern');
  });

  it('does NOT fire serverStartedPattern when output lacks the pattern', async () => {
    // Output is present (no noOutput) but never matches server pattern; only
    // server + hard signals are enabled so the test isolates the pattern gate.
    const sup = new ProgressSupervisor({
      command: 'noisy-but-not-a-server',
      thresholds: {
        ...baseThresholds,
        hardTimeoutMs: baseThresholds.serverDetectionMs + 1_000,
      },
      enabledSignals: ['serverStartedPattern', 'hardTimeout'],
    });
    sup.ingestChunk('compiling …\n');
    sup.ingestChunk('linking …\n');

    const sigPromise = sup.signal();
    await vi.advanceTimersByTimeAsync(baseThresholds.serverDetectionMs + 2_000);
    const signal = await sigPromise;

    expect(signal.kind).toBe('hardTimeout');
  });

  it('fires repeatedSignature after grace + threshold (poll interval observed)', async () => {
    const sup = new ProgressSupervisor({
      command: 'pnpm build',
      thresholds: { ...baseThresholds, hardTimeoutMs: 999 * 60_000 },
      enabledSignals: ['repeatedSignature'],
    });

    for (let i = 0; i < DEFAULT_REPEAT_THRESHOLD; i++) {
      sup.ingestChunk('Error: build failed\n');
    }

    const sigPromise = sup.signal();
    // Advance past grace + first poll interval (15s)
    await vi.advanceTimersByTimeAsync(DEFAULT_REPEAT_GRACE_MS + 16_000);
    const signal = await sigPromise;

    expect(signal.kind).toBe('repeatedSignature');
    if (signal.kind === 'repeatedSignature') {
      expect(signal.signature).toBe('Error: build failed');
      expect(signal.repeat).toBeGreaterThanOrEqual(DEFAULT_REPEAT_THRESHOLD);
    }
  });

  it('fires noOutput after silent window when no chunks arrive', async () => {
    const sup = new ProgressSupervisor({
      command: 'find / -name xyz',
      thresholds: { ...baseThresholds, hardTimeoutMs: 999 * 60_000 },
      enabledSignals: ['noOutput'],
    });

    const sigPromise = sup.signal();
    await vi.advanceTimersByTimeAsync(DEFAULT_NO_OUTPUT_MS + 5_000);
    const signal = await sigPromise;

    expect(signal.kind).toBe('noOutput');
    if (signal.kind === 'noOutput') {
      expect(signal.silentMs).toBeGreaterThanOrEqual(DEFAULT_NO_OUTPUT_MS);
    }
  });

  it('noOutput does NOT fire when a real chunk arrives before the threshold', async () => {
    const sup = new ProgressSupervisor({
      command: 'long but not silent',
      thresholds: {
        ...baseThresholds,
        hardTimeoutMs: DEFAULT_NO_OUTPUT_MS + 5_000,
      },
      enabledSignals: ['noOutput', 'hardTimeout'],
    });

    const sigPromise = sup.signal();
    // Half-way through the noOutput window — push a real (non-banner) chunk
    await vi.advanceTimersByTimeAsync(Math.floor(DEFAULT_NO_OUTPUT_MS / 2));
    sup.ingestChunk('progress: 50%\n');
    // Advance another half-window — total elapsed > noOutputMs, but lastOutputAt
    // is fresh, so noOutput must not fire. hardTimeout takes over instead.
    await vi.advanceTimersByTimeAsync(DEFAULT_NO_OUTPUT_MS);
    const signal = await sigPromise;

    expect(signal.kind).toBe('hardTimeout');
  });

  it('noOutput banner-only chunks (> / $) do NOT reset lastOutputAt', async () => {
    const sup = new ProgressSupervisor({
      command: 'pnpm install',
      thresholds: { ...baseThresholds, hardTimeoutMs: 999 * 60_000 },
      enabledSignals: ['noOutput'],
    });

    const sigPromise = sup.signal();
    // Push only banner lines, then go silent
    sup.ingestChunk('> some-pkg@1.0.0 install\n');
    sup.ingestChunk('> another-banner\n');
    await vi.advanceTimersByTimeAsync(DEFAULT_NO_OUTPUT_MS + 5_000);
    const signal = await sigPromise;

    expect(signal.kind).toBe('noOutput');
  });

  it('fires hardTimeout at the cap', async () => {
    const sup = new ProgressSupervisor({
      command: 'busy compute',
      thresholds: { ...baseThresholds, hardTimeoutMs: 30_000 },
      enabledSignals: ['hardTimeout'],
    });

    const sigPromise = sup.signal();
    await vi.advanceTimersByTimeAsync(30_001);
    const signal = await sigPromise;

    expect(signal.kind).toBe('hardTimeout');
    if (signal.kind === 'hardTimeout') {
      expect(signal.elapsedMs).toBeGreaterThanOrEqual(30_000);
    }
  });

  it('dispose() prevents any signal from firing', async () => {
    const sup = new ProgressSupervisor({
      command: 'cmd',
      thresholds: { ...baseThresholds, hardTimeoutMs: 1_000 },
    });

    let resolved = false;
    void sup.signal().then(() => { resolved = true; });
    sup.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();

    expect(resolved).toBe(false);
  });

  it('enabledSignals filter: disabled signals never fire', async () => {
    const sup = new ProgressSupervisor({
      command: 'silent walk',
      thresholds: { ...baseThresholds, hardTimeoutMs: DEFAULT_NO_OUTPUT_MS - 10_000 },
      enabledSignals: ['hardTimeout'], // explicitly no noOutput
    });

    const sigPromise = sup.signal();
    await vi.advanceTimersByTimeAsync(baseThresholds.hardTimeoutMs + 5_000);
    const signal = await sigPromise;

    expect(signal.kind).toBe('hardTimeout');
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // postOutputIdleMs (fastFire) — declared by caller via `oneshot: true`.
  // Bypasses the elapsedMs gate so a process that emits output then leaves
  // an async handle open is reaped quickly. Silent-from-start is preserved.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  it('postOutputIdleMs (fastFire) fires noOutput shortly after first output goes idle', async () => {
    const sup = new ProgressSupervisor({
      command: 'node -e "https.get(...)"',
      thresholds: {
        ...baseThresholds,
        hardTimeoutMs: 999 * 60_000,
        postOutputIdleMs: 3_000,
      },
      enabledSignals: ['noOutput'],
    });

    const sigPromise = sup.signal();
    sup.ingestChunk('Status: 302\n');           // first observable output
    await vi.advanceTimersByTimeAsync(10_000);  // > postOutputIdleMs, far short of noOutputMs
    const signal = await sigPromise;

    expect(signal.kind).toBe('noOutput');
    if (signal.kind === 'noOutput') {
      expect(signal.hadOutputBeforeSilence).toBe(true);
      expect(signal.silentMs).toBeGreaterThanOrEqual(3_000);
    }
  });

  it('postOutputIdleMs (fastFire) does NOT fire when no output ever arrives — falls back to base noOutput', async () => {
    const sup = new ProgressSupervisor({
      command: 'node -e "setTimeout(()=>{}, 999999)"',
      thresholds: {
        ...baseThresholds,
        hardTimeoutMs: 999 * 60_000,
        postOutputIdleMs: 3_000,
      },
      enabledSignals: ['noOutput'],
    });

    const sigPromise = sup.signal();
    // Half-way through the noOutput window — still no output, fastFire must
    // not fire because hasEmittedOutput is false.
    await vi.advanceTimersByTimeAsync(Math.floor(DEFAULT_NO_OUTPUT_MS / 2));
    // Push the rest of the way + a slack — base noOutput should now fire.
    await vi.advanceTimersByTimeAsync(Math.ceil(DEFAULT_NO_OUTPUT_MS / 2) + 5_000);
    const signal = await sigPromise;

    expect(signal.kind).toBe('noOutput');
    if (signal.kind === 'noOutput') {
      expect(signal.hadOutputBeforeSilence).toBe(false);
      expect(signal.silentMs).toBeGreaterThanOrEqual(DEFAULT_NO_OUTPUT_MS);
    }
  });

  it('without postOutputIdleMs, output-then-silent waits for the full noOutputMs window (preserves existing behavior)', async () => {
    const sup = new ProgressSupervisor({
      command: 'no-oneshot-flag',
      thresholds: { ...baseThresholds, hardTimeoutMs: 999 * 60_000 },
      enabledSignals: ['noOutput'],
    });

    const sigPromise = sup.signal();
    sup.ingestChunk('hello\n');
    // 10s after output — far past postOutputIdleMs but no fast-fire enabled.
    await vi.advanceTimersByTimeAsync(10_000);
    // Advance the rest of the noOutput window — should fire then.
    await vi.advanceTimersByTimeAsync(DEFAULT_NO_OUTPUT_MS);
    const signal = await sigPromise;

    expect(signal.kind).toBe('noOutput');
    if (signal.kind === 'noOutput') {
      expect(signal.hadOutputBeforeSilence).toBe(true);
      // Total silence >= noOutputMs; not the fast 3s threshold.
      expect(signal.silentMs).toBeGreaterThanOrEqual(DEFAULT_NO_OUTPUT_MS);
    }
  });

  it('postOutputIdleMs (fastFire) lastOutputAt reset by fresh chunks prevents premature fire', async () => {
    const sup = new ProgressSupervisor({
      command: 'node -e "setInterval(()=>console.log(\\"tick\\"), 1000)"',
      thresholds: {
        ...baseThresholds,
        hardTimeoutMs: 12_000,
        postOutputIdleMs: 3_000,
      },
      enabledSignals: ['noOutput', 'hardTimeout'],
    });

    const sigPromise = sup.signal();
    // Emit a real chunk every 1s for 10s — each chunk resets lastOutputAt so
    // fastFire never reaches its 3s idle threshold; hardTimeout wins.
    for (let i = 0; i < 10; i++) {
      sup.ingestChunk(`tick ${i}\n`);
      await vi.advanceTimersByTimeAsync(1_000);
    }
    await vi.advanceTimersByTimeAsync(5_000);
    const signal = await sigPromise;

    expect(signal.kind).toBe('hardTimeout');
  });

  // Regression guard for `tight-drafting-lever`: memoryBudget aborts THIS
  // command (not the job) before a cgroup OOM-kill of the whole pod.
  it('fires memoryBudget when the sampler crosses the budget', async () => {
    let used = 100;
    const sup = new ProgressSupervisor({
      command: 'pnpm test',
      thresholds: { ...baseThresholds, memoryBudgetBytes: 1_000, memoryPollMs: 2_000 },
      enabledSignals: ['memoryBudget', 'hardTimeout'],
      sampleMemoryBytes: () => used,
    });

    const sigPromise = sup.signal();
    await vi.advanceTimersByTimeAsync(2_000); // under budget — no fire
    used = 1_200; // cross the budget
    await vi.advanceTimersByTimeAsync(2_000);
    const signal = await sigPromise;

    expect(signal.kind).toBe('memoryBudget');
    expect((signal as Extract<ProgressSignal, { kind: 'memoryBudget' }>).rssBytes).toBe(1_200);
  });

  it('does NOT arm memoryBudget without both a budget and a sampler', async () => {
    const sup = new ProgressSupervisor({
      command: 'pnpm test',
      // budget set but no sampler → disarmed; hardTimeout is the only escape.
      thresholds: { ...baseThresholds, memoryBudgetBytes: 1_000, hardTimeoutMs: 5_000 },
      enabledSignals: ['memoryBudget', 'hardTimeout'],
    });

    const sigPromise = sup.signal();
    await vi.advanceTimersByTimeAsync(5_000);
    const signal = await sigPromise;

    expect(signal.kind).toBe('hardTimeout');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// renderTermination — LLM-facing message contract (snapshot)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('ProgressSupervisor.renderTermination', () => {
  const ctx = { command: 'find / -name foo', output: 'partial output\n', tailChars: 100 };

  it('serverStartedPattern → exit 0, success true, hasWarnings true', () => {
    const sig: ProgressSignal = { kind: 'serverStartedPattern', output: 'listening on port 3000' };
    const r = ProgressSupervisor.renderTermination(sig, ctx);
    expect(r.exitCode).toBe(0);
    expect(r.success).toBe(true);
    expect(r.hasWarnings).toBe(true);
    expect(r.content).toContain('Reason:  serverStartedPattern');
    expect(r.content).toContain('Server-like output detected');
  });

  it('repeatedSignature → exit 124, success false, message names signature & repeats', () => {
    const sig: ProgressSignal = {
      kind: 'repeatedSignature',
      signature: 'Error: foo',
      repeat: 3,
      elapsedMs: 75_000,
    };
    const r = ProgressSupervisor.renderTermination(sig, ctx);
    expect(r.exitCode).toBe(124);
    expect(r.success).toBe(false);
    expect(r.content).toContain('Error: foo');
    expect(r.content).toContain('3×');
  });

  it('noOutput silent-from-start → exit 124, message recommends scoped tools (search_code / list_files / read_file)', () => {
    const sig: ProgressSignal = { kind: 'noOutput', silentMs: 60_000, hadOutputBeforeSilence: false };
    const r = ProgressSupervisor.renderTermination(sig, ctx);
    expect(r.exitCode).toBe(124);
    expect(r.success).toBe(false);
    expect(r.content).toContain('search_code');
    expect(r.content).toContain('list_files');
    expect(r.content).toContain('read_file');
  });

  it('noOutput output-then-silent → exit 124, message names open async handle + recommends oneshot flag', () => {
    const sig: ProgressSignal = { kind: 'noOutput', silentMs: 3_000, hadOutputBeforeSilence: true };
    const r = ProgressSupervisor.renderTermination(sig, ctx);
    expect(r.exitCode).toBe(124);
    expect(r.success).toBe(false);
    expect(r.content).toContain('emitted output then went idle');
    expect(r.content).toContain('open async handle');
    expect(r.content).toContain('oneshot');
    // Silent-from-start hint must NOT leak into this branch.
    expect(r.content).not.toContain('search_code');
  });

  it('hardTimeout → exit 124, message names elapsed minutes', () => {
    const sig: ProgressSignal = { kind: 'hardTimeout', elapsedMs: 10 * 60_000 };
    const r = ProgressSupervisor.renderTermination(sig, ctx);
    expect(r.exitCode).toBe(124);
    expect(r.success).toBe(false);
    expect(r.content).toContain('Hard cap');
    expect(r.content).toContain('10m');
  });

  it('memoryBudget → exit 137, frames it as a RESOURCE abort (not a code defect)', () => {
    const sig: ProgressSignal = {
      kind: 'memoryBudget',
      rssBytes: 7 * 1024 * 1024 * 1024,
      budgetBytes: 6 * 1024 * 1024 * 1024,
      elapsedMs: 42_000,
    };
    const r = ProgressSupervisor.renderTermination(sig, ctx);
    expect(r.exitCode).toBe(137);
    expect(r.success).toBe(false);
    expect(r.content).toContain('NOT a test/compile failure');
    expect(r.content).toContain('narrower scope');
  });

  it('embeds the output tail honouring tailChars', () => {
    const big = 'x'.repeat(20_000);
    const sig: ProgressSignal = { kind: 'noOutput', silentMs: 60_000, hadOutputBeforeSilence: false };
    const r = ProgressSupervisor.renderTermination(sig, { command: 'cmd', output: big, tailChars: 1_000 });
    // The body line "Output (last 1000 chars):" + 1000 chars of x's
    expect(r.content).toContain('Output (last 1000 chars):');
    const xs = r.content.match(/x+/)?.[0] ?? '';
    expect(xs.length).toBe(1_000);
  });
});
