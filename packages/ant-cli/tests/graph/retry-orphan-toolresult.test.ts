/**
 * Regression guard — `handleRetryEntry`'s conversation clear must reach the
 * LangGraph reducer so that NODE_EXECUTE is actually emptied at retry entry.
 *
 * Background (job `urban-fronting-faith`, 2026-04-30):
 *   - A retry fired. `handleRetryEntry` mutated state.conversations to clear
 *     NODE_EXECUTE, but the surrounding plan-node return paths only included
 *     `conversations: { [NODE_PLAN]: ... }` — the shallow-merge
 *     `conversationsReducer` preserved the OLD NODE_EXECUTE in the channel.
 *   - The next execute call composed messages from that stale NODE_EXECUTE,
 *     producing a 5-message payload whose messages[3].assistant.tool_use had no
 *     paired tool_result in messages[4] (which was the trailing "Continue." user).
 *   - Anthropic API rejected with 400: `messages.4: tool_use ids were found
 *     without tool_result blocks immediately after`.
 *
 * Fix locks in:
 *   1. `handleRetryEntry` returns a delta (Partial<State>) whose conversations
 *      field carries explicit `[]` for NODE_EXECUTE.
 *   2. `mergeDelta(planReturn, entryDelta)` ensures the delta's conversations
 *      keys reach the reducer alongside the plan node's intended NODE_PLAN write.
 *   3. The reducer's resulting NODE_EXECUTE is empty after the merge, so
 *      `composeMessages` never produces an orphan tool_use.
 *
 * Post verification fix-책임 제거 리팩토링: the original incident reproduced
 * inside the verification task type, but the reducer / mergeDelta invariant
 * is task-type-blind. This suite exercises the contract via an error task
 * fixture (verification no longer enters retry — every cycle ends in done:true).
 */

import { describe, it, expect } from 'vitest';
import {
  conversationsReducer,
  CONV_KEYS,
  type Conversations,
  type ConversationMessage,
} from '../../src/agents/common/graph/conversations';
import { composeMessages } from '../../src/core/utils/messageComposer';
import { mergeDelta } from '../../src/agents/architect/graph/code/nodes/plan/outcome/delta';

const NODE_EXECUTE = CONV_KEYS.NODE_EXECUTE;
const NODE_PLAN = CONV_KEYS.NODE_PLAN;

const orphanToolUseId = 'toolu_01KQFNfLRnN5vYz58ogCBrWE';

const staleAssistantToolUse: ConversationMessage = {
  role: 'assistant',
  content: [
    { type: 'text', text: 'partial reasoning' },
    { type: 'tool_use', id: orphanToolUseId, name: 'edit_file', input: {} },
  ] as any,
};
const staleUserToolResult: ConversationMessage = {
  role: 'user',
  content: [
    { type: 'tool_result', tool_use_id: orphanToolUseId, content: 'ok' },
  ] as any,
};

describe('retry orphan tool_use — handleRetryEntry conversation clear must reach reducer', () => {
  it('mergeDelta(planReturn, retryDelta) lets reducer drop OLD NODE_EXECUTE while preserving base NODE_PLAN write', () => {
    const prev: Conversations = {
      [NODE_EXECUTE]: [staleAssistantToolUse, staleUserToolResult, staleAssistantToolUse],
      [NODE_PLAN]: Array(27).fill({ role: 'user', content: 'old plan turn' } as ConversationMessage),
    };

    // What handleRetryEntry's delta must contribute (uniform retry path —
    // NODE_EXECUTE cleared, NODE_PLAN preserved across retry entries):
    const retryDelta = {
      conversations: {
        [NODE_EXECUTE]: [] as ConversationMessage[],
      },
    };

    // What runMainPlanLLM's tool_use branch contributes (NODE_PLAN write).
    // This is the `base` argument: the plan node's intended return.
    const planReturn = {
      conversations: {
        [NODE_PLAN]: [
          { role: 'user', content: [{ type: 'text', text: 'initial' }] as any },
          { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_new', name: 'run_command', input: {} }] as any },
        ] as ConversationMessage[],
      },
    };

    const merged = mergeDelta(planReturn, retryDelta);
    const next = conversationsReducer(prev, (merged.conversations ?? {}) as Conversations);

    expect(next[NODE_EXECUTE]).toEqual([]);
    expect(next[NODE_PLAN]).toBe(planReturn.conversations[NODE_PLAN]);
    expect(next[NODE_PLAN]).toHaveLength(2);
  });

  it('reducer LEAKS stale NODE_EXECUTE when only NODE_PLAN is in next.conversations (the bug)', () => {
    const prev: Conversations = {
      [NODE_EXECUTE]: [staleAssistantToolUse, staleUserToolResult, staleAssistantToolUse],
      [NODE_PLAN]: [],
    };
    const buggyNext = {
      [NODE_PLAN]: [{ role: 'user', content: 'new' } as ConversationMessage],
    };
    const next = conversationsReducer(prev, buggyNext);
    expect(next[NODE_EXECUTE]).toHaveLength(3);
  });

  it('composeMessages with stale 3-entry NODE_EXECUTE produces messages.4 orphan tool_use', () => {
    const stale: ConversationMessage[] = [
      staleAssistantToolUse,
      staleUserToolResult,
      staleAssistantToolUse,
    ];
    const { messages } = composeMessages({
      initialBlocks: [{ type: 'text', text: 'system' }] as any,
      priorTurns: stale,
    });

    expect(messages).toHaveLength(5);
    expect(messages[3].role).toBe('assistant');
    const messages3Blocks = messages[3].content as any[];
    expect(messages3Blocks.some(b => b.type === 'tool_use' && b.id === orphanToolUseId)).toBe(true);

    expect(messages[4].role).toBe('user');
    const messages4Blocks = messages[4].content as any[];
    const messages4ToolResults = messages4Blocks.filter(b => b.type === 'tool_result');
    expect(messages4ToolResults).toHaveLength(0);
  });

  it('composeMessages with empty NODE_EXECUTE never produces orphan trailing user', () => {
    const { messages } = composeMessages({
      initialBlocks: [{ type: 'text', text: 'system' }] as any,
      priorTurns: [],
    });
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
  });
});

describe('mergeDelta semantics — delta wins for top-level, conversations is inner-key merged', () => {
  it('delta top-level keys win over base (entry-handler reset must beat base.{...state} spread)', () => {
    // Mirrors the real plan() shape: base = { ...state, conversations: ..., _activePhase: ... }.
    // The `...state` spread carries stale counters from the prior turn; entry-
    // handler delta resets must propagate to the reducer.
    const state = {
      _executeCallIndex: 3,
      violations: [{ type: 'old' as any, message: 'stale' }],
      _planSearchWebCount: 7,
      conversations: { [NODE_EXECUTE]: [staleAssistantToolUse] },
    };
    const planReturn = {
      ...state,
      conversations: { [NODE_PLAN]: [{ role: 'user', content: 'new' } as ConversationMessage] },
      _activePhase: 'plan' as const,
    };
    const retryDelta = {
      _executeCallIndex: 0,
      violations: [],
      conversations: { [NODE_EXECUTE]: [] as ConversationMessage[] },
    };
    const merged = mergeDelta(planReturn as any, retryDelta as any);
    expect((merged as any)._executeCallIndex).toBe(0);
    expect((merged as any).violations).toEqual([]);
  });

  it('base keys NOT touched by delta survive (intent-bearing fields like _activePhase, llmResponse)', () => {
    // Entry handlers do not set _activePhase / llmResponse / currentTask in
    // their delta, so these intent-bearing base fields propagate intact.
    const base = {
      _activePhase: 'plan' as const,
      llmResponse: { done: false, textResponse: '', thinking: '', toolCalls: [] },
    };
    const delta = { _executeCallIndex: 0 };
    const merged = mergeDelta(base as any, delta as any);
    expect(merged._activePhase).toBe('plan');
    expect(merged.llmResponse).toBe(base.llmResponse);
    expect((merged as any)._executeCallIndex).toBe(0);
  });

  it('conversations: base keys win per inner key (preserves plan-LLM NODE_PLAN write); delta-only keys propagate', () => {
    const base = {
      conversations: {
        [NODE_PLAN]: [{ role: 'user', content: 'base' } as ConversationMessage],
      },
    };
    const delta = {
      conversations: {
        [NODE_PLAN]: [{ role: 'user', content: 'delta' } as ConversationMessage],
        [NODE_EXECUTE]: [] as ConversationMessage[],
      },
    };
    const merged = mergeDelta(base, delta);
    expect((merged.conversations as Conversations)[NODE_PLAN]).toEqual([
      { role: 'user', content: 'base' },
    ]);
    expect((merged.conversations as Conversations)[NODE_EXECUTE]).toEqual([]);
  });

  it('handles missing conversations on either side gracefully', () => {
    expect(mergeDelta({}, {}).conversations).toEqual({});
    expect(mergeDelta({ conversations: { [NODE_PLAN]: [] } }, {}).conversations).toEqual({ [NODE_PLAN]: [] });
    expect(mergeDelta({}, { conversations: { [NODE_EXECUTE]: [] } }).conversations).toEqual({ [NODE_EXECUTE]: [] });
  });
});
