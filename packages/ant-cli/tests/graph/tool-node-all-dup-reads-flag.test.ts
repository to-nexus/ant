/**
 * Tool node — `_lastToolBatchAllDupReads` signal (rocky-beating-coral RCA).
 *
 * The no-progress circuit breaker's input: an execute-phase tool batch is
 * provably zero-information when EVERY call was a successful `read_file`
 * whose body the duplicate-read elision replaced with a stub. Contracts:
 *
 *   1. UNIT — `isAllDupReadBatch` predicate: all-duplicate reads → true;
 *      a novel read, a non-read tool, an errored read, or an empty batch →
 *      false.
 *   2. FACTORY — `createToolNode` passes `elidedReads` (from
 *      `elideDuplicateReads`) into `buildReturn`, so a re-read of an
 *      already-read (path, range) whose content is unchanged reaches the
 *      code tool node's flag writer. Seeded via `getHistory` with a prior
 *      read turn (execute-then-compare: elision fires only when the NEW
 *      read's content matches the preserved prior read).
 *   3. PHASE — plan-phase batches never write the flag (production
 *      buildReturn gates on `_activePhase !== 'plan'` — locked by a static
 *      source check, mirroring the `_lastToolBatchMutatedFiles` guard).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createToolNode } from '../../src/agents/common/tool/createToolNode';
import { isAllDupReadBatch } from '../../src/agents/architect/graph/code/nodes/tool/utils/allDupReads';
import type {
  ToolExecutionContext,
  ToolResult,
} from '../../src/agents/common/tool/types';
import { ToolRegistry } from '../../src/agents/common/tool/registry';

// ─── 1. Pure predicate ───

describe('isAllDupReadBatch — predicate', () => {
  const okRead = { toolName: 'read_file', result: {} };
  const errRead = { toolName: 'read_file', result: { error: 'ENOENT' } };
  const command = { toolName: 'run_command', result: {} };

  it('true: every call a successful read AND every one elided', () => {
    expect(isAllDupReadBatch([okRead, okRead], 2)).toBe(true);
  });

  it('false: one novel (non-elided) read in the batch', () => {
    expect(isAllDupReadBatch([okRead, okRead], 1)).toBe(false);
  });

  it('false: batch contains a non-read tool', () => {
    expect(isAllDupReadBatch([okRead, command], 2)).toBe(false);
  });

  it('false: batch contains an errored read', () => {
    expect(isAllDupReadBatch([okRead, errRead], 2)).toBe(false);
  });

  it('false: empty batch', () => {
    expect(isAllDupReadBatch([], 0)).toBe(false);
  });
});

// ─── 2. Factory wiring: elidedReads reaches buildReturn ───

type State = {
  _activePhase?: 'plan' | 'execute';
  _lastToolBatchAllDupReads?: boolean;
  llmResponse?: { toolCalls: unknown[] };
  conversations?: Record<string, unknown[]>;
};

const FILE_PATH = 'codebase/src/domain/combat-resolver.test.ts';
const FILE_BODY = 'line1\nline2\nline3';

/** A prior conversation turn that already read (FILE_PATH, whole-file). */
function priorReadTurns() {
  return [
    {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'prev1', name: 'read_file', input: { path: FILE_PATH } },
      ],
    },
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'prev1', tool_name: 'read_file', content: FILE_BODY },
      ],
    },
  ];
}

function makeRegistry(result: ToolResult): ToolRegistry {
  return {
    get(_name: string) {
      return async (_ctx: ToolExecutionContext, _args: any): Promise<ToolResult> => result;
    },
    has() { return true; },
    list() { return ['read_file']; },
  } as unknown as ToolRegistry;
}

function buildNode(registry: ToolRegistry, history: any[]) {
  return createToolNode<State>({
    getPendingCalls(state) {
      return (state.llmResponse?.toolCalls ?? []) as any;
    },
    buildContext(_state): ToolExecutionContext {
      return {
        chatStatus: {
          showStatus: async () => {},
          showProgress: async () => {},
          showFigmaImage: async () => {},
          completeFileCreation: () => {},
          completeFileEdit: () => {},
          completeFileDeletion: () => {},
        },
      } as unknown as ToolExecutionContext;
    },
    registry,
    getHistory() {
      return history;
    },
    buildReturn(state, { executionEvents, elidedReads }) {
      // Mirror of the production `nodes/tool/index.ts` flag writer.
      const allDupReads = isAllDupReadBatch(executionEvents, elidedReads?.length ?? 0);
      return {
        ...(state._activePhase !== 'plan'
          ? { _lastToolBatchAllDupReads: allDupReads }
          : {}),
      };
    },
  });
}

describe('tool node — _lastToolBatchAllDupReads commit', () => {
  it('emits true when an execute-phase re-read returns content identical to the prior read', async () => {
    const node = buildNode(makeRegistry({ content: FILE_BODY }), priorReadTurns());
    const out = await node({
      _activePhase: 'execute',
      llmResponse: { toolCalls: [{ id: 'c1', name: 'read_file', args: { path: FILE_PATH } }] },
      conversations: {},
    });
    expect(out._lastToolBatchAllDupReads).toBe(true);
  });

  it('emits false when the read is novel (no prior read of that path+range)', async () => {
    const node = buildNode(makeRegistry({ content: FILE_BODY }), []);
    const out = await node({
      _activePhase: 'execute',
      llmResponse: { toolCalls: [{ id: 'c1', name: 'read_file', args: { path: FILE_PATH } }] },
      conversations: {},
    });
    expect(out._lastToolBatchAllDupReads).toBe(false);
  });

  it('emits false when the re-read content CHANGED since the prior read (execute-then-compare)', async () => {
    const node = buildNode(makeRegistry({ content: FILE_BODY + '\nchanged' }), priorReadTurns());
    const out = await node({
      _activePhase: 'execute',
      llmResponse: { toolCalls: [{ id: 'c1', name: 'read_file', args: { path: FILE_PATH } }] },
      conversations: {},
    });
    expect(out._lastToolBatchAllDupReads).toBe(false);
  });

  it('a shifted line-range is a different (path, range) key — no elision, flag false', async () => {
    // Prior read was whole-file; new read is ranged → distinct key.
    const node = buildNode(makeRegistry({ content: FILE_BODY }), priorReadTurns());
    const out = await node({
      _activePhase: 'execute',
      llmResponse: {
        toolCalls: [{ id: 'c1', name: 'read_file', args: { path: FILE_PATH, startLine: 1, endLine: 3 } }],
      },
      conversations: {},
    });
    expect(out._lastToolBatchAllDupReads).toBe(false);
  });
});

// ─── 3. Production source guards ───

describe('production tool node — flag writer wiring (static)', () => {
  const src = readFileSync(
    resolve(__dirname, '../../src/agents/architect/graph/code/nodes/tool/index.ts'),
    'utf8',
  );

  it('gates the flag commit on execute phase (plan-phase batches never write it)', () => {
    expect(src).toMatch(
      /\.\.\.\(state\._activePhase !== 'plan' \? \{ _lastToolBatchAllDupReads: allDupReads \} : \{\}\)/,
    );
  });

  it('computes the flag via the shared isAllDupReadBatch predicate fed by elidedReads', () => {
    expect(src).toContain("import { isAllDupReadBatch } from './utils/allDupReads'");
    expect(src).toMatch(/isAllDupReadBatch\(executionEvents, elidedReads\?\.length \?\? 0\)/);
  });
});
