/**
 * Dismissed cancelled-card re-open affordance (sharp-choking-glove RCA).
 *
 * Dismiss withdraws implicit-continuation consent on the BE
 * (`interruption.dismissed`), but the work stays explicitly resumable — the
 * resolved card must keep a subdued "resume task" action that calls the
 * /resume route. The pill is gated on the card's own durable payload.jobId
 * (NOT the ambient kanban — the superseded-state archive keeps /resume valid
 * even after later jobs); a genuine 404 degrades it to a muted note.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const { storeState, useStoreMock, apiMock } = vi.hoisted(() => {
  const storeState: any = {
    isRunning: false,
    kanban: { jobId: 'job-1', interruption: { timestamp: 't1', canResume: true } },
    dismissedInterruptTimestamp: null,
    setDismissedInterruptTimestamp: vi.fn(),
    setRunning: vi.fn(),
    selectedProject: 'proj',
    selectedFeature: 'base',
    selectedJobType: 'design',
    setSelectedJobType: vi.fn(),
  };
  const useStoreMock: any = (selector: any) => selector(storeState);
  useStoreMock.getState = () => storeState;
  useStoreMock.setState = vi.fn();
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  const apiMock = {
    ApiError,
    dismissInterruptedJob: vi.fn(async () => ({})),
    resumeJob: vi.fn(async () => ({ jobId: 'job-1', jobType: 'design' })),
    resolveChoice: vi.fn(async () => ({})),
  };
  return { storeState, useStoreMock, apiMock };
});

vi.mock('@/domain/store', () => ({ useStore: useStoreMock }));
vi.mock('@/infrastructure/http/api', () => apiMock);
vi.mock('@/presentation/extensions/slots', () => ({ Slot: () => null }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { exists: () => false, language: 'en' },
  }),
}));

import { CancelledVariant } from '../../src/presentation/components/chat/choiceCard/CancelledVariant';

const presented = {
  type: 'choice_presented',
  ts: 't0',
  jobId: 'job-1',
  turnId: 'turn-1',
  jobType: 'design',
  cardId: 'cancelled-1',
  cardType: 'cancelled',
  prompt: 'Task stopped by user',
  payload: { reason: 'user_stopped', jobId: 'job-1' },
} as any;

const dismissedResolved = {
  type: 'choice_resolved',
  ts: 't1',
  cardId: 'cancelled-1',
  choiceSelected: 'dismiss',
  resolvedLabel: '닫힘',
} as any;

function renderCard(resolved?: any): ReactTestRenderer {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(<CancelledVariant presented={presented} resolved={resolved} />);
  });
  return tree!;
}

beforeEach(() => {
  vi.clearAllMocks();
  storeState.isRunning = false;
  storeState.kanban = { jobId: 'job-1', interruption: { timestamp: 't1', canResume: true } };
});

describe('CancelledVariant — job id header meta', () => {
  it('shows the job id chip on an unresolved interruption card', () => {
    storeState.kanban = { jobId: 'job-1', interruption: { timestamp: 't1', canResume: true } };
    const tree = renderCard();
    expect(JSON.stringify(tree.toJSON())).toContain('job-1');
  });

  it('still shows the job id chip after the card resolves (dismissed)', () => {
    const tree = renderCard(dismissedResolved);
    expect(JSON.stringify(tree.toJSON())).toContain('job-1');
  });
});

describe('CancelledVariant — dismissed card re-open affordance', () => {
  it('renders the reopen action on a dismissed card and calls resumeJob on click', async () => {
    const tree = renderCard(dismissedResolved);
    const buttons = tree.root.findAllByType('button');
    expect(buttons).toHaveLength(1);
    expect(JSON.stringify(tree.toJSON())).toContain('cancelled.reopen');

    await act(async () => {
      buttons[0].props.onClick();
    });
    expect(apiMock.resumeJob).toHaveBeenCalledWith('job-1', 'proj', 'base', true);
    expect(apiMock.resolveChoice).toHaveBeenCalledWith(
      'proj',
      'base',
      expect.objectContaining({ cardId: 'cancelled-1', choiceSelected: 'resume' }),
    );
  });

  it('STILL shows the reopen action when the kanban has moved on to a newer job (archive-backed)', () => {
    // The old `kanban.jobId === jobId` gate silently killed the pill across
    // reloads / tab switches / later jobs; the BE archive keeps /resume valid.
    storeState.kanban = { jobId: 'newer-job' };
    const tree = renderCard(dismissedResolved);
    expect(JSON.stringify(tree.toJSON())).toContain('cancelled.reopen');
  });

  it('degrades to a muted note (no button) after a reopen attempt 404s', async () => {
    apiMock.resumeJob.mockRejectedValueOnce(new (apiMock.ApiError as any)('No interrupted job found', 404));
    const tree = renderCard(dismissedResolved);
    const buttons = tree.root.findAllByType('button');
    await act(async () => {
      buttons[0].props.onClick();
    });
    const json = JSON.stringify(tree.toJSON());
    expect(json).not.toContain('cancelled.reopen"');
    expect(json).toContain('cancelled.reopenUnavailable');
  });

  it('hides the reopen action on a resume-resolved card', () => {
    const tree = renderCard({ ...dismissedResolved, choiceSelected: 'resume', resolvedLabel: 'Resumed' });
    expect(JSON.stringify(tree.toJSON())).not.toContain('cancelled.reopen');
  });

  it('hides the reopen action while another job is running', () => {
    storeState.isRunning = true;
    const tree = renderCard(dismissedResolved);
    expect(JSON.stringify(tree.toJSON())).not.toContain('cancelled.reopen');
  });
});
