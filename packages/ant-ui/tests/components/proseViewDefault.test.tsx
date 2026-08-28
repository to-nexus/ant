/**
 * useProseMode default — every prose section opens in the rendered view.
 * It used to open editable scopes in `raw`, which showed the author's own hard
 * wraps and read as the surface breaking lines far short of its container.
 * The default is now the domain SSOT's DEFAULT_VIEW_MODE for every scope.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { useProseMode } from '../../src/presentation/components/AgentSettings/prompts/proseSurface';
import { DEFAULT_VIEW_MODE, type ViewMode } from '../../src/domain/file/viewMode';

function readMode(key: string): { mode: ViewMode; set: (next: ViewMode) => void } {
  const captured = {} as { mode: ViewMode; set: (next: ViewMode) => void };
  function Probe({ k }: { k: string }) {
    const [mode, set] = useProseMode(k);
    captured.mode = mode;
    captured.set = set;
    return null;
  }
  act(() => {
    create(<Probe k={key} />);
  });
  return captured;
}

describe('useProseMode', () => {
  it('opens an unvisited file in the domain default view', () => {
    expect(readMode('jobs/a/base/one.md').mode).toBe(DEFAULT_VIEW_MODE);
  });

  it("the domain default is 'preview' — the left half of the toggle", () => {
    expect(DEFAULT_VIEW_MODE).toBe('preview');
  });

  it('remembers a per-key choice and leaves other keys at the default', () => {
    const captured = {} as Record<string, ViewMode>;
    let setA: (next: ViewMode) => void = () => {};
    function Probe({ k }: { k: string }) {
      const [mode, set] = useProseMode(k);
      captured[k] = mode;
      if (k === 'a.md') setA = set;
      return null;
    }
    let tree: any;
    act(() => {
      tree = create(<Probe k="a.md" />);
    });
    act(() => setA('raw'));
    expect(captured['a.md']).toBe('raw');
    act(() => {
      tree.update(<Probe k="b.md" />);
    });
    expect(captured['b.md']).toBe(DEFAULT_VIEW_MODE);
  });
});
