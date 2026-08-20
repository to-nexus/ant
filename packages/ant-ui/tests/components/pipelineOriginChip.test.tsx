/**
 * PipelineOriginChip — pipeline-originated turns/rows carry a name chip; the
 * name resolves from the loaded pipelines list with the id as fallback (the
 * list is tab-lazy, and a deleted pipeline's turns must stay legible).
 */
import { describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const { storeState, useStoreMock } = vi.hoisted(() => {
  const storeState: any = { pipelines: [] };
  const useStoreMock: any = (selector: any) => selector(storeState);
  useStoreMock.getState = () => storeState;
  return { storeState, useStoreMock };
});
vi.mock('@/domain/store', () => ({ useStore: useStoreMock }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, arg?: any) => (typeof arg === 'object' ? `chip:${arg.name}` : _k) }),
}));

import { PipelineOriginChip } from '../../src/presentation/components/Pipelines/PipelineOriginChip';

function render(pipelineId: string): ReactTestRenderer {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(<PipelineOriginChip pipelineId={pipelineId} />);
  });
  return tree!;
}

describe('PipelineOriginChip', () => {
  it('renders the pipeline NAME when the list knows the id', () => {
    storeState.pipelines = [{ id: 'p1', name: 'Weekly digest' }];
    const dump = JSON.stringify(render('p1').toJSON());
    expect(dump).toContain('Weekly digest');
  });

  it('falls back to the raw id for an unknown (deleted / not-yet-loaded) pipeline', () => {
    storeState.pipelines = [];
    const dump = JSON.stringify(render('ghost-pipe').toJSON());
    expect(dump).toContain('ghost-pipe');
  });
});
