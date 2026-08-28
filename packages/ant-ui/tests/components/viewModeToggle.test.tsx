/**
 * ViewModeToggle — the control exists to make order and default unforgeable.
 * Three surfaces used to build their own pair and all three disagreed: raw was
 * on the left in the prose editor and the file editor, on the right in the
 * definition cards. Assert the GATE (which button renders first, which is
 * active, whether the left one can be disabled), never the label prose.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { ViewModeToggle, type ToggleLeftKind, type ToggleValue } from '../../src/presentation/components/aurora/ViewModeToggle';

interface Btn {
  label: string;
  active: boolean;
  disabled: boolean;
}

function buttons(props: {
  left: ToggleLeftKind;
  value: ToggleValue;
  leftDisabled?: boolean;
}): Btn[] {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(<ViewModeToggle {...props} onChange={() => {}} />);
  });
  return tree!.root.findAllByType('button').map((b) => {
    // The label is the trailing <span>; the leading child is the icon.
    const spans = b.findAllByType('span');
    return {
      label: String(spans[spans.length - 1].children[0]),
      active: b.props.style.background === 'var(--bg-surface)',
      disabled: b.props.disabled === true,
    };
  });
}

describe('ViewModeToggle order', () => {
  it.each<ToggleLeftKind>(['structured', 'preview'])(
    'renders the %s button before raw',
    (left) => {
      const [first, second] = buttons({ left, value: 'left' });
      expect(first.label).toBe(`viewMode.${left}`);
      expect(second.label).toBe('viewMode.raw');
    },
  );

  it('reads its labels from the common namespace, never from a caller prop', () => {
    const labels = buttons({ left: 'structured', value: 'left' }).map((b) => b.label);
    expect(labels.every((l) => l.startsWith('viewMode.'))).toBe(true);
  });
});

describe('ViewModeToggle active state', () => {
  it('value=left activates the left button only', () => {
    const [left, raw] = buttons({ left: 'preview', value: 'left' });
    expect(left.active).toBe(true);
    expect(raw.active).toBe(false);
  });

  it('value=raw activates the raw button only', () => {
    const [left, raw] = buttons({ left: 'preview', value: 'raw' });
    expect(left.active).toBe(false);
    expect(raw.active).toBe(true);
  });
});

describe('ViewModeToggle leftDisabled', () => {
  it('keeps the left button rendered but disabled, and falls back to raw', () => {
    const [left, raw] = buttons({ left: 'preview', value: 'left', leftDisabled: true });
    expect(left.disabled).toBe(true);
    expect(left.active).toBe(false);
    expect(raw.active).toBe(true);
  });

  it('does not drop the button — the control must not move between sections', () => {
    expect(buttons({ left: 'preview', value: 'left', leftDisabled: true })).toHaveLength(2);
  });
});
