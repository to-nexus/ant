/**
 * Duplicate-read elision + already-read manifest.
 *
 * Models across providers re-request read_file for content already verbatim
 * in history (prime-nesting-grate RCA follow-up: deepseek 155 / sonnet-5 71
 * exact-dup reads per job), bloating history and burning rounds. The tool
 * node now (a) replaces a re-read's IDENTICAL body with a stub
 * (execute-then-compare — staleness-proof against run_command / parallel
 * workers), and (b) appends a compact already-read manifest when it changes.
 *
 * Locks:
 *   - identical (path, range) re-read → stub; body not re-accumulated
 *   - different range of the same path → NOT elided (range-aware keying)
 *   - changed content → NOT elided (comparison is against actual new content)
 *   - edit_file invalidates → subsequent identical re-read NOT elided
 *   - orchestrator cache-hit prefix normalized before comparing
 *   - stubs are skipped by extractLatestReadContent (compaction never
 *     resurrects a stub as file content)
 *   - manifest lists path+range only (no bodies), appended only on change
 */
import { describe, it, expect } from 'vitest';
import {
  extractLatestReadContent,
  buildDuplicateReadStub,
  isDuplicateReadStub,
  buildAlreadyReadManifest,
} from '../../src/core/context';
import type { ConversationMessage } from '../../src/core/context';
import type { MessageContentBlock, ToolResultContentBlock } from '../../src/core/ports/llm';
import {
  elideDuplicateReads,
  buildManifestBlockIfChanged,
} from '../../src/agents/common/tool/duplicateReadElision';
import { CACHED_RESULT_PREFIX } from '../../src/agents/common/tool/orchestrator';
import type { ToolCall } from '../../src/agents/common/tool/types';

const FILE_BODY = 'export const engine = () => {\n  // ...\n};\n';

function readPair(id: string, path: string, content: string, range?: { s: number; e: number }): ConversationMessage[] {
  const input: Record<string, any> = { path };
  if (range) { input.startLine = range.s; input.endLine = range.e; }
  return [
    { role: 'assistant', content: [{ type: 'tool_use', id, name: 'read_file', input }] as MessageContentBlock[] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, tool_name: 'read_file', content }] as MessageContentBlock[] },
  ];
}

function editPair(id: string, path: string): ConversationMessage[] {
  return [
    { role: 'assistant', content: [{ type: 'tool_use', id, name: 'edit_file', input: { path } }] as MessageContentBlock[] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, tool_name: 'edit_file', content: `[file edited: ${path}]` }] as MessageContentBlock[] },
  ];
}

function readCall(id: string, path: string, range?: { s: number; e: number }): ToolCall {
  const args: Record<string, any> = { path };
  if (range) { args.startLine = range.s; args.endLine = range.e; }
  return { id, name: 'read_file', args };
}

function resultBlock(id: string, content: string): ToolResultContentBlock {
  return { type: 'tool_result', tool_use_id: id, tool_name: 'read_file', content };
}

describe('elideDuplicateReads', () => {
  it('replaces an identical whole-file re-read with a stub', () => {
    const history = readPair('r1', 'src/engine.ts', FILE_BODY);
    const { blocks, elided } = elideDuplicateReads(
      [readCall('r2', 'src/engine.ts')],
      history,
      [resultBlock('r2', FILE_BODY)],
    );

    expect(elided).toHaveLength(1);
    expect(elided[0].path).toBe('src/engine.ts');
    expect(typeof blocks[0].content).toBe('string');
    expect(isDuplicateReadStub(blocks[0].content as string)).toBe(true);
    expect((blocks[0].content as string).includes(FILE_BODY)).toBe(false);
  });

  it('does NOT elide a different range of the same path (range-aware keying)', () => {
    const history = readPair('r1', 'src/engine.ts', FILE_BODY); // whole-file
    const { blocks, elided } = elideDuplicateReads(
      [readCall('r2', 'src/engine.ts', { s: 1, e: 2 })],
      history,
      [resultBlock('r2', 'export const engine = () => {\n  // ...')],
    );

    expect(elided).toHaveLength(0);
    expect(isDuplicateReadStub(blocks[0].content as string)).toBe(false);
  });

  it('elides an identical same-range re-read', () => {
    const chunk = 'lines 10-20 content';
    const history = readPair('r1', 'src/engine.ts', chunk, { s: 10, e: 20 });
    const { elided } = elideDuplicateReads(
      [readCall('r2', 'src/engine.ts', { s: 10, e: 20 })],
      history,
      [resultBlock('r2', chunk)],
    );
    expect(elided).toHaveLength(1);
  });

  it('does NOT elide when the new content differs (out-of-band mutation)', () => {
    const history = readPair('r1', 'src/engine.ts', FILE_BODY);
    const mutated = FILE_BODY + '\n// mutated by another worker';
    const { blocks, elided } = elideDuplicateReads(
      [readCall('r2', 'src/engine.ts')],
      history,
      [resultBlock('r2', mutated)],
    );

    expect(elided).toHaveLength(0);
    expect(blocks[0].content).toBe(mutated);
  });

  it('does NOT elide after edit_file invalidated the path — even with identical content', () => {
    const history = [
      ...readPair('r1', 'src/engine.ts', FILE_BODY),
      ...editPair('e1', 'src/engine.ts'),
    ];
    const { elided } = elideDuplicateReads(
      [readCall('r2', 'src/engine.ts')],
      history,
      [resultBlock('r2', FILE_BODY)],
    );
    expect(elided).toHaveLength(0);
  });

  it('normalizes the orchestrator cache-hit prefix before comparing', () => {
    const history = readPair('r1', 'src/engine.ts', FILE_BODY);
    const { elided } = elideDuplicateReads(
      [readCall('r2', 'src/engine.ts')],
      history,
      [resultBlock('r2', `${CACHED_RESULT_PREFIX}${FILE_BODY}`)],
    );
    expect(elided).toHaveLength(1);
  });

  it('leaves error results untouched', () => {
    const history = readPair('r1', 'src/missing.ts', 'Error: ENOENT');
    const { elided } = elideDuplicateReads(
      [readCall('r2', 'src/missing.ts')],
      history,
      [resultBlock('r2', 'Error: ENOENT')],
    );
    expect(elided).toHaveLength(0);
  });
});

describe('extractLatestReadContent — stub skipping', () => {
  it('a stub never overwrites the preserved original body', () => {
    const stub = buildDuplicateReadStub('src/engine.ts', '');
    const history = [
      ...readPair('r1', 'src/engine.ts', FILE_BODY),
      ...readPair('r2', 'src/engine.ts', stub), // elided re-read persisted as stub
    ];

    const preserved = extractLatestReadContent(history);
    const entry = [...preserved.values()].find(p => p.path === 'src/engine.ts');
    expect(entry?.content).toBe(FILE_BODY);
  });
});

describe('already-read manifest', () => {
  it('lists path+range only — no file bodies', () => {
    const history = [
      ...readPair('r1', 'src/engine.ts', FILE_BODY),
      ...readPair('r2', 'src/tokens.ts', 'token body', { s: 5, e: 9 }),
    ];
    const manifest = buildAlreadyReadManifest(extractLatestReadContent(history));

    expect(manifest).toContain('src/engine.ts');
    expect(manifest).toContain('src/tokens.ts (lines 5-9)');
    expect(manifest).not.toContain(FILE_BODY);
    expect(manifest).not.toContain('token body');
    expect(manifest).toContain('Do NOT call read_file again');
  });

  it('buildManifestBlockIfChanged: appended on a new read, null when unchanged', () => {
    const history = readPair('r1', 'src/engine.ts', FILE_BODY);

    // New read this batch → manifest changed → block appended.
    const newRead = [
      { type: 'tool_use', id: 'r2', name: 'read_file', input: { path: 'src/tokens.ts' } },
    ];
    // tool_use lives in the assistant turn (already in baseHistory by contract);
    // simulate it plus the new result blocks.
    const baseWithUse: ConversationMessage[] = [
      ...history,
      { role: 'assistant', content: newRead as MessageContentBlock[] },
    ];
    const changed = buildManifestBlockIfChanged(baseWithUse, [resultBlock('r2', 'token body')] as MessageContentBlock[]);
    expect(changed).not.toBeNull();
    expect(changed!.text).toContain('src/tokens.ts');

    // Dup-only batch (stub persisted) → extraction skips stub → unchanged → null.
    const stubbed = buildDuplicateReadStub('src/engine.ts', '');
    const baseWithDupUse: ConversationMessage[] = [
      ...history,
      { role: 'assistant', content: [{ type: 'tool_use', id: 'r3', name: 'read_file', input: { path: 'src/engine.ts' } }] as MessageContentBlock[] },
    ];
    const unchanged = buildManifestBlockIfChanged(baseWithDupUse, [resultBlock('r3', stubbed)] as MessageContentBlock[]);
    expect(unchanged).toBeNull();
  });

  it('an edit updates the manifest (entries invalidated)', () => {
    const history = [
      ...readPair('r1', 'src/engine.ts', FILE_BODY),
      ...readPair('r2', 'src/tokens.ts', 'token body'),
    ];
    const baseWithEditUse: ConversationMessage[] = [
      ...history,
      { role: 'assistant', content: [{ type: 'tool_use', id: 'e1', name: 'edit_file', input: { path: 'src/engine.ts' } }] as MessageContentBlock[] },
    ];
    const block = buildManifestBlockIfChanged(
      baseWithEditUse,
      [{ type: 'tool_result', tool_use_id: 'e1', tool_name: 'edit_file', content: '[file edited: src/engine.ts]' }] as MessageContentBlock[],
    );
    expect(block).not.toBeNull();
    expect(block!.text).not.toContain('src/engine.ts');
    expect(block!.text).toContain('src/tokens.ts');
  });
});
