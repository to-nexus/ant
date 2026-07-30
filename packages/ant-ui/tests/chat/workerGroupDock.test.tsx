/**
 * WorkerGroupDock — always-available access strip for the latest parallel
 * turn's worker groups.
 *
 * Locks: chat-record lifecycle (dock mirrors the LATEST turn only — groups
 * outlive their workers and are replaced by the next turn), expand-before-
 * jump ordering, and null render when the latest turn has no worker
 * sections.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { Turn } from '../../src/domain/store/selectors/chat';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('lucide-react', () => ({
  Check: () => null,
  XCircle: () => null,
}));
vi.mock('@/presentation/components/common/async', () => ({
  Spinner: () => null,
}));

const mockState = {
  expandChatGroup: vi.fn(),
  requestChatJump: vi.fn(),
};
vi.mock('@/domain/store', () => ({
  useStore: (sel: (s: typeof mockState) => unknown) => sel(mockState),
}));

import { WorkerGroupDock } from '../../src/presentation/components/chat/WorkerGroupDock';

beforeEach(() => {
  mockState.expandChatGroup = vi.fn();
  mockState.requestChatJump = vi.fn();
});

function turn(turnId: string, workerScopes: string[]): Turn {
  return {
    turnId,
    jobId: 'j1',
    jobType: 'code',
    ts: new Date().toISOString(),
    sections: [
      { workerScope: '_main_', items: [] },
      ...workerScopes.map((scope) => ({ workerScope: scope, items: [] })),
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
  it('renders one chip per worker section of the LATEST turn only', () => {
    const tree = render(
      <WorkerGroupDock
        turns={[
          turn('t1', ['worker-1#task-old']),
          turn('t2', ['worker-1#task-a', 'worker-2#task-b']),
        ]}
      />,
    );
    const chips = chipButtons(tree);
    expect(chips.length).toBe(2);
    // Keys carry the latest turnId, not the older one.
    expect(JSON.stringify(tree.toJSON())).not.toContain('task-old');
  });

  it('renders nothing when the latest turn has no worker sections', () => {
    const tree = render(
      <WorkerGroupDock turns={[turn('t1', ['worker-1#task-a']), turn('t2', [])]} />,
    );
    expect(tree.toJSON()).toBeNull();
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
