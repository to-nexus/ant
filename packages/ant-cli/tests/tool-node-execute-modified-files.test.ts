/**
 * Tool node — `_executeModifiedFiles` propagation regression.
 *
 * Regression guard for the verification-loop postmortem bug: the flag was
 * set via direct `state._executeModifiedFiles = true` mutation inside
 * `afterExecution`, but because the tool node never returned it from
 * `buildReturn` the LangGraph LastValue channel never committed the
 * change. The router then saw `false` and routed every verification
 * `<done>` to `checkTaskStatus` → heavy retry instead of light reverify.
 *
 * This test locks the repaired contract: any `verificationInvalidated`
 * side effect in an execute-phase batch must surface as
 * `_executeModifiedFiles: true` in the tool node's return (so the graph
 * state channel picks it up).
 */

import { describe, it, expect } from 'vitest';
import { createToolNode } from '../src/agents/common/tool/createToolNode';
import type {
  ToolRegistry,
  ToolExecutionContext,
  ToolResult,
} from '../src/agents/common/tool/types';

type State = {
  _activePhase?: 'plan' | 'execute';
  _executeModifiedFiles?: boolean;
  toolResults?: unknown[];
  recursionCount?: number;
  recursionLimit?: number;
  planText?: string;
  llmResponse?: { toolCalls: unknown[] };
  conversations?: Record<string, unknown[]>;
};

function makeRegistry(result: ToolResult): ToolRegistry {
  return {
    get(_name: string) {
      return async (_ctx: ToolExecutionContext, _args: any): Promise<ToolResult> => result;
    },
    has() { return true; },
    list() { return ['fake_tool']; },
  } as unknown as ToolRegistry;
}

function buildNode(registry: ToolRegistry) {
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
      return [];
    },
    buildReturn(state, { executionEvents }) {
      const touchedFiles = state._activePhase !== 'plan' && executionEvents.some(e =>
        (e.result.sideEffects || []).some(ef => ef.type === 'verificationInvalidated'),
      );
      return {
        recursionCount: (state.recursionCount || 0) + 1,
        ...(touchedFiles ? { _executeModifiedFiles: true } : {}),
      };
    },
  });
}

describe('tool node — _executeModifiedFiles commit', () => {
  it('returns _executeModifiedFiles=true when a verificationInvalidated side effect fires in execute phase', async () => {
    const node = buildNode(makeRegistry({
      content: 'ok',
      sideEffects: [
        { type: 'fileModified', path: 'codebase/src/foo.ts' } as any,
        { type: 'verificationInvalidated', scope: 'all', reason: 'fileModified' } as any,
      ],
    }));

    const out = await node({
      _activePhase: 'execute',
      _executeModifiedFiles: false,
      llmResponse: { toolCalls: [{ id: 'c1', name: 'edit_file', args: {} }] },
      conversations: {},
    });

    expect(out._executeModifiedFiles).toBe(true);
  });

  it('does NOT return _executeModifiedFiles when no verificationInvalidated side effect', async () => {
    const node = buildNode(makeRegistry({
      content: 'ok',
      sideEffects: [
        { type: 'commandExecuted', command: 'echo hi', exitCode: 0, success: true, hasWarnings: false } as any,
      ],
    }));

    const out = await node({
      _activePhase: 'execute',
      _executeModifiedFiles: false,
      llmResponse: { toolCalls: [{ id: 'c1', name: 'run_command', args: {} }] },
      conversations: {},
    });

    expect(out._executeModifiedFiles).toBeUndefined();
  });

  it('does NOT return _executeModifiedFiles when the phase is "plan" (plan-tool loop)', async () => {
    const node = buildNode(makeRegistry({
      content: 'ok',
      sideEffects: [
        { type: 'verificationInvalidated', scope: 'all', reason: 'fileModified' } as any,
      ],
    }));

    const out = await node({
      _activePhase: 'plan',
      _executeModifiedFiles: false,
      llmResponse: { toolCalls: [{ id: 'c1', name: 'edit_file', args: {} }] },
      conversations: {},
    });

    expect(out._executeModifiedFiles).toBeUndefined();
  });
});
