/**
 * ShimmerCard regression — trailing-thinking merge re-renders the
 * thinking variant from "Thought for X" back into "Thinking..." when a
 * new chunk arrives after a durable thought finalized.
 *
 * Background: `TurnItem.buildTrailingThinkingMerge` correctly swaps the
 * card's props from `line={durable}` to `streamingText={merged}` (and
 * back to `line=` on next finalize), reusing the same React key. A
 * previous implementation latched `isThinkingComplete` as internal
 * state with no reset path, so the visual indicator never returned to
 * "Thinking..." once it had completed — defeating the entire merge
 * feature visually. This test guards against the regression.
 */

import { describe, expect, it } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { ChatThinkingLine } from '@ant/shared';

import { ShimmerCard } from '../../src/presentation/components/chat/ShimmerCard';

function makeDurableLine(text: string, durationMs?: number): ChatThinkingLine {
  return {
    type: 'assistant_thinking',
    ts: '2026-05-04T03:00:00.000Z',
    jobId: 'job-1',
    turnId: 'turn-1',
    jobType: 'code',
    text,
    ...(typeof durationMs === 'number' ? { durationMs } : {}),
    cardId: 'think-1',
  };
}

function dumpText(tree: ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

describe('ShimmerCard — thinking variant streaming↔complete transitions', () => {
  it('shows "Thinking..." while only streamingText is provided', () => {
    let tree: ReactTestRenderer | undefined;
    act(() => {
      tree = create(<ShimmerCard variant="thinking" streamingText="reasoning so far" />);
    });
    const dump = dumpText(tree!);
    expect(dump).toContain('Thinking...');
    expect(dump).not.toContain('Thought for');
    expect(dump).toContain('reasoning so far');
  });

  it('switches to "Thought for Xs" once a durable line arrives with durationMs', () => {
    let tree: ReactTestRenderer | undefined;
    act(() => {
      tree = create(<ShimmerCard variant="thinking" streamingText="reasoning so far" />);
    });
    act(() => {
      tree!.update(
        <ShimmerCard
          variant="thinking"
          line={makeDurableLine('reasoning so far', 1500)}
          durationMs={1500}
        />,
      );
    });
    const dump = dumpText(tree!);
    expect(dump).toContain('Thought for');
    expect(dump).toContain('2s');
    expect(dump).not.toContain('Thinking...');
  });

  it('flips back to "Thinking..." when the merge layer re-injects streamingText after a durable thought', () => {
    let tree: ReactTestRenderer | undefined;
    act(() => {
      tree = create(<ShimmerCard variant="thinking" streamingText="phase 1" />);
    });
    act(() => {
      tree!.update(
        <ShimmerCard
          variant="thinking"
          line={makeDurableLine('phase 1', 1500)}
          durationMs={1500}
        />,
      );
    });
    expect(dumpText(tree!)).toContain('Thought for');

    act(() => {
      tree!.update(
        <ShimmerCard
          variant="thinking"
          streamingText="phase 1 + phase 2 chunk"
          durationMs={1500}
        />,
      );
    });
    const dump = dumpText(tree!);
    expect(dump).toContain('Thinking...');
    expect(dump).not.toContain('Thought for');
    expect(dump).toContain('phase 1 + phase 2 chunk');
  });

  it('renders content body during streaming even after a previous complete cycle', () => {
    let tree: ReactTestRenderer | undefined;
    act(() => {
      tree = create(<ShimmerCard variant="thinking" streamingText="a" />);
    });
    act(() => {
      tree!.update(
        <ShimmerCard
          variant="thinking"
          line={makeDurableLine('a', 1500)}
          durationMs={1500}
        />,
      );
    });
    act(() => {
      tree!.update(
        <ShimmerCard variant="thinking" streamingText="a + b" durationMs={1500} />,
      );
    });
    const dump = dumpText(tree!);
    // While streaming, body must be visible (mt-1 px-4 py-3 ... pre tag with text)
    expect(dump).toContain('a + b');
    expect(dump).toContain('whitespace-pre-wrap');
  });
});
