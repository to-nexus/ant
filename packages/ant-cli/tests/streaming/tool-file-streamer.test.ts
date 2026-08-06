/**
 * ToolFileStreamer — live rendering of file-writing tool calls.
 *
 * Locks the tool-channel live-card contract (§2 render matrix parity):
 *  - path parsed → startFileCreation shell opens (create/append) or
 *    startFileEdit (edit_file)
 *  - content deltas → line-buffered streamFileContent / streamFileDiff
 *  - terminal tool_use → remaining partial line flushed; NO terminal card
 *    from the streamer (handler settles it)
 *  - max_tokens truncation → getOpenToolFile() salvage context
 *  - non-file tools / Tier-B (no deltas) → inert
 */

import { describe, it, expect } from 'vitest';
import { ToolFileStreamer, type ToolFileStreamSink } from '../../src/core/streaming/ToolFileStreamer';
import type { LLMStreamEvent } from '../../src/core/ports/llm';

function makeSink() {
  const calls: Array<{ method: string; args: any[] }> = [];
  const sink: ToolFileStreamSink = {
    async startFileCreation(path) { calls.push({ method: 'startFileCreation', args: [path] }); },
    async streamFileContent(path, content) { calls.push({ method: 'streamFileContent', args: [path, content] }); },
    async startFileEdit(path) { calls.push({ method: 'startFileEdit', args: [path] }); },
    async streamFileDiff(path, before, after) { calls.push({ method: 'streamFileDiff', args: [path, before, after] }); },
  };
  return { sink, calls };
}

function delta(toolUseId: string, name: string, partialInput: string): LLMStreamEvent {
  return { type: 'tool_use_delta', toolUseDelta: { toolUseId, name, partialInput } };
}

function terminal(id: string, name: string, input: Record<string, any>): LLMStreamEvent {
  return { type: 'tool_use', toolUse: { id, name, input } };
}

describe('ToolFileStreamer', () => {
  it('create_file: opens shell on path, streams line-buffered content, flushes tail on terminal', async () => {
    const { sink, calls } = makeSink();
    const s = new ToolFileStreamer(sink);
    const json = JSON.stringify({ path: 'codebase/src/a.ts', content: 'line1\nline2\ntail-no-newline' });

    for (let i = 0; i < json.length; i += 9) s.handleEvent(delta('t1', 'create_file', json.slice(i, i + 9)));
    s.handleEvent(terminal('t1', 'create_file', JSON.parse(json)));
    await s.settle();

    expect(calls[0]).toEqual({ method: 'startFileCreation', args: ['codebase/src/a.ts'] });
    const streamed = calls.filter(c => c.method === 'streamFileContent').map(c => c.args[1]).join('');
    expect(streamed).toBe('line1\nline2\ntail-no-newline');
    expect(s.getOpenToolFile()).toBeNull(); // completed → no salvage context
    expect(s.getStreamedPaths()).toEqual(['codebase/src/a.ts']);
  });

  it('edit_file: opens edit shell and streams new_str into the diff-after channel', async () => {
    const { sink, calls } = makeSink();
    const s = new ToolFileStreamer(sink);
    const json = JSON.stringify({ path: 'codebase/b.ts', old_str: 'const x = 1;', new_str: 'const x = 2;\n// done' });

    for (let i = 0; i < json.length; i += 5) s.handleEvent(delta('t2', 'edit_file', json.slice(i, i + 5)));
    s.handleEvent(terminal('t2', 'edit_file', JSON.parse(json)));
    await s.settle();

    expect(calls[0]).toEqual({ method: 'startFileEdit', args: ['codebase/b.ts'] });
    const after = calls.filter(c => c.method === 'streamFileDiff').map(c => c.args[2]).join('');
    expect(after).toBe('const x = 2;\n// done');
    // old_str never streams — it renders terminally in the red block.
    expect(calls.every(c => c.method !== 'streamFileContent')).toBe(true);
  });

  it('max_tokens truncation: exposes salvage context with path + content prefix + tail', async () => {
    const { sink } = makeSink();
    const s = new ToolFileStreamer(sink);
    s.handleEvent(delta('t3', 'create_file', '{"path":"visual/ui/spec.md","content":"# Title\\nBody part'));
    // No terminal tool_use — stream died on max_tokens.
    await s.settle();

    const open = s.getOpenToolFile();
    expect(open).not.toBeNull();
    expect(open!.toolName).toBe('create_file');
    expect(open!.path).toBe('visual/ui/spec.md');
    expect(open!.contentSoFar).toBe('# Title\nBody part');
    expect(open!.tailContent.endsWith('Body part')).toBe(true);
  });

  it('non-file tools and Tier-B (no deltas) stay inert', async () => {
    const { sink, calls } = makeSink();
    const s = new ToolFileStreamer(sink);
    s.handleEvent(delta('t4', 'read_file', '{"path":"a.ts"}'));
    s.handleEvent(terminal('t5', 'create_file', { path: 'x.md', content: 'complete-only arrival' }));
    await s.settle();

    expect(calls).toEqual([]);          // read_file ignored; terminal-without-deltas ignored
    expect(s.getOpenToolFile()).toBeNull();
  });

  it('content arriving before path is buffered until the shell opens', async () => {
    const { sink, calls } = makeSink();
    const s = new ToolFileStreamer(sink);
    // Provider reordered keys: content first, then path.
    s.handleEvent(delta('t6', 'create_file', '{"content":"hello\\nworld\\n","path":"a.md"}'));
    s.handleEvent(terminal('t6', 'create_file', { content: 'hello\nworld\n', path: 'a.md' }));
    await s.settle();

    expect(calls[0]).toEqual({ method: 'startFileCreation', args: ['a.md'] });
    const streamed = calls.filter(c => c.method === 'streamFileContent').map(c => c.args[1]).join('');
    expect(streamed).toBe('hello\nworld\n');
  });
});
