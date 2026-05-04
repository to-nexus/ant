import { describe, expect, it } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { FileEdit } from 'lucide-react';
import type { ComponentProps } from 'react';

import { TabButton } from '../../src/presentation/components/MainPanelTabsBar/components/TabButton';

function renderButton(props: Partial<ComponentProps<typeof TabButton>> = {}): ReactTestRenderer {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(
      <TabButton
        icon={FileEdit}
        label="spec-main.md"
        isActive={false}
        showText={false}
        onClick={() => {}}
        trailing={<span>loading</span>}
        {...props}
      />,
    );
  });
  return tree!;
}

describe('TabButton trailing visibility', () => {
  it('hides trailing in collapsed mode by default', () => {
    const tree = renderButton();
    const dump = JSON.stringify(tree.toJSON());
    expect(dump).not.toContain('loading');
  });

  it('shows trailing in collapsed mode when explicitly enabled', () => {
    const tree = renderButton({ showTrailingWhenCollapsed: true });
    const dump = JSON.stringify(tree.toJSON());
    expect(dump).toContain('loading');
  });
});
