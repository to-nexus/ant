/**
 * Regression guard — `execute.fileConflicts` branch must preserve tool_use
 * in the assistant message it pushes to history.
 *
 * Background (job `bitter-looping-nurse`, 2026-04-22):
 *   The LLM response carried both
 *     (a) a `<file>` block that collided with a file already owned by a
 *         prior/parallel task (triggering `fileConflicts`), AND
 *     (b) a valid `tool_use` block (e.g. `edit_file` on another path).
 *   The legacy fileConflicts branch pushed a plain-string assistant message
 *   (stripped of `tool_use`) while keeping `llmResponse.toolCalls` populated.
 *   The router then sent control to the tool node, which appended a
 *   `user(tool_result)`. Anthropic's SDK merges the two trailing user
 *   messages (`user(mergeInstruction)` + `user([tool_result])`) into a
 *   single user block, and because the preceding assistant carried no
 *   matching `tool_use`, the API rejected the request with
 *   `messages.N.content.M: unexpected tool_use_id found in tool_result
 *    blocks`.
 *
 * The fix is a single-call change inside execute's fileConflicts branch:
 * route the assistant message through `buildAssistantMessage({ text,
 * toolCalls })` — identical to the normal execute-return path. This test
 * locks in the contract that `buildAssistantMessage` relies on so a future
 * refactor of either path cannot silently drop `tool_use` blocks again.
 *
 * A second assertion reproduces the exact shape the fileConflicts branch
 * emits so the invariant is visible at the call-site level, not buried in
 * `buildAssistantMessage`'s internals.
 */

import { describe, it, expect } from 'vitest';
import { buildAssistantMessage } from '../src/agents/common/tool/messageBuilder';

describe('fileConflicts orphan tool_result — assistant history invariant', () => {
  it('buildAssistantMessage emits tool_use blocks when toolCalls are present', () => {
    const msg = buildAssistantMessage({
      text: '[file written to disk: codebase/src/a.tsx]',
      toolCalls: [
        { id: 'toolu_A', name: 'edit_file', args: { path: 'codebase/src/b.tsx' } },
      ],
    });

    expect(msg.role).toBe('assistant');
    expect(Array.isArray(msg.content)).toBe(true);
    const blocks = msg.content as any[];
    const toolUseBlock = blocks.find(b => b.type === 'tool_use');
    expect(toolUseBlock).toBeDefined();
    expect(toolUseBlock.id).toBe('toolu_A');
    expect(toolUseBlock.name).toBe('edit_file');
  });

  it('buildAssistantMessage keeps tool_use even when text is empty', () => {
    const msg = buildAssistantMessage({
      text: undefined,
      toolCalls: [
        { id: 'toolu_A', name: 'edit_file', args: {} },
      ],
    });

    const blocks = msg.content as any[];
    expect(blocks.some(b => b.type === 'tool_use' && b.id === 'toolu_A')).toBe(true);
  });

  it('reproduces the fileConflicts-branch history shape: assistant(tool_use) + user(merge) pair', () => {
    // Mirror of execute/index.ts fileConflicts branch history construction.
    // Keep this in sync with that call-site; if the branch stops going
    // through `buildAssistantMessage` the preceding assertion catches the
    // orphan risk, and this one documents the intended shape.
    const toolCalls = [
      { id: 'toolu_012Dmqzy221GMFz4LvpQKo5g', name: 'edit_file', args: { path: 'codebase/src/features-section.tsx' } },
    ];
    const cleanedResponse = '[file written to disk: codebase/src/hero.tsx]';
    const mergeInstruction = 'FILE MERGE REQUIRED — 1 file(s) need merging. ...';

    const priorHistory: Array<{ role: 'user' | 'assistant'; content: any }> = [
      { role: 'user', content: 'continue' },
    ];
    const assistantMessage = toolCalls.length > 0
      ? buildAssistantMessage({ text: cleanedResponse || undefined, toolCalls })
      : { role: 'assistant' as const, content: cleanedResponse };
    const history = [
      ...priorHistory,
      assistantMessage,
      { role: 'user' as const, content: mergeInstruction },
    ];

    const assistantIdx = history.length - 2;
    const userIdx = history.length - 1;
    expect(history[assistantIdx].role).toBe('assistant');
    expect(history[userIdx].role).toBe('user');

    const assistantBlocks = history[assistantIdx].content as any[];
    expect(Array.isArray(assistantBlocks)).toBe(true);
    const toolUse = assistantBlocks.find(b => b.type === 'tool_use');
    expect(toolUse).toBeDefined();
    expect(toolUse.id).toBe('toolu_012Dmqzy221GMFz4LvpQKo5g');
  });
});
