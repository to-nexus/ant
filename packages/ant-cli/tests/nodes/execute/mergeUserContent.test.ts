/**
 * Regression test for `ivory-fanning-knoll` (2026-04-24).
 *
 * The execute node's cross-worker file-merge fast-path used to append
 * `assistant(tool_use)` immediately followed by a plain-text `user`
 * message carrying the merge instruction. That violates Anthropic's
 * invariant "the message AFTER `assistant(tool_use)` must begin with
 * `tool_result` blocks, one per `tool_use_id`", and surfaces as a
 * deterministic 400 `invalid_request_error` on the next LLM call —
 * draining the worker without retries.
 *
 * This test pins the shape of the user content produced by
 * `buildMergeUserContent`, and in particular guarantees the
 * tool_use / tool_result pairing for the merge-inject branch.
 */

import { describe, it, expect } from 'vitest';
import {
  buildMergeUserContent,
  MERGE_SUPERSEDE_CONTENT,
} from '../../../src/agents/architect/graph/code/nodes/execute/mergeUserContent';

describe('buildMergeUserContent — merge-inject user-content shape', () => {
  const mergeInstruction = 'FILE MERGE REQUIRED — 1 file(s) need merging.\n\n### FILE MERGE: src/app.tsx ...';

  it('no tool_use → plain string (Anthropic API shorthand preserved)', () => {
    const content = buildMergeUserContent([], mergeInstruction);
    expect(content).toBe(mergeInstruction);
  });

  it('with tool_use → array starts with tool_result block(s) then text', () => {
    const toolCalls = [
      { id: 'toolu_01Y2TJ31JnCE8uqyf4fpBcGX', name: 'read_file', args: { path: 'src/app.tsx' } },
      { id: 'toolu_02ABCDEF', name: 'search_code', args: { query: 'Button' } },
    ];

    const content = buildMergeUserContent(toolCalls, mergeInstruction);

    expect(Array.isArray(content)).toBe(true);
    const blocks = content as any[];

    // Exactly one tool_result per tool_use, in the same order, then one text block.
    expect(blocks.length).toBe(toolCalls.length + 1);

    for (let i = 0; i < toolCalls.length; i++) {
      expect(blocks[i].type).toBe('tool_result');
      expect(blocks[i].tool_use_id).toBe(toolCalls[i].id);
      expect(blocks[i].tool_name).toBe(toolCalls[i].name);
      expect(blocks[i].content).toBe(MERGE_SUPERSEDE_CONTENT);
    }

    expect(blocks[blocks.length - 1]).toEqual({ type: 'text', text: mergeInstruction });
  });

  it('every tool_use_id is paired with exactly one tool_result block (no orphans, no duplicates)', () => {
    const toolCalls = [
      { id: 'toolu_A', name: 'read_file', args: {} },
      { id: 'toolu_B', name: 'read_file', args: {} },
      { id: 'toolu_C', name: 'search_code', args: {} },
    ];

    const blocks = buildMergeUserContent(toolCalls, mergeInstruction) as any[];

    const toolUseIds = toolCalls.map(tc => tc.id).sort();
    const toolResultIds = blocks
      .filter(b => b.type === 'tool_result')
      .map(b => b.tool_use_id)
      .sort();

    expect(toolResultIds).toEqual(toolUseIds);
  });

  it('supersede marker avoids error-classification keywords (does not inflate pruneTurns error-priority)', () => {
    // `isErrorContent` in core/context/types.ts triggers on /error|failed|exception/i.
    // Merge supersedes are NOT execution errors; keep the marker neutral.
    expect(MERGE_SUPERSEDE_CONTENT).not.toMatch(/error/i);
    expect(MERGE_SUPERSEDE_CONTENT).not.toMatch(/failed/i);
    expect(MERGE_SUPERSEDE_CONTENT).not.toMatch(/exception/i);
  });

  it('regression: assistant(tool_use) + user(merge) history shape is legal', () => {
    // Reproduces the exact shape execute/index.ts L591-L641 builds.
    const toolCalls = [{ id: 'toolu_01Y2TJ31JnCE8uqyf4fpBcGX', name: 'read_file', args: { path: 'x' } }];
    const nodeExecute: any[] = [];
    const assistantMessage = {
      role: 'assistant' as const,
      content: [
        { type: 'tool_use', id: toolCalls[0].id, name: toolCalls[0].name, input: toolCalls[0].args },
      ],
    };

    const newHistory = [
      ...nodeExecute,
      assistantMessage,
      { role: 'user' as const, content: buildMergeUserContent(toolCalls, mergeInstruction) },
    ];

    // Extract tool_use_ids from the last assistant turn.
    const lastAssistant = newHistory[newHistory.length - 2] as { role: 'assistant'; content: any[] };
    const toolUseIds: string[] = Array.isArray(lastAssistant.content)
      ? lastAssistant.content.filter(b => b.type === 'tool_use').map(b => b.id)
      : [];

    // The user message that follows must lead with tool_result blocks covering every tool_use_id.
    const nextUser = newHistory[newHistory.length - 1] as { role: 'user'; content: any };
    expect(Array.isArray(nextUser.content)).toBe(true);

    const leadingToolResults: string[] = [];
    for (const block of nextUser.content as any[]) {
      if (block.type !== 'tool_result') break;
      leadingToolResults.push(block.tool_use_id);
    }

    for (const id of toolUseIds) {
      expect(leadingToolResults).toContain(id);
    }
  });
});
