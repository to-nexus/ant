import { describe, it, expect } from 'vitest';
import {
  consumeAwaitingClarify,
  type ClarifyContinuableState,
} from '../../src/agents/common/clarify';
import { CONV_KEYS } from '../../src/agents/common/graph/conversations';

/**
 * Unit coverage for the shared clarify continuation helper. The same
 * function services design docGen (NODE_DOCGEN) and planner generate
 * (NODE_GENERATE), so the cases below exercise both keys plus the no-op
 * paths that keep new-job and post-consume runs from re-pushing.
 */
describe('consumeAwaitingClarify', () => {
  function makeState(overrides: Partial<ClarifyContinuableState> = {}): ClarifyContinuableState {
    return {
      conversations: {},
      ...overrides,
    };
  }

  it('appends overrideDirective to the target NODE key as a user message', () => {
    const state = makeState({
      awaitingClarify: true,
      overrideDirective: 'a) puzzle mode\nb) web browser',
      conversations: {
        [CONV_KEYS.NODE_GENERATE]: [
          { role: 'user', content: 'Build a match-3 game' },
          { role: 'assistant', content: 'Asking clarifying questions…' },
        ],
      },
    });

    consumeAwaitingClarify(state, CONV_KEYS.NODE_GENERATE);

    const history = state.conversations[CONV_KEYS.NODE_GENERATE];
    expect(history).toHaveLength(3);
    expect(history?.[2]).toEqual({
      role: 'user',
      content: 'a) puzzle mode\nb) web browser',
    });
    expect(state.awaitingClarify).toBe(false);
  });

  it('uses NODE_DOCGEN by default for design docGen call sites', () => {
    const state = makeState({
      awaitingClarify: true,
      overrideDirective: 'spec answer',
      conversations: {
        [CONV_KEYS.NODE_DOCGEN]: [
          { role: 'user', content: 'spec request' },
          { role: 'assistant', content: 'clarify text' },
        ],
      },
    });

    consumeAwaitingClarify(state);

    expect(state.conversations[CONV_KEYS.NODE_DOCGEN]).toHaveLength(3);
    expect(state.conversations[CONV_KEYS.NODE_DOCGEN]?.[2]).toEqual({
      role: 'user',
      content: 'spec answer',
    });
  });

  it('is a no-op when awaitingClarify is falsy (new job)', () => {
    const state = makeState({
      awaitingClarify: false,
      overrideDirective: 'fresh directive',
      conversations: {
        [CONV_KEYS.NODE_GENERATE]: [{ role: 'user', content: 'previous' }],
      },
    });

    const before = JSON.stringify(state.conversations);
    consumeAwaitingClarify(state, CONV_KEYS.NODE_GENERATE);
    expect(JSON.stringify(state.conversations)).toBe(before);
    expect(state.awaitingClarify).toBe(false);
  });

  it('is a no-op when overrideDirective is empty (avoid blank user turn)', () => {
    const state = makeState({
      awaitingClarify: true,
      overrideDirective: '',
      conversations: {
        [CONV_KEYS.NODE_GENERATE]: [{ role: 'assistant', content: 'clarify text' }],
      },
    });

    consumeAwaitingClarify(state, CONV_KEYS.NODE_GENERATE);

    expect(state.conversations[CONV_KEYS.NODE_GENERATE]).toHaveLength(1);
    // Flag stays true so a follow-up turn with a real answer still triggers append.
    expect(state.awaitingClarify).toBe(true);
  });

  it('is idempotent — second call after consume does nothing', () => {
    const state = makeState({
      awaitingClarify: true,
      overrideDirective: 'answer',
      conversations: {
        [CONV_KEYS.NODE_GENERATE]: [{ role: 'assistant', content: 'q' }],
      },
    });

    consumeAwaitingClarify(state, CONV_KEYS.NODE_GENERATE);
    const afterFirst = JSON.stringify(state.conversations);
    consumeAwaitingClarify(state, CONV_KEYS.NODE_GENERATE);
    expect(JSON.stringify(state.conversations)).toBe(afterFirst);
  });

  it('preserves other conversation keys (shallow merge semantics)', () => {
    const state = makeState({
      awaitingClarify: true,
      overrideDirective: 'answer',
      conversations: {
        [CONV_KEYS.SESSION_MAIN]: [{ role: 'user', content: 'session-main' }],
        [CONV_KEYS.NODE_GENERATE]: [{ role: 'assistant', content: 'q' }],
      },
    });

    consumeAwaitingClarify(state, CONV_KEYS.NODE_GENERATE);

    expect(state.conversations[CONV_KEYS.SESSION_MAIN]).toEqual([
      { role: 'user', content: 'session-main' },
    ]);
    expect(state.conversations[CONV_KEYS.NODE_GENERATE]).toHaveLength(2);
  });

  it('initializes the target conversation key when missing', () => {
    const state = makeState({
      awaitingClarify: true,
      overrideDirective: 'answer',
      conversations: {},
    });

    consumeAwaitingClarify(state, CONV_KEYS.NODE_GENERATE);

    expect(state.conversations[CONV_KEYS.NODE_GENERATE]).toEqual([
      { role: 'user', content: 'answer' },
    ]);
  });
});
