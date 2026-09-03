/**
 * Tool-failure signal wiring (trim-grinding-motif RCA, 2026-07-19).
 *
 * A feature task burned recursionLimit 800 (402 LLM calls / 28 min) re-issuing
 * `read_file` on a to-be-created file 371 times. Four defects severed every
 * failure signal between layers:
 *
 *   D1 — `truncateResult` / `formatToolResultContent` replaced handler-authored
 *        failure content (recovery guidance) with the bare `Error: <error>`.
 *   D2 — `commandHistory` was mutated in place and never returned as a channel
 *        delta, so Safety Net B / the loop warning / the dominant-failure
 *        diagnostic always read an empty history.
 *   D3 — tool_result blocks were built inside `executeBatch`, BEFORE the batch
 *        hooks ran, so hook amendments (loop warnings) never reached the LLM.
 *   D4 — `isAllDupReadBatch` counted only successful elided reads; an
 *        error-read loop never incremented the no-progress streak.
 *
 * Contracts locked here:
 *   1. D1 UNIT — error results keep authored content; bare synthesis only
 *      when the handler gave none.
 *   2. D2 UNIT — `appendCommandHistory` is pure, accumulates, warns at 3
 *      same-command failures, prunes the 5-min window, caps entries.
 *   3. D3 FACTORY — `createToolNode` builds tool_result blocks AFTER hooks:
 *      an afterBatch content amendment lands in the delivered user message.
 *   4. D4 UNIT — `isAllRepeatErrorBatch` truth table.
 *   5. STATIC — production wiring: afterBatch returns the commandHistory
 *      delta; the channel has a preserve-on-undefined reducer; attempt
 *      boundaries reset the history (anti-retry-spiral).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ToolResultManager } from '../../src/core/utils/toolResultManager';
import { TokenBudgetManager } from '../../src/core/utils/tokenBudget';
import { buildToolResultMessage } from '../../src/agents/common/tool/messageBuilder';
import { createToolNode } from '../../src/agents/common/tool/createToolNode';
import {
  appendCommandHistory,
} from '../../src/agents/architect/graph/code/nodes/tool/utils/helpers';
import {
  isAllRepeatErrorBatch,
  commandLabelsForEvent,
} from '../../src/agents/architect/graph/code/nodes/tool/utils/allDupReads';
import { routeAfterExecute } from '../../src/agents/architect/graph/code/routers/executeRouter';
import type {
  ToolExecutionContext,
  ToolResult,
} from '../../src/agents/common/tool/types';
import { ToolRegistry } from '../../src/agents/common/tool/registry';

const GUIDANCE =
  'File not found: codebase/src/a.ts\n\n' +
  'Before retrying: use list_files("codebase/src") to verify the exact path, ' +
  'or if this file is meant to be new, use <file path="codebase/src/a.ts"> to create it instead of reading it.';

// ─── 1. D1 — error results keep handler-authored content ───

describe('D1 — truncateResult preserves authored failure content', () => {
  const manager = new ToolResultManager(new TokenBudgetManager());

  it('keeps the recovery guidance when the handler set both content and error', () => {
    const out = manager.truncateResult('read_file', GUIDANCE, 'File not found: codebase/src/a.ts');
    expect(out.content).toContain('meant to be new');
    expect(out.content).toContain('create it instead of reading it');
  });

  it('synthesizes `Error: <error>` only when the handler gave no content', () => {
    const out = manager.truncateResult('read_file', '', 'File not found: codebase/src/a.ts');
    expect(out.content).toBe('Error: File not found: codebase/src/a.ts');
  });
});

describe('D1 — formatToolResultContent (message layer) preserves authored failure content', () => {
  it('delivers the content verbatim when present alongside error', () => {
    const { toolResultBlocks } = buildToolResultMessage([
      {
        toolCallId: 'c1',
        toolName: 'read_file',
        args: { path: 'codebase/src/a.ts' },
        result: { content: GUIDANCE, error: 'File not found: codebase/src/a.ts' },
        cached: false,
      } as any,
    ]);
    expect(toolResultBlocks[0].content).toBe(GUIDANCE);
  });

  it('falls back to `Error: <error>` when content is missing', () => {
    const { toolResultBlocks } = buildToolResultMessage([
      {
        toolCallId: 'c1',
        toolName: 'read_file',
        args: { path: 'codebase/src/a.ts' },
        result: { content: '', error: 'boom' },
        cached: false,
      } as any,
    ]);
    expect(toolResultBlocks[0].content).toBe('Error: boom');
  });

  // The persisted failure verdict (major-loading-floor RCA): without
  // `is_error` a sealed session shows a 404 and a 201 as the same shape.
  it.each([
    ['error result carries is_error: true', { content: 'HTTP 404 Not Found', error: 'HTTP 404 Not Found' }, true],
    ['gate-denied result carries is_error: true', { content: 'Error: blocked by policy', error: 'blocked by policy' }, true],
    ['success result omits the field entirely', { content: 'HTTP 201 Created' }, false],
  ] as const)('%s', (_name, result, expectFlag) => {
    const { toolResultBlocks } = buildToolResultMessage([
      { toolCallId: 'c1', toolName: 'api__ant__request', args: {}, result, cached: false } as any,
    ]);
    if (expectFlag) {
      expect(toolResultBlocks[0].is_error).toBe(true);
    } else {
      expect('is_error' in toolResultBlocks[0]).toBe(false);
    }
  });
});

// ─── 2. D2 — appendCommandHistory (pure) ───

describe('D2 — appendCommandHistory', () => {
  const failure = (command: string) => ({
    command,
    success: false,
    exitCode: 1,
    error: 'File not found',
  });

  it('accumulates across calls when the caller threads the returned history', () => {
    let history = appendCommandHistory(undefined, [failure('tool:read_file:a.ts')]).history;
    history = appendCommandHistory(history, [failure('tool:read_file:a.ts')]).history;
    expect(history).toHaveLength(2);
    expect(history.every(h => !h.success)).toBe(true);
  });

  it('emits the LOOP DETECTION WARNING at the 3rd same-command failure', () => {
    let history = appendCommandHistory(undefined, [failure('tool:read_file:a.ts')]).history;
    history = appendCommandHistory(history, [failure('tool:read_file:a.ts')]).history;
    const third = appendCommandHistory(history, [failure('tool:read_file:a.ts')]);
    expect(third.warnings.get('tool:read_file:a.ts')).toContain('LOOP DETECTION WARNING');
  });

  it('does not warn for successes or for the first two failures', () => {
    const first = appendCommandHistory(undefined, [failure('tool:read_file:a.ts')]);
    expect(first.warnings.size).toBe(0);
    const ok = appendCommandHistory(first.history, [
      { command: 'npm run build', success: true, exitCode: 0 },
    ]);
    expect(ok.warnings.size).toBe(0);
  });

  it('prunes entries older than the 5-minute window', () => {
    const now = Date.now();
    const stale = [{ command: 'old', timestamp: now - 6 * 60 * 1000, success: false }];
    const { history } = appendCommandHistory(stale as any, [failure('fresh')], now);
    expect(history.map(h => h.command)).toEqual(['fresh']);
  });

  it('caps the retained history length', () => {
    const now = Date.now();
    const bulk = Array.from({ length: 150 }, (_, i) => ({
      command: `c${i}`,
      timestamp: now - 1000,
      success: true,
    }));
    const { history } = appendCommandHistory(bulk as any, [failure('last')], now);
    expect(history.length).toBeLessThanOrEqual(100);
    expect(history[history.length - 1].command).toBe('last');
  });
});

describe('D2 — Safety Net B fires from a channel-fed history (superstep simulation)', () => {
  it('routes to checkTaskStatus once 5 recent failures accumulated across batches', () => {
    // Thread the returned history across 5 simulated supersteps — exactly
    // what the tool node's afterBatch delta + channel commit now does.
    let history: any = undefined;
    for (let i = 0; i < 5; i++) {
      history = appendCommandHistory(history, [
        { command: 'tool:read_file:codebase/src/a.ts', success: false, exitCode: 1, error: 'File not found' },
      ]).history;
    }
    const route = routeAfterExecute({
      llmResponse: {
        toolCalls: [{ id: 'c6', name: 'read_file', args: { path: 'codebase/src/a.ts' } }],
      },
      commandHistory: history,
      currentTask: { id: 't1', name: 'feature task', type: 'feature', priority: 300 },
    } as any);
    expect(route).toBe('checkTaskStatus');
  });
});

// ─── 3. D3 — blocks built AFTER hooks (factory behavior) ───

type State = {
  _activePhase?: 'plan' | 'execute';
  llmResponse?: { toolCalls: unknown[] };
};

function makeRegistry(result: ToolResult): ToolRegistry {
  return {
    get(_name: string) {
      return async (_ctx: ToolExecutionContext, _args: any): Promise<ToolResult> => result;
    },
    has() { return true; },
    names() { return ['read_file']; },
  } as unknown as ToolRegistry;
}

describe('D3 — createToolNode builds tool_result blocks after batch hooks', () => {
  it('an afterBatch content amendment reaches the delivered user message', async () => {
    let deliveredHistory: any[] = [];
    const node = createToolNode<State>({
      getPendingCalls(state) {
        return (state.llmResponse?.toolCalls ?? []) as any;
      },
      buildContext(): ToolExecutionContext {
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
      registry: makeRegistry({ content: 'Error: File not found', error: 'File not found' }),
      getHistory() { return []; },
      hooks: {
        afterBatch(_state, events) {
          for (const e of events) {
            if (typeof e.result.content === 'string') {
              e.result.content = e.result.content + '\n\n🚨 LOOP DETECTION WARNING: amended';
            }
          }
          return {};
        },
      },
      buildReturn(_state, { updatedHistory }) {
        deliveredHistory = updatedHistory;
        return {};
      },
    });

    await node({
      _activePhase: 'execute',
      llmResponse: { toolCalls: [{ id: 'c1', name: 'read_file', args: { path: 'codebase/src/a.ts' } }] },
    });

    const lastUser = deliveredHistory[deliveredHistory.length - 1];
    const block = lastUser.content.find((b: any) => b.type === 'tool_result');
    expect(block.content).toContain('LOOP DETECTION WARNING: amended');
  });
});

// ─── 4. D4 — isAllRepeatErrorBatch truth table ───

describe('D4 — isAllRepeatErrorBatch', () => {
  const errEvent = {
    toolName: 'read_file',
    args: { path: 'codebase/src/a.ts' },
    result: { error: 'File not found' },
  };
  const okEvent = { toolName: 'read_file', args: { path: 'codebase/src/a.ts' }, result: {} };
  const priorFail = [{ command: 'tool:read_file:codebase/src/a.ts', success: false }];

  it('true: every call errored and its label already failed before', () => {
    expect(isAllRepeatErrorBatch([errEvent, errEvent], priorFail)).toBe(true);
  });

  it('false: first occurrence of the failure (no prior history)', () => {
    expect(isAllRepeatErrorBatch([errEvent], [])).toBe(false);
    expect(isAllRepeatErrorBatch([errEvent], undefined)).toBe(false);
  });

  it('false: prior entry for the label was a SUCCESS', () => {
    expect(
      isAllRepeatErrorBatch([errEvent], [{ command: 'tool:read_file:codebase/src/a.ts', success: true }]),
    ).toBe(false);
  });

  it('false: batch contains a successful call', () => {
    expect(isAllRepeatErrorBatch([errEvent, okEvent], priorFail)).toBe(false);
  });

  it('false: errored call whose label never failed before', () => {
    const other = { toolName: 'read_file', args: { path: 'codebase/src/b.ts' }, result: { error: 'x' } };
    expect(isAllRepeatErrorBatch([other], priorFail)).toBe(false);
  });

  it('run_command events are labelled by their commandExecuted side-effect', () => {
    const cmdEvent = {
      toolName: 'run_command',
      args: { command: 'npm run build' },
      result: { error: 'exit 1', sideEffects: [{ type: 'commandExecuted', command: 'npm run build' }] },
    };
    expect(commandLabelsForEvent(cmdEvent)).toEqual(['npm run build']);
    expect(isAllRepeatErrorBatch([cmdEvent], [{ command: 'npm run build', success: false }])).toBe(true);
  });
});

// ─── 5. Static production-wiring locks ───

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');

describe('static — production wiring locks', () => {
  it('tool node afterBatch commits the history via hookUpdates (no in-place push survives)', () => {
    const src = read('../../src/agents/architect/graph/code/nodes/tool/index.ts');
    expect(src).toContain('appendCommandHistory(');
    expect(src).toMatch(/delta\.commandHistory = history/);
    // The retired in-place writer must not come back (comment mentions are
    // fine — only actual assignment / push CALLS are locked out).
    expect(src).not.toMatch(/state\.commandHistory\s*=[^=]/);
    expect(src).not.toMatch(/state\.commandHistory\.push\(/);
  });

  it('createToolNode rebuilds tool_result blocks AFTER the hooks run', () => {
    const src = read('../../src/agents/common/tool/createToolNode.ts');
    const hookIdx = src.indexOf('config.hooks.afterBatch(state, batchResult.events)');
    const buildIdx = src.indexOf('buildToolResultMessage(batchResult.events)');
    expect(hookIdx).toBeGreaterThan(-1);
    expect(buildIdx).toBeGreaterThan(hookIdx);
    // The pre-hook orchestrator snapshot must not feed the message.
    expect(src).not.toMatch(/elideDuplicateReads\(\s*calls, baseHistory, batchResult\.toolResultBlocks/);
  });

  it('commandHistory channel has a preserve-on-undefined reducer', () => {
    const src = read('../../src/agents/architect/graph/code/graph.ts');
    expect(src).toMatch(/commandHistory: Annotation<any>\(\{\s*\n\s*reducer/);
  });

  it('attempt boundaries reset the history (anti-retry-spiral)', () => {
    // Same boundary sites as `_noProgressStreak` — a stale ≥5-failure window
    // would let Safety Net B instantly re-divert the fresh retry attempt.
    const files = [
      '../../src/agents/architect/graph/code/nodes/checkTaskStatus/index.ts',
      '../../src/agents/architect/graph/code/nodes/checkTaskStatus/workerIndex.ts',
      '../../src/agents/architect/graph/code/nodes/plan/entry/resolve.ts',
      '../../src/agents/architect/graph/code/parallel/TaskWorker.ts',
    ];
    for (const f of files) {
      expect(read(f), f).toMatch(/commandHistory: \[\]/);
    }
  });
});
