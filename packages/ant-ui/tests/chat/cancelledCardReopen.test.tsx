/**
 * Dismissed cancelled-card re-open affordance (sharp-choking-glove RCA).
 *
 * Dismiss withdraws implicit-continuation consent on the BE
 * (`interruption.dismissed`), but the work stays explicitly resumable — the
 * resolved card must keep a subdued "resume task" action that calls the
 * /resume route, and only while the kanban still points at this job.
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
  const apiMock = {
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
  useTranslation: () => ({ t: (k: string) => k }),
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

  it('hides the reopen action when the kanban has moved on to a newer job', () => {
    storeState.kanban = { jobId: 'newer-job' };
    const tree = renderCard(dismissedResolved);
    expect(JSON.stringify(tree.toJSON())).not.toContain('cancelled.reopen');
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
