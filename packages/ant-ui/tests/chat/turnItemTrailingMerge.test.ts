import { describe, expect, it } from 'vitest';
import type {
  ChatThinkingLine,
  ChatStatusLine,
} from '@ant/shared';
import {
  buildTrailingThinkingMerge,
  type RenderEntry,
} from '../../src/presentation/components/chat/trailingThinkingMerge';

function thinkingEntry(text: string, ts = '2026-05-19T00:00:00.000Z'): RenderEntry {
  const line: ChatThinkingLine = {
    type: 'assistant_thinking',
    ts,
    jobId: 'job-1',
    turnId: 'turn-1',
    jobType: 'ask',
    text,
  };
  return { key: `thinking:${ts}`, kind: 'thinking', line };
}

function statusEntry(cardId: string): RenderEntry {
  const line: ChatStatusLine = {
    type: 'chat_status',
    ts: '2026-05-19T00:00:01.000Z',
    jobId: 'job-1',
    turnId: 'turn-1',
    jobType: 'ask',
    cardId,
    statusType: 'read',
    metadata: {},
  };
  return { key: `status:${cardId}`, kind: 'status', line };
}

describe('buildTrailingThinkingMerge', () => {
  it('bails when tail is non-thinking (b034fc8e regression guard)', () => {
    const result = buildTrailingThinkingMerge(
      [thinkingEntry('first'), statusEntry('c1')],
      'new active thinking',
    );
    expect(result).toBeNull();
  });

  it('bails when activeText sits between finalized thinking and new thinking', () => {
    const result = buildTrailingThinkingMerge(
      [thinkingEntry('first thought')],
      'second thinking stream',
      'live plain text response',
    );
    expect(result).toBeNull();
  });

  it('merges activeThinking into the trailing thought when no activeText boundary exists', () => {
    const result = buildTrailingThinkingMerge(
      [thinkingEntry('first thought')],
      ' continued',
    );
    expect(result).not.toBeNull();
    expect(result?.hasActiveThinking).toBe(true);
    expect(result?.mergedText).toBe('first thought continued');
    expect(result?.startIndex).toBe(0);
    expect(result?.endIndex).toBe(0);
  });

  it('merges contiguous trailing thinking entries even without an active stream', () => {
    const result = buildTrailingThinkingMerge([
      thinkingEntry('a'),
      thinkingEntry('b'),
    ]);
    expect(result).not.toBeNull();
    expect(result?.hasActiveThinking).toBe(false);
    expect(result?.mergedText).toBe('ab');
    expect(result?.startIndex).toBe(0);
    expect(result?.endIndex).toBe(1);
  });

  it('treats empty-string activeText as absent (no false-positive bail)', () => {
    const result = buildTrailingThinkingMerge(
      [thinkingEntry('first')],
      'active',
      '',
    );
    expect(result).not.toBeNull();
    expect(result?.hasActiveThinking).toBe(true);
  });
});
