/**
 * Job-context-bridge integration test.
 *
 * Walks the four end-to-end scenarios that the redesign promises:
 *   (a) code-change task → next turn sees BC summary + anchors
 *   (b) compact trigger → old BCs fold into MECE summary as Artifacts
 *   (c) explain task → no BC line, user_turn flows alone
 *   (d) Hard Reset (user_reset) → cuts the timeline
 *
 * Drives the real `FileSessionAdapter` (file-system backed) plus the
 * actual `writeBreadcrumb` strategy (FullBreadcrumb), `compactFeatureContext`
 * helper, and the resolve-time merge. Prompt rendering itself is covered
 * by the existing prompt-smoke suite — this file pins the data flow that
 * feeds those templates.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileSessionAdapter } from '../../src/periphery/adapters/session/FileSessionAdapter';
import {
  buildFeatureContext,
  compactFeatureContext,
} from '../../src/core/context/featureContextBuilder';
import { FullBreadcrumb } from '../../src/core/executionTier/strategies/breadcrumb';
import type { ExecutionTierState } from '../../src/core/executionTier/types';
import type { TouchedFromChatLog } from '../../src/core/context/breadcrumb';
import type { LLMClient } from '../../src/core/ports/llm';
import type { PromptPort } from '../../src/core/ports/prompt';
import type {
  FeatureUserTurnLine,
  FeatureBoundaryLine,
} from '@ant/shared';

let workdir: string;
let adapter: FileSessionAdapter;

beforeEach(async () => {
  workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-bridge-it-'));
  await fs.mkdir(path.join(workdir, '.ant'), { recursive: true });
  adapter = new FileSessionAdapter(workdir, 'architect', 'p', 'feat');
});

afterEach(async () => {
  await fs.rm(workdir, { recursive: true, force: true });
});

function makeTouched(files: string[], op: 'created' | 'modified' = 'modified'): TouchedFromChatLog {
  return {
    all: new Set(files),
    created: op === 'created' ? files : [],
    modified: op === 'modified' ? files : [],
    deleted: [],
  };
}

function makePromptPort(rendered = 'system prompt body'): PromptPort {
  return { render: vi.fn().mockResolvedValue(rendered) } as unknown as PromptPort;
}

function makeLLM(content: string): LLMClient {
  return {
    invoke: vi.fn().mockResolvedValue(content),
    invokeWithUsage: vi
      .fn()
      .mockResolvedValue({ content, usage: { inputTokens: 10, outputTokens: 5 } }),
  } as unknown as LLMClient;
}

describe('job-context-bridge — integration scenarios', () => {
  // ────────────────────────────────────────────────────────────────────
  // (a) code-change task → next turn sees BC summary + anchors
  // ────────────────────────────────────────────────────────────────────
  it('a) code change emits BC; next-turn featureContext exposes summary + anchors', async () => {
    // Turn 1 — user_turn appended by the orchestrator.
    const t1: FeatureUserTurnLine = {
      type: 'user_turn',
      ts: '2026-04-19T00:00:00.000Z',
      jobId: 'job-1',
      turnId: 'turn-1',
      jobType: 'code',
      text: 'add OAuth login',
    };
    await adapter.appendUserTurn(t1);

    // The "learn" step writes a BC line via FullBreadcrumb. We feed an
    // already-computed touched set to keep the test independent from the
    // chat.jsonl collector.
    const state: ExecutionTierState = {
      jobId: 'job-1',
      turnId: 'turn-1',
      directive: 'add OAuth login',
      resolvedAction: { mode: 'generate' },
      deps: { session: adapter as any },
    };
    const touched = makeTouched(['apps/web/auth/login.tsx', 'packages/auth/session.ts']);
    await new FullBreadcrumb().apply(state, touched);

    // Next turn — resolve loads featureContext.
    const ctx = await buildFeatureContext(adapter);
    expect(ctx).toBeDefined();
    expect(ctx!.breadcrumbs).toHaveLength(1);
    const bc = ctx!.breadcrumbs[0];
    expect(bc.summary).toContain('add OAuth login');
    expect(bc.scope).toBe('modification');
    expect(bc.anchors.files).toEqual(
      expect.arrayContaining(['apps/web/auth/login.tsx', 'packages/auth/session.ts']),
    );
    expect(bc.stats?.modified).toBe(2);
    expect(ctx!.userTurns.map((t) => t.turnId)).toEqual(['turn-1']);
  });

  // ────────────────────────────────────────────────────────────────────
  // (b) compact trigger → old BCs fold into MECE summary as Artifacts
  // ────────────────────────────────────────────────────────────────────
  it('b) old breadcrumbs are folded into MECE Artifacts when token budget is exceeded', async () => {
    // Compose a heavy ctx in-memory — file-system path is not strictly
    // required for compact (compactFeatureContext is pure on input).
    const turns = Array.from({ length: 10 }, (_, i) => ({
      type: 'user_turn' as const,
      ts: `2026-04-19T00:00:${String(i).padStart(2, '0')}.000Z`,
      jobId: `job-${i}`,
      turnId: `t-${i}`,
      jobType: 'code' as const,
      text: 'x'.repeat(10_000),
    }));
    const oldBc = {
      type: 'breadcrumb' as const,
      ts: '2026-04-19T00:00:01.500Z', // before kept window cutoff (t-6 ts ≈ 06)
      jobId: 'job-1',
      turnId: 't-1',
      jobType: 'code' as const,
      scope: 'modification' as const,
      anchors: { paths: ['src/old/**'] },
      summary: 'old refactor work',
      stats: { touched: 5, modified: 5 },
    };
    const recentBc = {
      type: 'breadcrumb' as const,
      ts: '2026-04-19T00:00:09.500Z',
      jobId: 'job-9',
      turnId: 't-9',
      jobType: 'code' as const,
      scope: 'modification' as const,
      anchors: { files: ['recent.ts'] },
      summary: 'recent change',
      stats: { touched: 1 },
    };
    const llm = makeLLM('summary digest');
    const promptPort = makePromptPort();

    const result = await compactFeatureContext(
      { breadcrumbs: [oldBc, recentBc], userTurns: turns },
      { llm, promptPort },
      { threshold: 12_000, windowSize: 4 },
    );

    expect(result.wasCompacted).toBe(true);
    expect(result.summary).toBe('summary digest');
    // Recent BC survives, old BC was folded.
    expect(result.breadcrumbs).toEqual([recentBc]);
    // The MECE prompt rendered for the LLM contained the old BC content
    // labelled as Artifact.
    const rendered = (promptPort.render as any).mock.calls[0][1];
    expect(rendered.conversation).toContain('Artifact');
    expect(rendered.conversation).toContain('old refactor work');
  });

  // ────────────────────────────────────────────────────────────────────
  // (c) explain task → no BC line, user_turn flows alone
  // ────────────────────────────────────────────────────────────────────
  it("c) explain task does NOT write a BC; user_turn still flows", async () => {
    const t1: FeatureUserTurnLine = {
      type: 'user_turn',
      ts: '2026-04-19T00:00:00.000Z',
      jobId: 'job-1',
      turnId: 'turn-1',
      jobType: 'code',
      text: 'why does this fail?',
    };
    await adapter.appendUserTurn(t1);

    const state: ExecutionTierState = {
      jobId: 'job-1',
      turnId: 'turn-1',
      directive: 'why does this fail?',
      resolvedAction: { mode: 'explain' },
      deps: { session: adapter as any },
    };
    // Even with non-empty touched, explain mode skips BC inside
    // writeBreadcrumb (job-context-bridge T3 contract).
    await new FullBreadcrumb().apply(
      state,
      makeTouched(['somefile.ts']),
    );

    const ctx = await buildFeatureContext(adapter);
    expect(ctx!.breadcrumbs).toHaveLength(0);
    expect(ctx!.userTurns).toHaveLength(1);
    expect(ctx!.userTurns[0].text).toBe('why does this fail?');
  });

  // ────────────────────────────────────────────────────────────────────
  // (d) Hard Reset (user_reset) → cuts the timeline
  // ────────────────────────────────────────────────────────────────────
  it('d) user_reset boundary cuts the timeline; legacy auto boundaries do not', async () => {
    const t1: FeatureUserTurnLine = {
      type: 'user_turn',
      ts: '2026-04-19T00:00:00.000Z',
      jobId: 'job-1',
      turnId: 'turn-1',
      jobType: 'code',
      text: 'first directive',
    };
    const legacyAuto: FeatureBoundaryLine = {
      type: 'boundary',
      ts: '2026-04-19T00:00:01.000Z',
      jobId: 'job-1',
      turnId: 'turn-1',
      jobType: 'code',
      reason: 'auto_job_complete_todo',
    };
    const t2: FeatureUserTurnLine = {
      type: 'user_turn',
      ts: '2026-04-19T00:00:02.000Z',
      jobId: 'job-2',
      turnId: 'turn-2',
      jobType: 'code',
      text: 'second directive',
    };
    const reset: FeatureBoundaryLine = {
      type: 'boundary',
      ts: '2026-04-19T00:00:03.000Z',
      jobId: 'job-2',
      turnId: 'turn-2',
      jobType: 'reset',
      reason: 'user_reset',
    };
    const t3: FeatureUserTurnLine = {
      type: 'user_turn',
      ts: '2026-04-19T00:00:04.000Z',
      jobId: 'job-3',
      turnId: 'turn-3',
      jobType: 'code',
      text: 'after reset',
    };

    await adapter.appendLine('feature', t1);
    await adapter.appendLine('feature', legacyAuto);
    await adapter.appendLine('feature', t2);
    await adapter.appendLine('feature', reset);
    await adapter.appendLine('feature', t3);

    const ctx = await buildFeatureContext(adapter);
    // Only the user_turn after Hard Reset survives. Legacy auto boundary
    // is ignored — t1 would not appear because user_reset cuts above it.
    expect(ctx!.userTurns.map((t) => t.turnId)).toEqual(['turn-3']);
  });
});
