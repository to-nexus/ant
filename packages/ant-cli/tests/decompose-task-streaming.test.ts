import { describe, it, expect, vi, beforeAll } from 'vitest';
import { XMLStreamParser } from '../src/core/streaming/parsers/XMLStreamParser';
import { StreamState } from '../src/core/streaming/state/StreamState';
import type { LLMStreamEvent } from '../src/core/ports/llm';
import type { ParsedAction } from '../src/core/streaming/types';

/**
 * Streaming coverage for the per-`<task>` decompose contract.
 *
 * The decompose prompt emits each task as a `<task>{json}</task>` element
 * inside `<tasks>`. The XMLStreamParser must surface each one as a
 * `task_added` action so the decompose llmCaller can broadcast partial
 * Kanban updates one task at a time. Existing `<tasks>` chat suppression
 * (no UI emission) is preserved.
 */

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const textEvent = (text: string): LLMStreamEvent => ({ type: 'text', text });

/**
 * Drive the parser by feeding the source one chunk at a time and
 * collecting every action it emits. A custom chunk size lets us mimic
 * the LLM streaming character-by-character (worst case for tag boundary
 * straddling) or in larger blocks.
 */
function streamChunks(source: string, chunkSize = 1): ParsedAction[] {
  const parser = new XMLStreamParser();
  const state = new StreamState();
  const collected: ParsedAction[] = [];
  for (let i = 0; i < source.length; i += chunkSize) {
    const chunk = source.slice(i, Math.min(i + chunkSize, source.length));
    collected.push(...parser.parse(textEvent(chunk), state));
  }
  collected.push(...parser.finalize());
  return collected;
}

describe('XMLStreamParser — <task> per-item streaming', () => {
  const TASKS_BLOCK = `<tasks>
<task>{"id":"setup","name":"Setup","type":"setup","priority":100,"packages":["shared"],"exclusive":true,"description":"init"}</task>
<task>{"id":"feat","name":"Feat","type":"feature","priority":300,"packages":["shared"],"description":"work"}</task>
<task>{"id":"verify","name":"Verify","type":"verification","priority":1000,"packages":["shared"],"exclusive":true,"description":"gates"}</task>
</tasks>`;

  it('emits one task_added action per <task> element (single chunk)', () => {
    const actions = streamChunks(TASKS_BLOCK, TASKS_BLOCK.length);
    const tasks = actions.filter(a => a.type === 'task_added');
    expect(tasks).toHaveLength(3);

    const ids = tasks.map(a => JSON.parse(a.data.rawJson!).id);
    expect(ids).toEqual(['setup', 'feat', 'verify']);
  });

  it('emits one task_added action per <task> element (1-char streaming)', () => {
    // Worst case: every character arrives in its own chunk so every tag
    // boundary straddles. The lookahead in §11c / §13 must hold back the
    // partial close so no `<task>` / `</task>` is missed.
    const actions = streamChunks(TASKS_BLOCK, 1);
    const tasks = actions.filter(a => a.type === 'task_added');
    expect(tasks).toHaveLength(3);

    const names = tasks.map(a => JSON.parse(a.data.rawJson!).name);
    expect(names).toEqual(['Setup', 'Feat', 'Verify']);
  });

  it('does NOT emit any response action for <tasks> body (chat suppression preserved)', () => {
    const actions = streamChunks(TASKS_BLOCK, 4);
    const responses = actions.filter(a => a.type === 'response');
    // The `<tasks>` block itself is suppressed entirely. Any response
    // actions emitted would mean the per-task JSON is leaking into chat
    // text, which would defeat the Kanban-only rendering rule.
    const responseText = responses.map(r => r.data.content || '').join('');
    expect(responseText).not.toContain('"id"');
    expect(responseText).not.toContain('<task>');
  });

  it('drops a partial <task> on stream end (no malformed task_added)', () => {
    // LLM was cut off mid-element. The parser must NOT emit a
    // `task_added` for the unfinished `<task>` — partial JSON would
    // corrupt the Kanban broadcast and the final parseLLMResponse will
    // throw at end-of-stream which the retry loop handles.
    const partial =
      '<tasks><task>{"id":"a","name":"A","type":"feature","priority":300,"packages":["shared"]}</task><task>{"id":"b","name":"B","type":"feat';
    const actions = streamChunks(partial, 7);
    const tasks = actions.filter(a => a.type === 'task_added');
    expect(tasks).toHaveLength(1);
    expect(JSON.parse(tasks[0].data.rawJson!).id).toBe('a');
  });

  it('handles empty <tasks></tasks> with no task_added emissions', () => {
    const empty = '<tasks></tasks>';
    const actions = streamChunks(empty, 3);
    const tasks = actions.filter(a => a.type === 'task_added');
    expect(tasks).toHaveLength(0);
  });

  it('handles legacy JSON-array <tasks> body without emitting task_added (BC for chat suppression)', () => {
    // The legacy JSON-array contract is still understood by the
    // post-stream `parseLLMResponse` (BC fallback). But it does NOT
    // produce per-task streaming events — the LLM has to use the
    // current `<task>` wrapper format to get progressive Kanban
    // updates. The streaming parser still suppresses the body from
    // chat though, so legacy responses do not leak JSON into the UI.
    const legacy = '<tasks>[{"id":"a","name":"A","type":"feature","priority":300,"packages":["shared"]}]</tasks>';
    const actions = streamChunks(legacy, 5);
    const tasks = actions.filter(a => a.type === 'task_added');
    expect(tasks).toHaveLength(0);

    const responses = actions.filter(a => a.type === 'response');
    const responseText = responses.map(r => r.data.content || '').join('');
    expect(responseText).not.toContain('"id"');
  });
});
