/**
 * useSettlingExit — the departure-edge mirror of `useNewlyAdded`.
 *
 * Locks the three rules a consumer depends on: the baseline is seeded
 * silently (things already gone at mount are history, not a transition), a
 * departure is held for exactly one window, and an item that comes back
 * cancels its own farewell instead of vanishing mid-animation.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useSettlingExit } from '../../src/presentation/components/common/motion/useSettlingExit';

const HOLD = 500;

let observed: string[] = [];

function Probe({ ids }: { ids: string[] }) {
  const { settlingIds } = useSettlingExit(ids, { holdMs: HOLD });
  observed = [...settlingIds].sort();
  return null;
}

function mount(ids: string[]): ReactTestRenderer {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(<Probe ids={ids} />);
  });
  return tree!;
}

function rerender(tree: ReactTestRenderer, ids: string[]) {
  act(() => {
    tree.update(<Probe ids={ids} />);
  });
}

beforeEach(() => {
  observed = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useSettlingExit', () => {
  it('seeds the baseline silently — a shorter first list fires nothing', () => {
    mount(['a', 'b']);
    expect(observed).toEqual([]);
  });

  it('flags a departure and evicts it after exactly one hold window', () => {
    const tree = mount(['a', 'b']);
    rerender(tree, ['b']);
    expect(observed).toEqual(['a']);

    act(() => {
      vi.advanceTimersByTime(HOLD - 1);
    });
    expect(observed).toEqual(['a']);

    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(observed).toEqual([]);
  });

  it('flags simultaneous departures independently', () => {
    const tree = mount(['a', 'b', 'c']);
    rerender(tree, ['c']);
    expect(observed).toEqual(['a', 'b']);
  });

  it('re-entry cancels the farewell immediately', () => {
    const tree = mount(['a']);
    rerender(tree, []);
    expect(observed).toEqual(['a']);

    // Stop → Resume: the item is live again, so it must go straight back to
    // its running rendering rather than finish fading out.
    rerender(tree, ['a']);
    expect(observed).toEqual([]);

    // …and the cancelled timer must not fire later.
    act(() => {
      vi.advanceTimersByTime(HOLD * 2);
    });
    expect(observed).toEqual([]);
  });

  it('an unrelated re-render does not re-arm the window', () => {
    const tree = mount(['a', 'b']);
    rerender(tree, ['b']);

    act(() => {
      vi.advanceTimersByTime(HOLD - 50);
    });
    rerender(tree, ['b']); // same content — must not restart the hold
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(observed).toEqual([]);
  });
});
