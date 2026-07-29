/**
 * Viability gate between a child's final text and the parent conversation.
 *
 * Regression origin: `tiny-counting-mocha` (2026-07-16) — the child hit the
 * round cap, lost its tool channel, and emitted "Let me also check the host
 * components." 1,002 times (max_tokens-truncated). The 16k-compacted garbage
 * was injected into decompose as a normal report and the parent's next
 * response crashed the job. The gate replaces degenerate bodies with a short
 * failure notice; the raw text survives on the card/store for forensics.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { assessReportViability } from '../../src/agents/common/subagent/assessReportViability';
import { setLLMClientFactory } from '../../src/periphery/adapters/llm/LLMClientFactory';
import { runExploreSubagent } from '../../src/agents/common/subagent/SubagentRunner';
import { ToolRegistry } from '../../src/agents/common/tool/registry';
import { ToolName } from '../../src/agents/common/tool/toolCatalog';
import { buildReportBlocks } from '../../src/agents/common/subagent/drain';
import type { SubagentSeamInternals, SubagentEntry } from '../../src/agents/common/subagent/types';

// ── assessReportViability heuristic ──────────────────────────────────────

describe('assessReportViability', () => {
  it('flags a single-sentence repetition loop (incident shape)', () => {
    const intro =
      'Let me check the host components directory and the presentation constants. ' +
      'Let me also check the main entry point. ';
    const loop = 'Let me also check the host components. '.repeat(1000);
    const v = assessReportViability(intro + loop);
    expect(v.degenerate).toBe(true);
    expect(v.distinctRatio).toBeLessThan(0.2);
    expect(v.totalUnits).toBeGreaterThan(900);
  });

  it('flags a line-repetition loop', () => {
    const v = assessReportViability('checking src/app.tsx\n'.repeat(200));
    expect(v.degenerate).toBe(true);
  });

  it('passes a normal long report', () => {
    const report = Array.from({ length: 120 }, (_, i) =>
      `Finding ${i}: module m${i} exports f${i} used by layer ${i % 5} at src/file${i}.ts:${i + 1}.`,
    ).join(' ');
    expect(assessReportViability(report).degenerate).toBe(false);
  });

  it('never flags short reports even if repetitive (under the unit floor)', () => {
    const v = assessReportViability('Done. '.repeat(20));
    expect(v.degenerate).toBe(false);
  });

  it('passes a report with a legitimately repeated status column', () => {
    // List-shaped reports repeat a short token per line but each line differs.
    const report = Array.from({ length: 100 }, (_, i) => `src/file${i}.ts — implemented`).join('\n');
    expect(assessReportViability(report).degenerate).toBe(false);
  });
});

// ── SubagentRunner integration ───────────────────────────────────────────

type StreamEvent = Record<string, any>;

function mockLLM(rounds: StreamEvent[][]): any {
  let call = 0;
  return {
    modelName: 'mock-child-model',
    provider: 'mock',
    async *stream() {
      const batch = rounds[Math.min(call, rounds.length - 1)];
      call++;
      for (const ev of batch) yield ev;
    },
  };
}

function internals(): SubagentSeamInternals {
  const registry = new ToolRegistry();
  registry.register(ToolName.READ_FILE, async (_ctx, args) => ({ content: `contents of ${args.path}` }));
  return {
    jobKind: 'code',
    llmJobType: 'code',
    baseCtx: { fileSystem: {} as any, chatStatus: {} as any, workingDir: '/tmp' } as any,
    registry,
    childTools: [{ name: 'read_file', description: 'read', input_schema: { type: 'object', properties: {} } }] as any,
    promptBuilder: { render: async () => 'child system prompt' },
  };
}

const text = (t: string): StreamEvent => ({ type: 'text', text: t });

beforeEach(() => {
  setLLMClientFactory(() => { throw new Error('unexpected factory call'); });
});

afterEach(async () => {
  setLLMClientFactory(null);
  const { clearAllReports } = await import('../../src/agents/common/subagent/reportStore');
  clearAllReports();
});

describe('runExploreSubagent — degenerate report gating', () => {
  it('replaces a degenerate final text with an error-state failure notice; raw text kept for forensics', async () => {
    const garbage = 'Let me also check the host components. '.repeat(1000);
    setLLMClientFactory(() => mockLLM([[text(garbage)]]));

    const result = await runExploreSubagent({ id: 'deg1', goal: 'assess completeness', internals: internals() });

    expect(result.state).toBe('error');
    expect(result.report).toContain('degenerate repetitive output');
    expect(result.report).toContain('read the relevant files directly');
    // The parent-facing body must NOT carry the repetition.
    expect(result.report).not.toContain('Let me also check the host components.');
    expect(result.report.length).toBeLessThan(600);
    // Pairing invariant: no marker literal in runner-authored strings.
    expect(result.report).not.toMatch(/\[SUBAGENT REPORT/);
    // Forensics surfaces keep the raw text.
    expect(result.reportFull).toBe(garbage.trim());
    const { readFullReport } = await import('../../src/agents/common/subagent/reportStore');
    expect(readFullReport('deg1', 0, 50)?.total).toBe(garbage.trim().length);
  });

  it('names the severing mechanism on the failure notice when the round was cut', async () => {
    // The in-stream breaker now severs the round long before max_tokens
    // arrives (the whole point — ~200 tokens instead of the full cap), so the
    // notice names the breaker rather than the token cap.
    const garbage = 'Let me also check the host components. '.repeat(1000);
    setLLMClientFactory(() => mockLLM([[text(garbage), { type: 'done', stopReason: 'max_tokens' }]]));

    const result = await runExploreSubagent({ id: 'deg2', goal: 'g', internals: internals() });
    expect(result.state).toBe('error');
    expect(result.report).toContain('severed by the repetition breaker');
  });

  it('appends a truncation note to a NON-degenerate max_tokens report instead of gating it', async () => {
    const legit = Array.from({ length: 80 }, (_, i) => `Finding ${i}: src/f${i}.ts wires layer ${i % 4}.`).join(' ');
    setLLMClientFactory(() => mockLLM([[text(legit), { type: 'done', stopReason: 'max_tokens' }]]));

    const result = await runExploreSubagent({ id: 'deg3', goal: 'g', internals: internals() });
    expect(result.state).toBe('done');
    expect(result.report).toContain('Finding 0:');
    expect(result.report).toContain('tail of this report is missing');
  });
});

// ── drain: partial interpretation contract ───────────────────────────────

describe('buildReportBlocks — partial guidance', () => {
  const entry = (state: 'done' | 'partial', report: string): SubagentEntry => ({
    id: 'sub-x',
    ownerKey: 'job:scope',
    goal: 'g',
    status: 'settled',
    promise: Promise.resolve(),
    result: { report, rounds: 3, state },
    launchedAt: 0,
    delivered: false,
  });

  it('appends a non-exhaustive note for partial reports', () => {
    const [block] = buildReportBlocks([entry('partial', '[partial] findings so far')]);
    expect((block as any).text).toContain('cut short');
    expect((block as any).text).toContain('NOT evidence of absence');
  });

  it('leaves done reports untouched', () => {
    const [block] = buildReportBlocks([entry('done', 'complete findings')]);
    expect((block as any).text).not.toContain('cut short');
  });
});
