/**
 * WorkerGroupDock — live-only access strip for the parallel tasks that are
 * running right now.
 *
 * Locks: latest-turn mirroring, live-only chip membership, the settle
 * farewell (a finished task is HELD briefly with its outcome glyph, then
 * leaves — it must never blink out, and must never linger past the window),
 * the job-liveness floor, absence of the `W{n}` text badge, and
 * expand-before-jump ordering.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { Turn, TurnSection } from '../../src/domain/store/selectors/chat';
import { SETTLE_FAREWELL_MS } from '../../src/presentation/components/common/motion/motionPresets';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
}));
vi.mock('lucide-react', () => ({
  Check: (p: Record<string, unknown>) => <i data-glyph="check" {...p} />,
  XCircle: (p: Record<string, unknown>) => <i data-glyph="x" {...p} />,
}));
vi.mock('@/presentation/components/common/async', () => ({
  Spinner: () => <i data-glyph="spinner" />,
}));

const mockState = {
  expandChatGroup: vi.fn(),
  requestChatJump: vi.fn(),
  isRunning: true,
  currentJobId: 'j1' as string | undefined,
};
vi.mock('@/domain/store', () => ({
  useStore: (sel: (s: typeof mockState) => unknown) => sel(mockState),
}));

import { WorkerGroupDock } from '../../src/presentation/components/chat/WorkerGroupDock';

beforeEach(() => {
  mockState.expandChatGroup = vi.fn();
  mockState.requestChatJump = vi.fn();
  mockState.isRunning = true;
  mockState.currentJobId = 'j1';
});

afterEach(() => {
  vi.useRealTimers();
});

/** `scopes` entries are `scope` (open) or `[scope, outcome]` (settled). */
function turn(
  turnId: string,
  scopes: (string | [string, NonNullable<TurnSection['outcome']>])[],
): Turn {
  return {
    turnId,
    jobId: 'j1',
    jobType: 'code',
    ts: new Date().toISOString(),
    sections: [
      { workerScope: '_main_', items: [] },
      ...scopes.map((s) =>
        typeof s === 'string'
          ? { workerScope: s, items: [] }
          : { workerScope: s[0], items: [], outcome: s[1] },
      ),
    ],
  } as unknown as Turn;
}

function render(node: React.ReactElement): ReactTestRenderer {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(node);
  });
  return tree!;
}

function update(tree: ReactTestRenderer, node: React.ReactElement) {
  act(() => {
    tree.update(node);
  });
}

function chipButtons(tree: ReactTestRenderer) {
  return tree.root.findAll((n) => n.type === 'button');
}

function glyphs(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAll((n) => typeof n.props?.['data-glyph'] === 'string')
    .map((n) => n.props['data-glyph'] as string);
}

function labels(tree: ReactTestRenderer): string[] {
  return chipButtons(tree).map((b) => {
    const span = b.findAll((n) => n.type === 'span')[0];
    return String(span.props.children);
  });
}

describe('WorkerGroupDock', () => {
  it('renders one chip per RUNNING worker section of the LATEST turn only', () => {
    const tree = render(
      <WorkerGroupDock
        turns={[turn('t1', ['worker-1#task-old']), turn('t2', ['worker-1#task-a', 'worker-2#task-b'])]}
      />,
    );
    expect(chipButtons(tree).length).toBe(2);
    expect(JSON.stringify(tree.toJSON())).not.toContain('task-old');
  });

  it('scopes already settled at mount get no chip — history, not a transition', () => {
    const tree = render(
      <WorkerGroupDock
        turns={[
          turn('t2', [
            ['worker-0#done', 'completed'],
            ['worker-1#split', 'superseded'],
            ['worker-2#bad', 'failed'],
            'worker-3#running',
          ]),
        ]}
      />,
    );
    expect(labels(tree)).toEqual(['running']);
  });

  it('renders nothing when the latest turn has no worker sections', () => {
    const tree = render(
      <WorkerGroupDock turns={[turn('t1', ['worker-1#task-a']), turn('t2', [])]} />,
    );
    expect(tree.toJSON()).toBeNull();
  });

  it('carries no W{n} text badge', () => {
    const tree = render(<WorkerGroupDock turns={[turn('t2', ['worker-3#task-a'])]} />);
    expect(JSON.stringify(tree.toJSON())).not.toContain('W3');
  });

  it('chip click expands the group BEFORE requesting the jump', () => {
    const order: string[] = [];
    mockState.expandChatGroup = vi.fn(() => order.push('expand'));
    mockState.requestChatJump = vi.fn(() => order.push('jump'));

    const tree = render(<WorkerGroupDock turns={[turn('t2', ['worker-1#task-a'])]} />);
    act(() => {
      chipButtons(tree)[0].props.onClick();
    });

    expect(mockState.expandChatGroup).toHaveBeenCalledWith('t2', 'worker-1#task-a');
    expect(mockState.requestChatJump).toHaveBeenCalledWith('t2', 'worker-1#task-a');
    expect(order).toEqual(['expand', 'jump']);
  });

  // ── Settle farewell ────────────────────────────────────────────────────

  describe('settle farewell', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('holds a completed chip with a check, then drops it after the window', () => {
      const tree = render(<WorkerGroupDock turns={[turn('t2', ['worker-1#task-a'])]} />);
      expect(glyphs(tree)).toEqual(['spinner']);

      update(tree, <WorkerGroupDock turns={[turn('t2', [['worker-1#task-a', 'completed']])]} />);
      // Still present — the completion has to be seen, not blinked away.
      expect(chipButtons(tree).length).toBe(1);
      expect(glyphs(tree)).toEqual(['check']);

      act(() => {
        vi.advanceTimersByTime(SETTLE_FAREWELL_MS + 1);
      });
      expect(tree.toJSON()).toBeNull();
    });

    it('a failure gets the same hold, with its own glyph', () => {
      const tree = render(<WorkerGroupDock turns={[turn('t2', ['worker-1#task-a'])]} />);
      update(tree, <WorkerGroupDock turns={[turn('t2', [['worker-1#task-a', 'failed']])]} />);
      expect(glyphs(tree)).toEqual(['x']);

      act(() => {
        vi.advanceTimersByTime(SETTLE_FAREWELL_MS + 1);
      });
      expect(tree.toJSON()).toBeNull();
    });

    it('a batch-split parent settles as completed, not as a failure', () => {
      const tree = render(<WorkerGroupDock turns={[turn('t2', ['worker-1#parent'])]} />);
      update(tree, <WorkerGroupDock turns={[turn('t2', [['worker-1#parent', 'superseded']])]} />);
      expect(glyphs(tree)).toEqual(['check']);
    });

    it('siblings keep running while one settles', () => {
      const tree = render(
        <WorkerGroupDock turns={[turn('t2', ['worker-1#task-a', 'worker-2#task-b'])]} />,
      );
      update(
        tree,
        <WorkerGroupDock
          turns={[turn('t2', [['worker-1#task-a', 'completed'], 'worker-2#task-b'])]}
        />,
      );
      expect(labels(tree)).toEqual(['task-a', 'task-b']);
      expect(glyphs(tree)).toEqual(['check', 'spinner']);

      act(() => {
        vi.advanceTimersByTime(SETTLE_FAREWELL_MS + 1);
      });
      expect(labels(tree)).toEqual(['task-b']);
    });

    it('job end forces the farewell too — the last task is still acknowledged', () => {
      const tree = render(<WorkerGroupDock turns={[turn('t2', ['worker-1#task-a'])]} />);

      // Job dies before the scope marker landed: hold the chip, but claim no
      // outcome — no glyph at all rather than a check we never earned.
      // (Fresh `turns` array so the component's `memo` does not bail out —
      // in the app the store change is what re-renders it.)
      mockState.isRunning = false;
      update(tree, <WorkerGroupDock turns={[turn('t2', ['worker-1#task-a'])]} />);
      expect(chipButtons(tree).length).toBe(1);
      expect(glyphs(tree)).toEqual([]);

      act(() => {
        vi.advanceTimersByTime(SETTLE_FAREWELL_MS + 1);
      });
      expect(tree.toJSON()).toBeNull();
    });

    it('a dead job that was never observed live renders nothing at all', () => {
      // Mount fresh on a stale record — baseline seeding means no farewell.
      mockState.isRunning = false;
      const tree = render(<WorkerGroupDock turns={[turn('t2', ['worker-1#task-a'])]} />);
      expect(tree.toJSON()).toBeNull();
    });
  });
});
