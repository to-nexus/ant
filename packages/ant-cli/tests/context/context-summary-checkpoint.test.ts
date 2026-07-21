/**
 * P3 — context_summary checkpoint + Constraint Ledger (e2-humming-spindle).
 *
 * Contract:
 *  - the latest checkpoint folds all conversational lines at or before its
 *    `coversThroughTs` out of the prompt surface, seeding summary + ledger
 *    for free (per-hydrate LLM re-summarization retired);
 *  - an overflow compaction persists a new checkpoint (when session wired)
 *    whose ledger is the DETERMINISTIC union: previous ledger ∪ folded
 *    digests' constraints — verbatim, deduped, never dropped;
 *  - the ledger renders in every profile (injection floor).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  mergeFeatureContext,
  compactFeatureContext,
} from '../../src/core/context/featureContextBuilder';
import { projectLens } from '../../src/core/context/lensProjection';
import { CONTEXT_PROFILES } from '../../src/core/executionTier/contextProfile';
import type { LLMClient } from '../../src/core/ports/llm';
import type { PromptPort } from '../../src/core/ports/prompt';
import type { SessionPort } from '../../src/core/ports/session';

let seq = 0;
function ts(): string {
  seq += 1;
  return `2026-07-21T01:${String(Math.floor(seq / 60)).padStart(2, '0')}:${String(seq % 60).padStart(2, '0')}.000Z`;
}
function turn(turnId: string, text: string) {
  return { type: 'user_turn', ts: ts(), jobId: `job-${turnId}`, turnId, jobType: 'design', text } as any;
}
function assistantTurn(turnId: string, finalText: string, constraints: string[] = []) {
  return {
    type: 'assistant_turn', ts: ts(), jobId: `job-${turnId}`, turnId, jobType: 'design',
    finalText, digest: { decisions: [], constraints, outcome: `outcome-${turnId}` },
  } as any;
}
function checkpointLine(coversThroughTs: string, summary: string, ledger: string[]) {
  return {
    type: 'context_summary', ts: ts(), jobId: 'job-ck', turnId: 't-ck', jobType: 'code',
    coversThroughTs, summary, constraintLedger: ledger,
  } as any;
}

const stubPromptPort = { render: vi.fn(async () => 'compaction prompt') } as unknown as PromptPort;
function summarizingLLM(summary = 'ROLLING SUMMARY'): LLMClient {
  return { invoke: vi.fn(async () => summary) } as unknown as LLMClient;
}

describe('mergeFeatureContext — checkpoint application', () => {
  it('folds lines at or before coversThroughTs and seeds summary + ledger', () => {
    const t1 = turn('t1', 'old directive');
    const a1 = assistantTurn('t1', 'old answer');
    const t2 = turn('t2', 'new directive');

    const ctx = mergeFeatureContext({
      userTurns: [t1, t2],
      userTurnMetas: [],
      breadcrumbs: [],
      assistantTurns: [a1],
      contextSummaries: [checkpointLine(t1.ts, 'CHECKPOINT SUMMARY', ['항상 한국어'])],
    });

    expect(ctx.userTurns.map((t) => t.turnId)).toEqual(['t2']);
    expect(ctx.exchanges!.map((e) => e.turnId)).toEqual(['t2']);
    expect(ctx.summary).toBe('CHECKPOINT SUMMARY');
    expect(ctx.constraintLedger).toEqual(['항상 한국어']);
  });

  it('checkpoint reuse — a re-hydrate under budget makes ZERO LLM calls', async () => {
    const t1 = turn('t1', 'old');
    const t2 = turn('t2', 'new');
    const ctx = mergeFeatureContext({
      userTurns: [t1, t2],
      userTurnMetas: [],
      breadcrumbs: [],
      assistantTurns: [],
      contextSummaries: [checkpointLine(t1.ts, 'S', [])],
    });

    const llm = summarizingLLM();
    const result = await compactFeatureContext(ctx, { llm, promptPort: stubPromptPort }, {
      threshold: 12_000, windowSize: 6,
    });

    expect((llm.invoke as any)).not.toHaveBeenCalled();
    expect(result.summary).toBe('S');
  });
});

describe('compactFeatureContext — checkpoint persistence + ledger', () => {
  function bigCtx() {
    const userTurns = [];
    const assistantTurns = [];
    for (let i = 1; i <= 8; i++) {
      userTurns.push(turn(`t${i}`, `directive ${i} ${'x'.repeat(3000)}`));
      assistantTurns.push(assistantTurn(`t${i}`, `answer ${i}`, i <= 4 ? [`constraint-${i}`] : []));
    }
    return mergeFeatureContext({ userTurns, userTurnMetas: [], breadcrumbs: [], assistantTurns });
  }

  it('persists a context_summary line with the deterministic ledger union', async () => {
    const appended: any[] = [];
    const session = {
      appendContextSummary: vi.fn(async (line: any) => { appended.push(line); }),
    } as unknown as SessionPort;

    const ctx = bigCtx();
    const result = await compactFeatureContext(
      ctx,
      { llm: summarizingLLM('NEW SUMMARY'), promptPort: stubPromptPort, session, identity: { jobId: 'j', turnId: 't' } },
      { threshold: 1000, windowSize: 4 },
    );

    expect(result.wasCompacted).toBe(true);
    expect(appended).toHaveLength(1);
    const line = appended[0];
    expect(line.type).toBe('context_summary');
    expect(line.summary).toBe('NEW SUMMARY');
    // t1-t4 folded; their constraints enter the ledger verbatim.
    expect(line.constraintLedger).toEqual([
      'constraint-1', 'constraint-2', 'constraint-3', 'constraint-4',
    ]);
    // Folded lens bands leave the surface; kept ones stay.
    expect(result.exchanges!.map((e: any) => e.turnId)).toEqual(['t5', 't6', 't7', 't8']);
    expect(result.constraintLedger).toEqual(line.constraintLedger);
  });

  it('carries the previous ledger verbatim (union + dedupe) across compactions', async () => {
    const ctx = { ...bigCtx(), constraintLedger: ['legacy-rule', 'constraint-1'] };

    const result = await compactFeatureContext(
      ctx,
      { llm: summarizingLLM(), promptPort: stubPromptPort },
      { threshold: 1000, windowSize: 4 },
    );

    expect(result.constraintLedger).toEqual([
      'legacy-rule', 'constraint-1', 'constraint-2', 'constraint-3', 'constraint-4',
    ]);
  });

  it('feeds the previous rolling summary back into the compaction timeline', async () => {
    const llm = summarizingLLM();
    const promptPort = { render: vi.fn(async () => 'p') } as unknown as PromptPort;
    const ctx = { ...bigCtx(), summary: 'PREVIOUS ROLLING SUMMARY' };

    await compactFeatureContext(ctx, { llm, promptPort }, {
      threshold: 1000, windowSize: 4,
    });

    // The timeline reaches the LLM via the compaction template vars.
    const renderCalls = JSON.stringify((promptPort.render as any).mock.calls);
    expect(renderCalls).toContain('PREVIOUS ROLLING SUMMARY');
  });
});

describe('injection floor — ledger renders in every profile', () => {
  it('lean projection carries the constraint ledger', () => {
    const ctx = mergeFeatureContext({
      userTurns: [turn('t1', 'x')],
      userTurnMetas: [],
      breadcrumbs: [],
      assistantTurns: [],
      contextSummaries: [checkpointLine('1970-01-01T00:00:00Z', 'S', ['절대 라이브러리 추가 금지'])],
    });

    const lens = projectLens(ctx, CONTEXT_PROFILES.lean)!;
    expect(lens.constraintLedger).toEqual(['절대 라이브러리 추가 금지']);
  });
});
