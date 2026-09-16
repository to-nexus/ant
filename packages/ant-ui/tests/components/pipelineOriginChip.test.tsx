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

function render(pipelineId: string, run?: { runId: string; itemKey?: string; firedBy?: 'cron' | 'manual' | 'event' }): ReactTestRenderer {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(<PipelineOriginChip pipelineId={pipelineId} runId={run?.runId} itemKey={run?.itemKey} firedBy={run?.firedBy} />);
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

  // N live runs post turns into ONE flat chat — the chip names the run.
  it('names the run by its id when given one, and the case key wins over the id', () => {
    storeState.pipelines = [{ id: 'p1', name: 'Refunds' }];
    const byId = JSON.stringify(render('p1', { runId: 'sandy-mending-cabin', firedBy: 'manual' }).toJSON());
    expect(byId).toContain('sandy-mending-cabin');
    const byKey = JSON.stringify(render('p1', { runId: 'sandy-mending-cabin', itemKey: 'REF-7' }).toJSON());
    expect(byKey).toContain('REF-7');
    expect(byKey).not.toContain('sandy-mending-cabin');
  });

  it('renders no run part without a runId (the board chip before attribution lands)', () => {
    storeState.pipelines = [{ id: 'p1', name: 'Refunds' }];
    const dump = JSON.stringify(render('p1').toJSON());
    expect(dump).toContain('Refunds');
    expect(dump).not.toContain('font-mono');
  });
});
