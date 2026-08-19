/**
 * ClampedBlock — the toggle exists ONLY when the content actually overflows the
 * collapsed cap, and expanding lifts the cap. Overflow is a MEASUREMENT
 * (scrollHeight vs maxHeight), so the cases below drive it through a node mock
 * rather than through text length. i18n keys are asserted, never prose.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, create } from 'react-test-renderer';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => key || fallback }),
}));

import { ClampedBlock } from '../../src/presentation/components/common/ClampedBlock';

type Renderer = ReturnType<typeof create>;

const MAX = 100;

function render(scrollHeight: number): Renderer {
  let tree: Renderer | undefined;
  act(() => {
    tree = create(
      <ClampedBlock maxHeight={MAX}>
        <p>body</p>
      </ClampedBlock>,
      // The measured element is the first host div; react-test-renderer refs
      // are null without this.
      { createNodeMock: () => ({ scrollHeight }) },
    );
  });
  return tree!;
}

/** The clamped wrapper is the div carrying an explicit maxHeight style. */
function capOf(tree: Renderer): number | string | undefined {
  const hit = tree.root.findAll(
    (n) => n.type === 'div' && n.props?.style?.maxHeight !== undefined,
  );
  return hit[0]?.props.style.maxHeight;
}

function toggles(tree: Renderer) {
  return tree.root.findAll((n) => n.type === 'button');
}

beforeEach(() => {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
});

afterEach(() => {
  delete (globalThis as any).ResizeObserver;
});

describe('ClampedBlock', () => {
  it('shows no toggle and no cap when the content fits', () => {
    const tree = render(MAX - 20);
    expect(toggles(tree)).toHaveLength(0);
    expect(capOf(tree)).toBe('none');
  });

  it('clamps and offers a toggle when the content overflows, lifting the cap on expand', () => {
    const tree = render(MAX * 3);
    const [toggle] = toggles(tree);
    expect(toggle).toBeDefined();
    expect(toggle.props['aria-expanded']).toBe(false);
    expect(capOf(tree)).toBe(MAX);
    expect(toggle.children.some((c) => c === 'clamp.expand')).toBe(true);

    act(() => toggle.props.onClick());

    const [expandedToggle] = toggles(tree);
    expect(expandedToggle.props['aria-expanded']).toBe(true);
    expect(capOf(tree)).toBe('none');
    expect(expandedToggle.children.some((c) => c === 'clamp.collapse')).toBe(true);
  });

  it('degrades to full content when ResizeObserver is unavailable', () => {
    delete (globalThis as any).ResizeObserver;
    const tree = render(MAX * 3);
    expect(toggles(tree)).toHaveLength(0);
    expect(capOf(tree)).toBe('none');
  });
});
