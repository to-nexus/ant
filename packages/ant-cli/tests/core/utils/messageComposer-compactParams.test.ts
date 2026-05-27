/**
 * composeMessages — standard-stage `compactParams` plumbing (dim-beating-brass RCA).
 *
 * The execute loop must be able to key the standard compaction threshold to
 * the real model window instead of the hardcoded 50K, so already-read file
 * content stays resident across rounds. This verifies the threshold supplied
 * via `compactParams` actually governs stage-1 compaction.
 */
import { describe, it, expect } from 'vitest';
import { composeMessages } from '../../../src/core/utils/messageComposer';
import { TokenBudgetManager } from '../../../src/core/utils/tokenBudget';
import type { ConversationMessage } from '../../../src/core/context/types';
import type { CacheableContent, MessageContentBlock } from '../../../src/core/ports/llm';

function readTurn(id: string, path: string, body: string): ConversationMessage[] {
  const pad = ' lorem'.repeat(30);
  return [
    { role: 'assistant', content: [{ type: 'tool_use', id, name: 'read_file', input: { path } }] as MessageContentBlock[] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, tool_name: 'read_file', content: body + pad }] as MessageContentBlock[] },
  ];
}

function allText(messages: Array<{ role: string; content: MessageContentBlock[] }>): string {
  return messages
    .map(m => (m.content as MessageContentBlock[])
      .map(b => (b.type === 'text' ? b.text : b.type === 'tool_result' && typeof b.content === 'string' ? b.content : ''))
      .join('\n'))
    .join('\n');
}

const initialBlocks: CacheableContent[] = [{ type: 'text', text: 'system + rules' }];
const priorTurns: ConversationMessage[] = [
  ...readTurn('u1', 'src/a.ts', 'BODY_A'),
  ...readTurn('u2', 'src/b.ts', 'BODY_B'),
  ...readTurn('u3', 'src/c.ts', 'BODY_C'),
  ...readTurn('u4', 'src/d.ts', 'BODY_D'),
  ...readTurn('u5', 'src/e.ts', 'BODY_E'),
  ...readTurn('u6', 'src/f.ts', 'BODY_F'),
];

// Large window so pruning / budget-recovery never interfere — isolate the
// compactParams threshold as the only variable.
function bigWindowManager(): TokenBudgetManager {
  return new TokenBudgetManager({
    maxTokens: 1_000_000,
    areaBudgets: { systemPrompt: 30_000, projectContext: 30_000, taskContext: 25_000, conversationHistory: 900_000 },
  });
}

describe('composeMessages — compactParams threshold plumbing', () => {
  it('compacts when compactParams.autoCompactThreshold is tiny', () => {
    const { messages } = composeMessages({
      initialBlocks,
      priorTurns,
      tokenManager: bigWindowManager(),
      compactParams: { autoCompactThreshold: 10, autoCompactHotTail: 1 },
    });
    expect(allText(messages)).toContain('[Auto-compacted:');
  });

  it('does NOT compact when compactParams.autoCompactThreshold exceeds history (keeps all reads resident)', () => {
    const { messages } = composeMessages({
      initialBlocks,
      priorTurns,
      tokenManager: bigWindowManager(),
      compactParams: { autoCompactThreshold: 10_000_000, autoCompactHotTail: 8 },
    });
    const text = allText(messages);
    expect(text).not.toContain('[Auto-compacted:');
    // Every read's content is still present — nothing was evicted.
    for (const body of ['BODY_A', 'BODY_B', 'BODY_C', 'BODY_D', 'BODY_E', 'BODY_F']) {
      expect(text).toContain(body);
    }
  });
});
