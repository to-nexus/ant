/**
 * ChecklistItemRow — an `active` item spins only while the board's frame says
 * the job is running (dataSource live/estimating). On a non-running board the
 * same item settles into the interrupted presentation (pause glyph + badge)
 * without its persisted state ever being rewritten (local-nursing-churn RCA:
 * a server-restart cancel left the spinner running forever).
 */
import { describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { UniversalChecklistItem } from '@ant/shared';

const { storeState, useStoreMock } = vi.hoisted(() => {
  const storeState: any = { recursionLimit: 800, pipelines: [] };
  const useStoreMock: any = (selector: any) => selector(storeState);
  useStoreMock.getState = () => storeState;
  return { storeState, useStoreMock };
});
vi.mock('@/domain/store', () => ({ useStore: useStoreMock }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, fallback?: any) => (typeof fallback === 'string' ? fallback : k) }),
}));

import { ChecklistItemRow } from '../../src/presentation/components/checklist/ChecklistBoard';

function render(item: UniversalChecklistItem, running: boolean): string {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(<ChecklistItemRow item={item} running={running} />);
  });
  return JSON.stringify(tree!.toJSON());
}

const item = (state: UniversalChecklistItem['state']): UniversalChecklistItem =>
  ({ id: 'c1', text: 'job periodic-filing', state }) as UniversalChecklistItem;

describe('ChecklistItemRow — interrupted settle', () => {
  it('active + running board → spinner, no interrupted badge', () => {
    const dump = render(item('active'), true);
    expect(dump).not.toContain('lucide-pause');
    expect(dump).not.toContain('Interrupted');
  });

  it('active + non-running board → pause glyph + interrupted badge, no spinner', () => {
    const dump = render(item('active'), false);
    expect(dump).toContain('lucide-pause');
    expect(dump).toContain('Interrupted');
    expect(dump).not.toContain('animate');
  });

  it('done and pending rows are unaffected by the running flag', () => {
    for (const running of [true, false]) {
      expect(render(item('done'), running)).toContain('lucide-check');
      const pending = render(item('pending'), running);
      expect(pending).not.toContain('lucide-pause');
      expect(pending).not.toContain('Interrupted');
    }
  });
});
