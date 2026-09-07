/**
 * Tag Leak Surface — regression lock for every chat surface that can
 * receive an LLM-emitted canonical tag.
 *
 * Each surface owns its own buffer-and-strip rule (parallel
 * `task_response`, `plan` card metadata, file-card metadata, thinking
 * stream, `assistant_message` flush). This file pins the contract that
 * a `<reply>...</reply>` body never reaches the persisted card content
 * as a raw `<…>` marker — and exercises a few "LLM violated the
 * cross-axis nesting rule" scenarios so the dev-warn / strip path is
 * locked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  stripRegisteredTags,
  transformAndStrip,
  detectCrossAxisLeak,
} from '../../src/core/streaming/OutputTagRegistry';
import { CommonRenderStrategy } from '../../src/core/streaming/strategies/CommonRenderStrategy';
import type { ParsedAction } from '../../src/core/streaming/types';

// ────────────────────────────────────────────────────────────────────────────
// ChatAPI fake — captures every call so each surface assertion can read
// what landed on the persisted line.
// ────────────────────────────────────────────────────────────────────────────

function makeChatAPIFake() {
  const calls: { method: string; args: any[] }[] = [];
  const handle = (method: string) => async (...args: any[]) => {
    calls.push({ method, args });
    if (method === 'showChatStatus') return `card-${calls.length}`;
    return undefined;
  };
  const fake = {
    showChatStatus: vi.fn(handle('showChatStatus')),
    streamTaskResponseChunk: vi.fn(handle('streamTaskResponseChunk')),
    streamPlanChunk: vi.fn(handle('streamPlanChunk')),
    completeFileCreation: vi.fn(handle('completeFileCreation')),
    failFileCreation: vi.fn(handle('failFileCreation')),
    completeFileEdit: vi.fn(handle('completeFileEdit')),
    streamFileContent: vi.fn(handle('streamFileContent')),
    streamFileDiff: vi.fn(handle('streamFileDiff')),
    startFileEdit: vi.fn(handle('startFileEdit')),
    sendLLMEvent: vi.fn(handle('sendLLMEvent')),
    finalizeMessage: vi.fn(handle('finalizeMessage')),
  };
  return { fake: fake as unknown as any, calls };
}

function findCalls(
  calls: { method: string; args: any[] }[],
  method: string,
  filter?: (args: any[]) => boolean,
) {
  return calls
    .filter((c) => c.method === method)
    .filter((c) => (filter ? filter(c.args) : true));
}

// ────────────────────────────────────────────────────────────────────────────
// Helper-level lock (covers the SSOT used by every surface)
// ────────────────────────────────────────────────────────────────────────────

describe('detectCrossAxisLeak', () => {
  it('flags a narrative tag inside an artifact body', () => {
    const violators = detectCrossAxisLeak(
      'spec body <reply>oops</reply> trailer',
      'artifact',
    );
    expect(violators).toContain('reply');
  });

  it('flags multiple cross-axis tags at once', () => {
    const violators = detectCrossAxisLeak(
      '<reply>x</reply> ... <done>true</done>',
      'artifact',
    );
    expect(violators).toContain('reply');
    expect(violators).toContain('done');
  });

  it('returns empty when content stays within the host axis', () => {
    expect(
      detectCrossAxisLeak('plain markdown body', 'artifact'),
    ).toEqual([]);
  });

  it('does NOT flag a same-axis tag (artifact body referencing another artifact tag)', () => {
    // <plan> is artifact-axis; finding it inside an artifact body is
    // legitimate (e.g. file body that documents the JSON shape).
    const violators = detectCrossAxisLeak(
      'see <plan>{"task":"…"}</plan>',
      'artifact',
    );
    expect(violators).not.toContain('plan');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Surface A — parallel task_response card
// ────────────────────────────────────────────────────────────────────────────

describe('Surface A — parallel task_response card', () => {
  it('renders <reply> body verbatim into terminal task_response metadata.content', async () => {
    const { fake, calls } = makeChatAPIFake();
    const strategy = new CommonRenderStrategy(fake, 'en');
    strategy.setParallelTaskName('worker-task');

    const replyAction: ParsedAction = {
      type: 'response',
      data: { content: '<reply>Hello, world.</reply>' },
    };
    await strategy.render(replyAction);
    await strategy.finalize(true);

    const terminal = findCalls(
      calls,
      'showChatStatus',
      (args) => args[0] === 'task_response',
    );
    expect(terminal).toHaveLength(1);
    const meta = terminal[0].args[1] as { content: string };
    expect(meta.content).not.toMatch(/<reply>/);
    expect(meta.content).toBe('Hello, world.');
  });

  it('survives a chunk-split <reply> across two response actions', async () => {
    const { fake, calls } = makeChatAPIFake();
    const strategy = new CommonRenderStrategy(fake, 'en');
    strategy.setParallelTaskName('worker-task');

    await strategy.render(
      { type: 'response', data: { content: '<rep' } },
    );
    await strategy.render(
      { type: 'response', data: { content: 'ly>Hello.</reply>' } },
    );
    await strategy.finalize(true);

    const terminal = findCalls(
      calls,
      'showChatStatus',
      (args) => args[0] === 'task_response',
    );
    expect(terminal).toHaveLength(1);
    const meta = terminal[0].args[1] as { content: string };
    expect(meta.content).not.toMatch(/<reply>|<\/reply>/);
    expect(meta.content).toBe('Hello.');
  });

  it('preserves text outside any tag (free narrative still surfaces)', async () => {
    const { fake, calls } = makeChatAPIFake();
    const strategy = new CommonRenderStrategy(fake, 'en');
    strategy.setParallelTaskName('worker-task');

    await strategy.render(
      {
        type: 'response',
        data: { content: 'context here <reply>answer</reply> trailer' },
      },
    );
    await strategy.finalize(true);

    const terminal = findCalls(
      calls,
      'showChatStatus',
      (args) => args[0] === 'task_response',
    );
    const meta = terminal[0].args[1] as { content: string };
    expect(meta.content).toContain('context here');
    expect(meta.content).toContain('answer');
    expect(meta.content).toContain('trailer');
    expect(meta.content).not.toMatch(/<reply>/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Surface B — plan_end metadata
// ────────────────────────────────────────────────────────────────────────────

describe('Surface B — plan card metadata', () => {
  it('strips a contract-violating nested <reply> from terminal plan metadata.content', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fake, calls } = makeChatAPIFake();
    const strategy = new CommonRenderStrategy(fake, 'en');

    await strategy.render({ type: 'plan_start', data: {} } as ParsedAction);
    await strategy.render(
      {
        type: 'plan_content',
        data: { content: '{"task":"x", "leak":"<reply>nope</reply>"}' },
      } as ParsedAction,
    );
    await strategy.render({ type: 'plan_end', data: {} } as ParsedAction);

    const planTerminal = findCalls(
      calls,
      'showChatStatus',
      (args) => args[0] === 'plan',
    );
    expect(planTerminal).toHaveLength(1);
    const meta = planTerminal[0].args[1] as { content: string };
    expect(meta.content).not.toMatch(/<reply>/);

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('is a no-op on a well-formed plan body (no warn, no diff)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fake, calls } = makeChatAPIFake();
    const strategy = new CommonRenderStrategy(fake, 'en');

    const validBody = '{"task":{"id":"t","goal":"g"}}';
    await strategy.render({ type: 'plan_start', data: {} } as ParsedAction);
    await strategy.render(
      { type: 'plan_content', data: { content: validBody } } as ParsedAction,
    );
    await strategy.render({ type: 'plan_end', data: {} } as ParsedAction);

    const planTerminal = findCalls(
      calls,
      'showChatStatus',
      (args) => args[0] === 'plan',
    );
    const meta = planTerminal[0].args[1] as { content: string };
    expect(meta.content).toBe(validBody);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Surface C — file card metadata (disk truth source preserved)
// ────────────────────────────────────────────────────────────────────────────

describe('Surface C — file card metadata vs disk', () => {
  it('strips nested <reply> from completeFileCreation card metadata while leaving disk content untouched', () => {
    // Disk write happens via the file tool handlers upstream; this surface
    // test only proves the chat-card payload has been scrubbed before it
    // reaches the projector. The disk write happens before
    // `chatAPI.completeFileCreation(filePath, stripped)`, and the registry
    // helper `stripRegisteredTags` is the SSOT for the stripped form.
    const raw = '# Spec\n\nbody <reply>chat-only</reply> body\n';
    expect(stripRegisteredTags(raw)).toBe('# Spec\n\nbody  body\n');
    expect(stripRegisteredTags(raw)).not.toMatch(/<reply>/);
  });

  it('leaves a tag-free file body unchanged', () => {
    const raw = '# Spec\n\nplain markdown body\n';
    expect(stripRegisteredTags(raw)).toBe(raw);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Surface D — thinking stream
// ────────────────────────────────────────────────────────────────────────────

describe('Surface D — thinking stream', () => {
  it('strips a complete <reply> tag from thinking chunks before they reach the chat surface', async () => {
    const { fake, calls } = makeChatAPIFake();
    const strategy = new CommonRenderStrategy(fake, 'en');

    await strategy.render(
      {
        type: 'thinking',
        data: {
          content: 'I will draft <reply>answer</reply> next',
          blockStart: false,
          blockEnd: false,
        },
      } as ParsedAction,
    );

    const thinkingEvents = findCalls(
      calls,
      'sendLLMEvent',
      (args) => args[0]?.type === 'thinking',
    );
    expect(thinkingEvents.length).toBeGreaterThan(0);
    const text = thinkingEvents[0].args[0].thinking as string;
    expect(text).not.toMatch(/<reply>|<\/reply>/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Surface E — assistant_message flush (covered indirectly by helper)
// ────────────────────────────────────────────────────────────────────────────

describe('Surface E — assistant_message flush helper', () => {
  it('transformAndStrip renders complete <reply> body', () => {
    const out = transformAndStrip(
      'pre <reply>bodied</reply> post',
      'en',
    );
    expect(out).toBe('pre bodied post');
  });

  it('transformAndStrip strips suppressed-axis tags', () => {
    const out = transformAndStrip(
      '<techTier>{}</techTier>final answer',
      'en',
    );
    expect(out).toBe('final answer');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Surface F — live streaming delta (suppressed-tag hold-back)
//
// `SpecialTagTransformer` is single-shot per chunk, so before the gate a
// suppressed block split across chunks reached `sendLLMEvent` as raw text
// and was published as a `streaming_delta` (the durable line stayed clean
// because the flush path re-runs `transformAndStrip`). These rows pin that
// the live channel is now chunk-independent.
// ────────────────────────────────────────────────────────────────────────────

describe('Surface F — streaming delta hold-back', () => {
  function textOf(calls: { method: string; args: any[] }[]): string {
    return findCalls(calls, 'sendLLMEvent', (args) => args[0]?.type === 'text')
      .map((c) => c.args[0].text as string)
      .join('');
  }

  async function feedChunks(
    strategy: CommonRenderStrategy,
    chunks: string[],
  ): Promise<void> {
    for (const content of chunks) {
      await strategy.render({ type: 'response', data: { content } } as ParsedAction);
    }
  }

  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('drops a <checklist> block split across chunks and keeps the surrounding prose', async () => {
    const { fake, calls } = makeChatAPIFake();
    const strategy = new CommonRenderStrategy(fake, 'en');

    await feedChunks(strategy, [
      'Here is the plan.\n',
      '<checklist plan="plan/p.md">\n',
      '- [ ] first\n- [ ] second\n',
      '</checklist>\nNow starting.\n',
    ]);

    const text = textOf(calls);
    expect(text).not.toMatch(/<\/?checklist/);
    expect(text).toContain('Here is the plan.');
    expect(text).toContain('Now starting.');
    expect(text).not.toContain('- [ ] first');
  });

  it('withholds a chunk-final partial opener until the delimiter completes', async () => {
    const { fake, calls } = makeChatAPIFake();
    const strategy = new CommonRenderStrategy(fake, 'en');

    // The parser's own `/<[a-z]*$/` hold-back does not cover an
    // attribute-bearing fragment, so the gate must.
    await feedChunks(strategy, [
      'Intro line.\n<checklist plan="plan/p',
      '.md">\n- [ ] only\n</checklist>\nDone.',
    ]);

    const text = textOf(calls);
    expect(text).not.toMatch(/<\/?checklist/);
    expect(text).not.toContain('plan/p');
    expect(text).toContain('Intro line.');
    expect(text).toContain('Done.');
  });

  it('is generic over the registry — a split <analysis> block is held too', async () => {
    const { fake, calls } = makeChatAPIFake();
    const strategy = new CommonRenderStrategy(fake, 'en');

    await feedChunks(strategy, [
      '<analysis>\nroot cause reasoning\n',
      '</analysis>\nverdict text',
    ]);

    const text = textOf(calls);
    expect(text).not.toMatch(/<\/?analysis/);
    expect(text).not.toContain('root cause reasoning');
    expect(text).toContain('verdict text');
  });

  it('degrades an unterminated suppressed tag to marker-stripped prose at finalize', async () => {
    const { fake, calls } = makeChatAPIFake();
    const strategy = new CommonRenderStrategy(fake, 'en');

    await feedChunks(strategy, ['<checklist plan="plan/p.md">\n- [ ] a\nStill talking.\n']);
    expect(textOf(calls)).toBe('');

    await strategy.finalize(true);

    const text = textOf(calls);
    expect(text).not.toMatch(/<\/?checklist/);
    expect(text).toContain('Still talking.');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('drops a bodyless suppressed marker without waiting for a close', async () => {
    const { fake, calls } = makeChatAPIFake();
    const strategy = new CommonRenderStrategy(fake, 'en');

    // `<plan-unchanged/>` and `<eval type="…"/>` have no closing
    // delimiter. Holding for one would swallow the rest of the round, so
    // the trailing prose must be emitted WITHOUT a finalize().
    await feedChunks(strategy, [
      'Report received. ',
      '<plan-unchanged/>',
      '\nKeeping the sealed plan.',
      '<eval type="rubric-a"/>',
      ' Wrapping up.',
    ]);

    const text = textOf(calls);
    expect(text).not.toMatch(/<plan-unchanged|<eval/);
    expect(text).toContain('Report received.');
    expect(text).toContain('Keeping the sealed plan.');
    expect(text).toContain('Wrapping up.');
  });

  it('leaves a non-suppressed tag on its existing transformer path', async () => {
    const { fake, calls } = makeChatAPIFake();
    const strategy = new CommonRenderStrategy(fake, 'en');

    await feedChunks(strategy, ['<reply>the answer</reply>']);

    const text = textOf(calls);
    expect(text).not.toMatch(/<\/?reply>/);
    expect(text).toContain('the answer');
  });

  it('reset() drops withheld state so a retry does not inherit it', async () => {
    const { fake, calls } = makeChatAPIFake();
    const strategy = new CommonRenderStrategy(fake, 'en');

    await feedChunks(strategy, ['<checklist plan="plan/p.md">\n- [ ] a\n']);
    strategy.reset();
    await feedChunks(strategy, ['fresh stream text']);
    await strategy.finalize(true);

    const text = textOf(calls);
    expect(text).toBe('fresh stream text');
    expect(text).not.toContain('- [ ] a');
  });
});
