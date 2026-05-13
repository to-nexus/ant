/**
 * getPendingChoice — autoscroll veto signal.
 *
 * Covers the invariant that drives the ChatHistory autoscroll freeze:
 *   - Only UNRESOLVED choice cards count (resolved cards must scroll past).
 *   - Returns the latest (highest-index) unresolved card's turnIndex.
 *
 * Regression guard: choice-card visibility kept getting pushed out of the
 * viewport by parallel-task SSE events because autoscroll didn't know a
 * card was pending. This selector is the single source of truth for
 * "is there a card the user still needs to see?".
 */

import { describe, it, expect } from 'vitest';
import type {
  ChatChoicePresentedLine,
  ChatChoiceResolvedLine,
} from '@ant/shared';
import {
  getPendingChoice,
  MAIN_WORKER_SCOPE,
  type Turn,
  type TurnItem,
} from '../../src/domain/store/selectors/chat';

function presented(cardId: string): ChatChoicePresentedLine {
  return {
    type: 'choice_presented',
    ts: '2026-05-13T00:00:00.000Z',
    jobId: 'j1',
    turnId: 't1',
    jobType: 'code',
    cardId,
    cardType: 'triage_choice',
  } as ChatChoicePresentedLine;
}

function resolved(cardId: string): ChatChoiceResolvedLine {
  return {
    type: 'choice_resolved',
    ts: '2026-05-13T00:00:01.000Z',
    jobId: 'j1',
    turnId: 't1',
    jobType: 'code',
    cardId,
    choiceId: 'resume',
  } as ChatChoiceResolvedLine;
}

function turnWith(items: TurnItem[], turnId = 't1'): Turn {
  return {
    turnId,
    jobId: 'j1',
    jobType: 'code',
    ts: '2026-05-13T00:00:00.000Z',
    sections: [{ workerScope: MAIN_WORKER_SCOPE, items }],
  };
}

describe('getPendingChoice', () => {
  it('returns has=false on empty turns', () => {
    expect(getPendingChoice([])).toEqual({ has: false, turnIndex: null });
  });

  it('returns has=false when the only choice card is already resolved', () => {
    const turn = turnWith([
      { kind: 'choice', presented: presented('c1'), resolved: resolved('c1') },
    ]);
    expect(getPendingChoice([turn])).toEqual({ has: false, turnIndex: null });
  });

  it('returns has=true with turnIndex for an unresolved choice card', () => {
    const turn = turnWith([
      { kind: 'choice', presented: presented('c1') },
    ]);
    expect(getPendingChoice([turn])).toEqual({ has: true, turnIndex: 0 });
  });

  it('returns the latest (highest-index) unresolved turn when multiple exist', () => {
    const turn0 = turnWith(
      [{ kind: 'choice', presented: presented('c1') }],
      't1',
    );
    const turn1 = turnWith(
      [{ kind: 'assistant_message', line: { type: 'assistant_message', ts: '', jobId: 'j1', turnId: 't2', jobType: 'code', text: 'x' } as any }],
      't2',
    );
    const turn2 = turnWith(
      [{ kind: 'choice', presented: presented('c2') }],
      't3',
    );
    expect(getPendingChoice([turn0, turn1, turn2])).toEqual({ has: true, turnIndex: 2 });
  });

  it('ignores resolved cards even when interleaved with unresolved ones', () => {
    const turn0 = turnWith(
      [{ kind: 'choice', presented: presented('c1') }],
      't1',
    );
    const turn1 = turnWith(
      [{ kind: 'choice', presented: presented('c2'), resolved: resolved('c2') }],
      't2',
    );
    // Latest unresolved is turn0 since turn1's card is resolved.
    expect(getPendingChoice([turn0, turn1])).toEqual({ has: true, turnIndex: 0 });
  });
});
