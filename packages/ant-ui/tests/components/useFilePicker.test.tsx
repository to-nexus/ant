/**
 * The one picker every tree opens. A browser input is EITHER file-mode OR
 * folder-mode, so the hook must actually re-render into folder mode when a
 * caller asks for it — the ⋯ menu's "Upload folder" is nothing but this
 * attribute. Assertions target the rendered element's props; `.click()` needs
 * a real DOM, which react-test-renderer does not provide.
 */

import { describe, it, expect } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useFilePicker, type OpenFilePicker } from '../../src/application/hooks/ui/useFilePicker';

function mount(): { renderer: ReactTestRenderer; open: () => OpenFilePicker } {
  let open!: OpenFilePicker;
  function Host() {
    const [node, openPicker] = useFilePicker();
    open = openPicker;
    return node as React.ReactElement;
  }
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<Host />);
  });
  return { renderer, open: () => open };
}

const input = (r: ReactTestRenderer) => r.root.findByType('input').props as Record<string, unknown>;

describe('useFilePicker', () => {
  it('renders a multi-file input, in file mode, before any pick', () => {
    const { renderer } = mount();
    expect(input(renderer).type).toBe('file');
    expect(input(renderer).multiple).toBe(true);
    expect(input(renderer).webkitdirectory).toBeUndefined();
  });

  it('folder mode sets webkitdirectory; file mode carries the accept filter', () => {
    const { renderer, open } = mount();

    act(() => open()(() => {}, { directory: true }));
    expect(input(renderer).webkitdirectory).toBe('');

    act(() => open()(() => {}, { accept: '.md,.txt' }));
    expect(input(renderer).webkitdirectory).toBeUndefined();
    expect(input(renderer).accept).toBe('.md,.txt');
  });

  it('the picked files reach the handler that asked for them', () => {
    const { renderer, open } = mount();
    const seen: string[] = [];
    act(() => open()((files) => seen.push(files[0].name)));

    const files = [new File(['x'], 'a.md')];
    const list = { length: 1, item: () => files[0], 0: files[0] } as unknown as FileList;
    act(() => {
      (input(renderer).onChange as (e: unknown) => void)({ target: { files: list } });
    });
    expect(seen).toEqual(['a.md']);
  });
});
