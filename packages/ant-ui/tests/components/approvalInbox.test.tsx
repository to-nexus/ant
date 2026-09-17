/**
 * ApprovalInbox — the viewer is matched against rosters by the SERVER-SIDE id
 * (lowercased email), never `userEmail` (IdP casing): assignees/candidates
 * are lowercase, so a mixed-case email would never read as "you".
 */
import { describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const { storeState, useStoreMock } = vi.hoisted(() => {
  const storeState: any = {};
  const useStoreMock: any = (selector: any) => selector(storeState);
  useStoreMock.getState = () => storeState;
  return { storeState, useStoreMock };
});
vi.mock('@/domain/store', () => ({ useStore: useStoreMock }));
vi.mock('@/application/hooks/ui/useArtifactPickerTree', () => ({ useArtifactPickerTree: () => ({ tree: [], loading: false }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, fallback?: any, arg?: any) => (typeof fallback === 'string' ? fallback.replace('{{who}}', arg?.who ?? '') : k) }),
}));

import { ApprovalInbox } from '../../src/presentation/components/Pipelines/ApprovalInbox';

const gate = (gateId: string, assignees: string[]) => ({
  kind: 'gate',
  role: 'owner',
  gateId,
  runId: `run-${gateId}`,
  pipelineId: 'p1',
  projectId: 'proj-a',
  stepId: 'approve',
  cardId: `card-${gateId}`,
  prompt: 'ok?',
  armedAt: 'now',
  assignees,
  candidates: ['me@x.io', 'peer@x.io'],
});

function render(): string {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(<ApprovalInbox />);
  });
  return JSON.stringify(tree!.toJSON());
}

describe('ApprovalInbox viewer identity', () => {
  it('a gate assigned to the lowercase server id reads as yours even when userEmail carries IdP casing', () => {
    Object.assign(storeState, {
      userEmail: 'Me@X.io',
      userId: 'me@x.io',
      pipelineApprovals: [gate('g-peer', ['peer@x.io']), gate('g-me', ['me@x.io'])],
      resolvePipelineApprovalById: vi.fn(),
      answerPipelineClarifyById: vi.fn(),
      reassignPipelineGateTo: vi.fn(),
      openApproverPanel: vi.fn(),
      selectPipeline: vi.fn(),
      setPipelinePanelView: vi.fn(),
      selectActivationRun: vi.fn(),
    });
    const dump = render();
    expect(dump).toContain('Assigned to you');
    expect(dump).toContain('me@x.io (you)');
    // Routed-to-me rows sort first.
    expect(dump.indexOf('run-g-me')).toBeLessThan(dump.indexOf('run-g-peer'));
  });
});
