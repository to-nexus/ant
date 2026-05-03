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
import { FileRegistry } from '../../src/core/streaming/state/FileRegistry';
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
    await strategy.render(replyAction, new FileRegistry());
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

    const reg = new FileRegistry();
    await strategy.render(
      { type: 'response', data: { content: '<rep' } },
      reg,
    );
    await strategy.render(
      { type: 'response', data: { content: 'ly>Hello.</reply>' } },
      reg,
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
      new FileRegistry(),
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
    const reg = new FileRegistry();

    await strategy.render({ type: 'plan_start', data: {} } as ParsedAction, reg);
    await strategy.render(
      {
        type: 'plan_content',
        data: { content: '{"task":"x", "leak":"<reply>nope</reply>"}' },
      } as ParsedAction,
      reg,
    );
    await strategy.render({ type: 'plan_end', data: {} } as ParsedAction, reg);

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
    const reg = new FileRegistry();

    const validBody = '{"task":{"id":"t","goal":"g"}}';
    await strategy.render({ type: 'plan_start', data: {} } as ParsedAction, reg);
    await strategy.render(
      { type: 'plan_content', data: { content: validBody } } as ParsedAction,
      reg,
    );
    await strategy.render({ type: 'plan_end', data: {} } as ParsedAction, reg);

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
    // Disk write happens via FileSystemPort upstream; this surface test
    // only proves the chat-card payload has been scrubbed before it
    // reaches the projector. The disk-vs-card separation is locked by
    // the FileRenderer call shape: `fileSystem.writeFile(fsPath, raw)`
    // happens before `chatAPI.completeFileCreation(filePath, stripped)`,
    // and the registry helper `stripRegisteredTags` is the SSOT for the
    // stripped form.
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
      new FileRegistry(),
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
