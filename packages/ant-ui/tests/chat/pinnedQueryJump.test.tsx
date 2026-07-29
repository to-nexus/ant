/**
 * PinnedQuery — jump affordance.
 *
 * The jump lives on its own button, not on the pin body. Round 1 bound it to
 * the whole body behind a `window.getSelection()` guard, so any drag-select or
 * double-click on the prompt text silently no-opped it — indistinguishable
 * from the feature not existing. Hover-expand is for READING the prompt (text
 * stays selectable); the button is the only navigation surface.
 */

import { describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/presentation/components/chat/ActionMetadataBadges', () => ({
  ActionMetadataBadges: () => null,
}));
vi.mock('lucide-react', () => ({
  ArrowUpToLine: () => null,
}));

import {
  PinnedQuery,
  PIN_COLLAPSED_HEIGHT_PX,
  type PinnedQueryData,
} from '../../src/presentation/components/chat/PinnedQuery';

const QUERY: PinnedQueryData = { content: 'refactor the auth adapter', turnId: 'turn-7' };

function render(node: React.ReactElement): ReactTestRenderer {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(node);
  });
  return tree!;
}

function buttons(tree: ReactTestRenderer) {
  return tree.root.findAllByType('button');
}

function rootProps(tree: ReactTestRenderer): Record<string, any> {
  return (tree.toJSON() as any).props;
}

describe('PinnedQuery — jump affordance', () => {
  it('exposes no jump surface while no prompt is pinned', () => {
    const tree = render(<PinnedQuery query={null} onJump={() => {}} />);
    expect(buttons(tree)).toHaveLength(0);
  });

  it('exposes no jump surface without an onJump handler', () => {
    const tree = render(<PinnedQuery query={QUERY} />);
    expect(buttons(tree)).toHaveLength(0);
  });

  it('renders a labelled jump button while a prompt is pinned', () => {
    const tree = render(<PinnedQuery query={QUERY} onJump={() => {}} />);
    const [button] = buttons(tree);
    expect(button.props['aria-label']).toBe('pinnedQuery.jumpToMessage');
    expect(button.props.title).toBe('pinnedQuery.jumpToMessage');
    expect(JSON.stringify(tree.toJSON())).toContain('refactor the auth adapter');
  });

  it('keeps the pin body free of click/role semantics', () => {
    // The body is read-only content — binding navigation to it is what broke
    // the jump for anyone who selected the prompt text.
    const props = rootProps(render(<PinnedQuery query={QUERY} onJump={() => {}} />));
    expect(props.onClick).toBeUndefined();
    expect(props.role).toBeUndefined();
    expect(props.onKeyDown).toBeUndefined();
  });

  it('jumps when the button is pressed, regardless of any text selection', () => {
    // No selection guard: the previous implementation dropped this call when
    // a selection existed anywhere in the document.
    const onJump = vi.fn();
    const tree = render(<PinnedQuery query={QUERY} onJump={onJump} />);
    act(() => {
      buttons(tree)[0].props.onClick({ stopPropagation: vi.fn() });
    });
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it('stops the press from reaching the pin body', () => {
    const stopPropagation = vi.fn();
    const tree = render(<PinnedQuery query={QUERY} onJump={() => {}} />);
    act(() => {
      buttons(tree)[0].props.onClick({ stopPropagation });
    });
    expect(stopPropagation).toHaveBeenCalled();
  });

  it('is inert and invisible until hovered or focused', () => {
    const tree = render(<PinnedQuery query={QUERY} onJump={() => {}} />);
    expect(buttons(tree)[0].props.style).toMatchObject({
      opacity: 0,
      pointerEvents: 'none',
    });

    // Hovering the pin body reveals it.
    act(() => {
      rootProps(tree).onMouseEnter();
    });
    expect(buttons(tree)[0].props.style).toMatchObject({
      opacity: 1,
      pointerEvents: 'auto',
    });
  });

  it('reveals itself on keyboard focus so it is reachable without a mouse', () => {
    const tree = render(<PinnedQuery query={QUERY} onJump={() => {}} />);
    act(() => {
      buttons(tree)[0].props.onFocus({ currentTarget: { matches: () => true } });
    });
    const { style } = buttons(tree)[0].props;
    expect(style.opacity).toBe(1);
    expect(style.outline).toContain('var(--violet-400)');
  });

  it('publishes the collapsed bar height for the threshold and jump offset', () => {
    // Single owner: the pin covers this many px of the scroll surface, so it is
    // both the "not readable yet" inset and the jump's scroll compensation.
    expect(PIN_COLLAPSED_HEIGHT_PX).toBeGreaterThan(0);
  });
});
