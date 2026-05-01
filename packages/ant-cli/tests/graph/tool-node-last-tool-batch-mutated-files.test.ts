/**
 * Tool node — `_lastToolBatchMutatedFiles` propagation regression.
 *
 * Successor of the retired `_executeModifiedFiles` test. The original flag
 * was set via direct `state.X = true` mutation inside `afterExecution` and
 * never propagated through LangGraph's LastValue channel, so the verify-
 * mode router saw `false` and routed every `<done>` to checkTaskStatus.
 * Subsequent fix returned the flag from `buildReturn` so the channel
 * committed it; the cross-cycle dual-role then caused the `urban-fronting-
 * faith` p2 reverify-branch lockout (every retry/reverify entry handler
 * reset the flag, so the next `<done>` always routed to checkTaskStatus
 * instead of plan).
 *
 * The flag was retired entirely. The replacement signal
 * `_lastToolBatchMutatedFiles` is **turn-scoped**: tool node always emits
 * it (not "only when true") for execute-phase batches, and execute resets
 * it to false on every return. This locks both invariants:
 *   1. Execute-phase tool batch with file-mutating side effect →
 *      `_lastToolBatchMutatedFiles: true`
 *   2. Execute-phase tool batch without file mutation →
 *      `_lastToolBatchMutatedFiles: false` (NOT undefined — explicit reset
 *      so the previous turn's `true` does not stay sticky)
 *   3. Plan-phase tool batch → flag never written (the channel keeps
 *      whatever execute last set; plan-phase mutations are not execute-turn
 *      progress)
 */

import { describe, it, expect } from 'vitest';
import { createToolNode } from '../../src/agents/common/tool/createToolNode';
import type {
  ToolExecutionContext,
  ToolResult,
} from '../../src/agents/common/tool/types';
import { ToolRegistry } from '../../src/agents/common/tool/registry';

type State = {
  _activePhase?: 'plan' | 'execute';
  _lastToolBatchMutatedFiles?: boolean;
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
      // Mirror of the production `nodes/tool/index.ts` buildReturn signal.
      const touchedFiles = state._activePhase !== 'plan' && executionEvents.some(e =>
        (e.result.sideEffects || []).some(ef => ef.type === 'verificationInvalidated'),
      );
      return {
        recursionCount: (state.recursionCount || 0) + 1,
        ...(state._activePhase !== 'plan'
          ? { _lastToolBatchMutatedFiles: touchedFiles }
          : {}),
      };
    },
  });
}

describe('tool node — _lastToolBatchMutatedFiles commit', () => {
  it('emits _lastToolBatchMutatedFiles=true on execute-phase tool batch with verificationInvalidated', async () => {
    const node = buildNode(makeRegistry({
      content: 'ok',
      sideEffects: [
        { type: 'fileModified', path: 'codebase/src/foo.ts' } as any,
        { type: 'verificationInvalidated', scope: 'all', reason: 'fileModified' } as any,
      ],
    }));

    const out = await node({
      _activePhase: 'execute',
      _lastToolBatchMutatedFiles: false,
      llmResponse: { toolCalls: [{ id: 'c1', name: 'edit_file', args: {} }] },
      conversations: {},
    });

    expect(out._lastToolBatchMutatedFiles).toBe(true);
  });

  it('emits _lastToolBatchMutatedFiles=false on execute-phase tool batch without file mutation', async () => {
    const node = buildNode(makeRegistry({
      content: 'ok',
      sideEffects: [
        { type: 'commandExecuted', command: 'echo hi', exitCode: 0, success: true, hasWarnings: false } as any,
      ],
    }));

    const out = await node({
      _activePhase: 'execute',
      _lastToolBatchMutatedFiles: true, // sticky from previous turn — must be cleared
      llmResponse: { toolCalls: [{ id: 'c1', name: 'run_command', args: {} }] },
      conversations: {},
    });

    // Explicit `false` (not undefined) so a prior `true` never carries over
    // a stale signal into the next execute turn's stuck-loop check.
    expect(out._lastToolBatchMutatedFiles).toBe(false);
  });

  it('does NOT emit _lastToolBatchMutatedFiles when phase is "plan" (plan-tool loop)', async () => {
    const node = buildNode(makeRegistry({
      content: 'ok',
      sideEffects: [
        { type: 'verificationInvalidated', scope: 'all', reason: 'fileModified' } as any,
      ],
    }));

    const out = await node({
      _activePhase: 'plan',
      _lastToolBatchMutatedFiles: false,
      llmResponse: { toolCalls: [{ id: 'c1', name: 'edit_file', args: {} }] },
      conversations: {},
    });

    // Plan-phase mutations are not execute-turn progress; the channel must
    // not be touched so the next execute turn's stuck-loop reading reflects
    // only execute-phase tool batches.
    expect(out._lastToolBatchMutatedFiles).toBeUndefined();
  });
});
