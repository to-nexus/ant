/**
 * emitJobFinalSummary unit tests — streaming happy path, timeout/error
 * fallback, empty-task skip, and the never-throws contract
 * (plan curious-spinning-twilight).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  emitJobFinalSummary,
  harvestTaskProse,
  type EmitJobFinalSummaryInput,
  type JobSummaryChatAPI,
} from '../../src/core/context/jobSummary';

function mockChatAPI() {
  const calls: string[] = [];
  const texts: string[] = [];
  const api: JobSummaryChatAPI = {
    startMessage: vi.fn(async () => { calls.push('start'); }),
    sendLLMEvent: vi.fn(async (e: { type: 'text'; text: string }) => {
      calls.push('text');
      texts.push(e.text);
    }),
    finalizeMessage: vi.fn(async () => { calls.push('finalize'); }),
  };
  return { api, calls, texts };
}

function streamOf(events: Array<Record<string, unknown>>) {
  return async function* () {
    for (const e of events) yield e as any;
  };
}

const baseInput = (
  overrides: Partial<EmitJobFinalSummaryInput>,
): EmitJobFinalSummaryInput => ({
  session: undefined,
  chatAPI: mockChatAPI().api,
  jobType: 'code',
  jobId: 'job-1',
  turnId: 'turn-1',
  directive: 'add a login page — also, is signup already handled?',
  completedTasks: [{ name: 'Login page', type: 'feature', files: ['src/Login.tsx'] }],
  ...overrides,
});

const promptPort = { render: vi.fn(async () => 'SYSTEM PROMPT') } as any;

describe('emitJobFinalSummary', () => {
  it('streams the LLM summary into a single message and reports usage', async () => {
    const { api, calls, texts } = mockChatAPI();
    const usage = { inputTokens: 100, outputTokens: 50 };
    const llm = {
      stream: streamOf([
        { type: 'text', text: 'All done. ' },
        { type: 'text', text: 'Signup was already handled.' },
        { type: 'done', usage },
      ]),
    } as any;
    const onUsage = vi.fn();

    const result = await emitJobFinalSummary(
      baseInput({ chatAPI: api, llm, promptPort, onUsage }),
    );

    expect(result).toBe('All done. Signup was already handled.');
    expect(calls[0]).toBe('start');
    expect(calls[calls.length - 1]).toBe('finalize');
    expect(texts.join('')).toBe('All done. Signup was already handled.');
    expect(onUsage).toHaveBeenCalledWith(usage);
  });

  it('falls back to the deterministic summary when the stream errors before any text', async () => {
    const { api, texts } = mockChatAPI();
    const llm = {
      stream: streamOf([{ type: 'error', error: { message: 'boom' } }]),
    } as any;

    const result = await emitJobFinalSummary(baseInput({ chatAPI: api, llm, promptPort }));

    expect(result).toContain('Completed 1 task: Login page.');
    expect(texts.join('')).toContain('Completed 1 task');
  });

  it('closes a partially-streamed message on mid-stream error and keeps the partial text', async () => {
    const { api, calls } = mockChatAPI();
    const llm = {
      stream: streamOf([
        { type: 'text', text: 'Partial…' },
        { type: 'error', error: { message: 'cut' } },
      ]),
    } as any;

    const result = await emitJobFinalSummary(baseInput({ chatAPI: api, llm, promptPort }));

    expect(result).toBe('Partial…');
    expect(calls[calls.length - 1]).toBe('finalize');
    // No second message (no fallback double-emit after a partial stream).
    expect(calls.filter((c) => c === 'start').length).toBe(1);
  });

  it('goes inert after the timeout — the orphaned stream cannot emit a second message', async () => {
    // withTimeout rejects but cannot abort the stream (the LLM port takes no
    // AbortSignal), so the iterator keeps yielding. Those events must not
    // reopen a turn buffer nobody finalizes, nor interleave with the
    // fallback's own message.
    vi.useFakeTimers();
    try {
      const { api, calls, texts } = mockChatAPI();
      let releaseFirstChunk!: () => void;
      const gate = new Promise<void>((r) => { releaseFirstChunk = r; });

      const llm = {
        stream: async function* () {
          await gate;                       // still pending when the budget expires
          yield { type: 'text', text: 'too late' } as any;
          yield { type: 'text', text: ' and later still' } as any;
        },
      } as any;

      const promise = emitJobFinalSummary(baseInput({ chatAPI: api, llm, promptPort }));

      await vi.advanceTimersByTimeAsync(31_000);   // JOB_SUMMARY_TIMEOUT_MS = 30s
      releaseFirstChunk();
      const result = await promise;
      await vi.advanceTimersByTimeAsync(0);        // let the orphan drain

      // Fallback owns the only message.
      expect(result).toContain('Completed 1 task: Login page.');
      expect(calls.filter((c) => c === 'start').length).toBe(1);
      expect(calls.filter((c) => c === 'finalize').length).toBe(1);
      expect(texts.join('')).not.toContain('too late');
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back when the LLM emits no text at all', async () => {
    const { api } = mockChatAPI();
    const llm = { stream: streamOf([{ type: 'done' }]) } as any;

    const result = await emitJobFinalSummary(baseInput({ chatAPI: api, llm, promptPort }));

    expect(result).toContain('Completed 1 task');
  });

  it('uses the fallback when no llm/promptPort is available', async () => {
    const { api, texts } = mockChatAPI();
    const result = await emitJobFinalSummary(
      baseInput({
        chatAPI: api,
        completedTasks: [
          { name: 'A', type: 'feature' },
          { name: 'B', type: 'error' },
        ],
        touched: { created: ['x.ts'], edited: ['y.ts', 'z.ts'], deleted: [] },
        unresolved: ['Verify: build still failing on CI'],
      }),
    );

    expect(result).toContain('Completed 2 tasks:');
    expect(result).toContain('- [feature] A');
    expect(texts.join('')).toContain('created 1, edited 2, deleted 0');
    expect(result).toContain('Unresolved:');
  });

  it('skips entirely when there are no completed tasks', async () => {
    const { api, calls } = mockChatAPI();
    const result = await emitJobFinalSummary(baseInput({ chatAPI: api, completedTasks: [] }));
    expect(result).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it('never throws — even when the chat transport itself fails', async () => {
    const api: JobSummaryChatAPI = {
      startMessage: vi.fn(async () => { throw new Error('transport down'); }),
      sendLLMEvent: vi.fn(),
      finalizeMessage: vi.fn(),
    };
    const result = await emitJobFinalSummary(baseInput({ chatAPI: api }));
    expect(result).toBeUndefined();
  });
});

describe('harvestTaskProse', () => {
  it('collects task_response card bodies and assistant messages, capped', async () => {
    const long = 'x'.repeat(2000);
    const session = {
      loadChatByTurnIds: vi.fn(async () => [
        { type: 'chat_status', statusType: 'task_response', metadata: { content: 'Reply A' } },
        { type: 'assistant_message', text: long },
        { type: 'chat_status', statusType: 'learned', metadata: { content: 'noise' } },
      ]),
    } as any;

    const prose = await harvestTaskProse(session, 'turn-1');
    expect(prose).toHaveLength(2);
    expect(prose[0]).toBe('Reply A');
    expect(prose[1].length).toBeLessThanOrEqual(1601); // cap + ellipsis
  });

  it('returns [] without session or turnId, and on load failure', async () => {
    expect(await harvestTaskProse(undefined, 'turn-1')).toEqual([]);
    expect(await harvestTaskProse({} as any, undefined)).toEqual([]);
    const failing = { loadChatByTurnIds: vi.fn(async () => { throw new Error('io'); }) } as any;
    expect(await harvestTaskProse(failing, 'turn-1')).toEqual([]);
  });
});
