/**
 * WorkerGroupSection — collapsible parallel-worker group container.
 *
 * Locks the reflow-killing contract: collapsed groups render NO body (null,
 * not display:none), the header is a fixed-height toggle, unresolved choice
 * cards force the group open, and toggles write through chatSlice's
 * `toggleChatGroup` with the RESOLVED state (so defaults flip correctly).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { TurnSection } from '../../src/domain/store/selectors/chat';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o?.count !== undefined ? `${o.count} steps` : k) }),
}));
vi.mock('lucide-react', () => ({
  Check: () => null,
  ChevronDown: () => null,
  ChevronRight: () => null,
  XCircle: () => null,
}));
vi.mock('@/presentation/components/common/async', () => ({
  Spinner: () => null,
}));

const mockState = {
  chatGroupOverrides: {} as Record<string, 'expanded' | 'collapsed'>,
  toggleChatGroup: vi.fn(),
};
vi.mock('@/domain/store', () => ({
  useStore: (sel: (s: typeof mockState) => unknown) => sel(mockState),
}));

import { WorkerGroupSection } from '../../src/presentation/components/chat/WorkerGroupSection';

beforeEach(() => {
  mockState.chatGroupOverrides = {};
  mockState.toggleChatGroup = vi.fn();
});

function section(overrides: Partial<TurnSection>): TurnSection {
  return { workerScope: 'worker-1#task-a', items: [], ...overrides };
}

function unresolvedChoice(): TurnSection['items'][number] {
  return {
    kind: 'choice',
    presented: {
      type: 'choice_presented',
      ts: new Date().toISOString(),
      jobId: 'j1',
      turnId: 't1',
      jobType: 'code',
      cardId: 'choice-1',
      cardType: 'unknown',
    },
  } as unknown as TurnSection['items'][number];
}

function render(node: React.ReactElement): ReactTestRenderer {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(node);
  });
  return tree!;
}

const BODY_MARKER = 'group-body-content';
const Body = () => <div data-testid={BODY_MARKER} />;

function renderGroup(s: TurnSection, workerSectionCount: number) {
  return render(
    <WorkerGroupSection turnId="t1" section={s} workerSectionCount={workerSectionCount}>
      <Body />
    </WorkerGroupSection>,
  );
}

function hasBody(tree: ReactTestRenderer): boolean {
  return tree.root.findAllByType(Body).length > 0;
}

function header(tree: ReactTestRenderer) {
  return tree.root.findAll((n) => n.props?.role === 'button')[0];
}

describe('WorkerGroupSection', () => {
  it('parallel turn (≥2 workers) defaults collapsed — body renders null', () => {
    const tree = renderGroup(section({}), 3);
    expect(hasBody(tree)).toBe(false);
    expect(header(tree).props['aria-expanded']).toBe(false);
  });

  it('single-worker turn defaults expanded — body present', () => {
    const tree = renderGroup(section({}), 1);
    expect(hasBody(tree)).toBe(true);
    expect(header(tree).props['aria-expanded']).toBe(true);
  });

  it('unresolved choice forces expansion even with a collapsed override', () => {
    mockState.chatGroupOverrides = { 't1:worker-1#task-a': 'collapsed' };
    const tree = renderGroup(section({ items: [unresolvedChoice()] }), 3);
    expect(hasBody(tree)).toBe(true);
  });

  it('click toggles through chatSlice with the resolved collapsed state', () => {
    const tree = renderGroup(section({}), 3); // resolved: collapsed
    act(() => {
      header(tree).props.onClick();
    });
    expect(mockState.toggleChatGroup).toHaveBeenCalledWith('t1', 'worker-1#task-a', true);
  });

  it('keyboard Enter toggles too', () => {
    const tree = renderGroup(section({}), 3);
    act(() => {
      header(tree).props.onKeyDown({ key: 'Enter', preventDefault: () => {} });
    });
    expect(mockState.toggleChatGroup).toHaveBeenCalledTimes(1);
  });

  it('collapsed active group shows the live ticker at fixed height', () => {
    const tree = renderGroup(section({ activeText: 'streaming tail line' }), 3);
    const ticker = tree.root.findAll(
      (n) => typeof n.props?.className === 'string' && n.props.className.includes('shimmer-text'),
    );
    expect(ticker.length).toBe(1);
    expect(ticker[0].props.style.height).toBe(14);
    expect(ticker[0].props.children).toContain('streaming tail line');
  });
});
