/**
 * `useChoiceCardState.persistToBackend` reports what the BE did.
 *
 * The optimistic disable is applied BEFORE the request, so a swallowed failure
 * left a card that looked answered while nothing was persisted — reload, and
 * the card asked again (2026-09-18 clarify report). The hook now returns a
 * typed result the variant rolls back on; this pins that contract.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const { storeState, useStoreMock, apiMock, clientMock } = vi.hoisted(() => {
  const storeState: any = { selectedProject: 'proj', selectedFeature: 'universal' };
  const useStoreMock: any = (selector: any) => selector(storeState);
  useStoreMock.getState = () => storeState;
  class ApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  const apiMock = { resolveChoice: vi.fn() };
  return { storeState, useStoreMock, apiMock, clientMock: { ApiError } };
});

vi.mock('@/domain/store', () => ({ useStore: useStoreMock }));
vi.mock('@/infrastructure/http/api', () => apiMock);
vi.mock('@/infrastructure/http/api/client', () => clientMock);
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { exists: () => false, language: 'en' } }),
}));

import { useChoiceCardState } from '../../src/presentation/components/chat/choiceCard/shared';

const presented = { type: 'choice_presented', ts: 't0', jobId: 'j1', turnId: 't1', jobType: 'universal', cardId: 'card-1', cardType: 'clarifying' } as any;

function mount() {
  let latest: ReturnType<typeof useChoiceCardState> | null = null;
  function Probe() {
    latest = useChoiceCardState({ presented });
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(<Probe />);
  });
  return { get: () => latest!, unmount: () => renderer?.unmount() };
}

describe('useChoiceCardState.persistToBackend — typed result', () => {
  it('success carries the pipeline clarify fate the BE reported', async () => {
    apiMock.resolveChoice.mockResolvedValueOnce({ success: true, resolved: true, clarify: 'held' });
    const { get, unmount } = mount();
    let result: any;
    await act(async () => {
      result = await get().persistToBackend('submitted', 'Answered', { directive: 'a' });
    });
    expect(result).toEqual({ ok: true, clarify: 'held' });
    expect(apiMock.resolveChoice).toHaveBeenCalledWith('proj', 'universal', expect.objectContaining({ cardId: 'card-1', choiceSelected: 'submitted' }));
    unmount();
  });

  it.each([
    [409, 'clarify-not-awaiting'],
    [503, 'clarify-retry'],
    [404, undefined],
  ])('a %s refusal surfaces status + code instead of being swallowed', async (status, code) => {
    apiMock.resolveChoice.mockRejectedValueOnce(new clientMock.ApiError('refused', status, code));
    const { get, unmount } = mount();
    let result: any;
    await act(async () => {
      result = await get().persistToBackend('submitted', 'Answered');
    });
    expect(result).toEqual({ ok: false, status, code });
    unmount();
  });

  it('without a project/feature selection nothing is sent and the result says so', async () => {
    storeState.selectedProject = null;
    const { get, unmount } = mount();
    let result: any;
    await act(async () => {
      result = await get().persistToBackend('submitted', 'Answered');
    });
    expect(result).toEqual({ ok: false, code: 'no-selection' });
    storeState.selectedProject = 'proj';
    unmount();
  });
});
