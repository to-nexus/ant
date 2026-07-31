/**
 * WorkerGroupDock — live-only access strip for the parallel tasks that are
 * running right now.
 *
 * Locks: latest-turn mirroring, live-only chip membership (a settled scope
 * leaves the dock), the job-liveness floor (dock never survives job end even
 * if the BE marker is missing), absence of the `W{n}` text badge, and
 * expand-before-jump ordering.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { Turn, TurnSection } from '../../src/domain/store/selectors/chat';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/presentation/components/common/async', () => ({
  Spinner: () => null,
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

function chipButtons(tree: ReactTestRenderer) {
  return tree.root.findAll((n) => n.type === 'button');
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

  it('drops settled scopes — completed work lives in the scrollback, not the dock', () => {
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
    const chips = chipButtons(tree);
    expect(chips.length).toBe(1);
    // Chip labels fall back to the scope's task key.
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('running');
    for (const settled of ['done', 'split', 'bad']) expect(json).not.toContain(settled);
  });

  it('renders nothing once every scope has settled', () => {
    const tree = render(
      <WorkerGroupDock turns={[turn('t2', [['worker-0#done', 'completed']])]} />,
    );
    expect(tree.toJSON()).toBeNull();
  });

  it('job-liveness floor: hidden when the job is not running, or is a different job', () => {
    // Scope never got its terminal marker (killed worker / legacy record).
    const turns = [turn('t2', ['worker-1#task-a'])];
    expect(render(<WorkerGroupDock turns={turns} />).toJSON()).not.toBeNull();

    mockState.isRunning = false;
    expect(render(<WorkerGroupDock turns={turns} />).toJSON()).toBeNull();

    mockState.isRunning = true;
    mockState.currentJobId = 'other-job';
    expect(render(<WorkerGroupDock turns={turns} />).toJSON()).toBeNull();
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
});
