/**
 * StepRunInspector — the read-only drawer a locked/running pipeline's canvas
 * node opens. Assertions target data attributes, element types and i18n KEYS
 * (the react-i18next mock returns keys), never prose. The two cards (run,
 * definition), the run-state ladder, run-chip focus switching and the absence
 * of any form control are the contract.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { PipelineDef, PipelineLiveRun } from '@ant/shared';
import type { PipelineRunPublic } from '../../src/domain/store/slices/pipelineSlice';

const { storeState, useStoreMock } = vi.hoisted(() => {
  const storeState: any = { selectJobId: () => {}, selectedProject: 'proj-a' };
  const useStoreMock: any = (selector: any) => selector(storeState);
  useStoreMock.getState = () => storeState;
  return { storeState, useStoreMock };
});
vi.mock('@/domain/store', () => ({ useStore: useStoreMock }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
// The shell's resize hook touches `document.body`; the node env has none. Chrome is not under test.
vi.mock('../../src/presentation/components/Pipelines/InspectorShell', () => ({
  InspectorShell: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-shell={title}>{children}</div>
  ),
}));

import { StepRunInspector, type StepRunInspectorProps } from '../../src/presentation/components/Pipelines/StepRunInspector';

const DEF = {
  version: 2,
  name: 'refund',
  steps: [
    { id: 'calc', customJobRef: 'ops/refund', directive: 'calc' },
    { id: 'gate', type: 'approval', prompt: 'ok?' },
    { id: 'pay', customJobRef: 'ops/refund', directive: 'pay' },
  ],
} as unknown as PipelineDef;

const live = (runId: string, currentStepIds: string[], startedAt = '2026-09-17T00:00:00.000Z'): PipelineLiveRun => ({
  runId,
  status: 'running',
  startedAt,
  firedBy: 'manual',
  currentStepIds,
});

const detail = (runId: string, payStatus: PipelineRunPublic['steps'][number]['status']): PipelineRunPublic =>
  ({
    runId,
    steps: [
      { stepId: 'calc', status: 'succeeded', jobId: 'job-calc', startedAt: '2026-09-17T00:00:00.000Z', endedAt: '2026-09-17T00:01:00.000Z' },
      { stepId: 'gate', status: 'succeeded', gate: { decision: 'approved', decidedBy: 'a@x.io' } },
      { stepId: 'pay', status: payStatus, jobId: 'job-pay', startedAt: '2026-09-17T00:02:00.000Z' },
    ],
  }) as unknown as PipelineRunPublic;

function render(over: Partial<StepRunInspectorProps>): ReactTestRenderer {
  const props: StepRunInspectorProps = {
    def: DEF,
    nodeId: 'pay',
    onClose: () => {},
    customAgents: [{ id: 'ops', name: 'Ops', jobs: [{ id: 'refund', name: 'Refund' }] }],
    cronSummary: 'every day',
    liveRuns: [live('r1', ['pay'])],
    runDetails: { r1: detail('r1', 'running') },
    selectedRunId: null,
    ...over,
  };
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(<StepRunInspector {...props} />);
  });
  return tree!;
}

const sections = (tree: ReactTestRenderer) => tree.root.findAll((n) => n.type === 'section' && typeof n.props['data-section'] === 'string').map((n) => n.props['data-section']);
const runState = (tree: ReactTestRenderer) => tree.root.find((n) => typeof n.props?.['data-run-state'] === 'string').props['data-run-state'];
const byProp = (tree: ReactTestRenderer, prop: string) => tree.root.findAll((n) => n.props?.[prop] !== undefined);

describe('StepRunInspector — the run first, then the saved definition, nothing editable', () => {
  it('renders the run card with the focused record and the definition card, and no form control anywhere', () => {
    const tree = render({});
    expect(sections(tree)).toEqual(['run', 'definition']);
    expect(runState(tree)).toBe('focused');
    expect(byProp(tree, 'data-job-id').map((n) => n.props['data-job-id'])).toEqual(['job-pay']);
    expect(byProp(tree, 'data-step-status')[0].props['data-step-status']).toBe('running');
    expect(byProp(tree, 'data-step-timing').length).toBe(1);
    // Definition rows reuse the editor's label keys; `pay` inherits its edge from the previous step.
    const dump = JSON.stringify(tree.toJSON());
    expect(dump).toContain('step.needs');
    expect(dump).toContain('step.needsImplicit');
    expect(dump).toContain('step.onSuccess');
    expect(dump).toContain('step.agent');
    expect(dump).not.toContain('inspector.deleteStep');
    expect(tree.root.findAll((n) => typeof n.type === 'string' && ['input', 'textarea', 'select'].includes(n.type))).toEqual([]);
  });

  it('the card status follows the record status (running → todo, failed → warn, succeeded → ok)', () => {
    const status = (tree: ReactTestRenderer) => tree.root.find((n) => n.type === 'section' && n.props['data-section'] === 'run').findAll((n) => n.props?.['data-status'] !== undefined)[0]?.props['data-status'];
    expect(status(render({}))).toBe('todo');
    expect(status(render({ runDetails: { r1: detail('r1', 'failed') } }))).toBe('warn');
    expect(status(render({ runDetails: { r1: detail('r1', 'succeeded') } }))).toBe('ok');
  });

  it('two live runs at the step render two chips; clicking the non-focused one selects that run', () => {
    const onSelectRun = vi.fn();
    const tree = render({
      liveRuns: [live('r1', ['pay'], '2026-09-17T00:00:02.000Z'), live('r2', ['pay'], '2026-09-17T00:00:01.000Z')],
      runDetails: { r1: detail('r1', 'running'), r2: detail('r2', 'running') },
      selectedRunId: 'r2',
      onSelectRun,
    });
    const chips = byProp(tree, 'data-run-chip');
    expect(chips.map((c) => c.props['data-run-chip'])).toEqual(['r1', 'r2']);
    expect(chips.find((c) => c.props['data-run-chip'] === 'r2')!.props['data-focused']).toBe(true);
    act(() => {
      chips[0].props.onClick();
    });
    expect(onSelectRun).toHaveBeenCalledWith('r1');
  });

  it('a single run at the step draws no chip row — the record alone is the picture', () => {
    expect(byProp(render({}), 'data-run-chip')).toEqual([]);
  });

  it('the run-state ladder: no live runs → noLiveRuns; detail not held → detailLoading; pending → notReached', () => {
    expect(runState(render({ liveRuns: [], runDetails: {} }))).toBe('noLiveRuns');
    expect(runState(render({ runDetails: {} }))).toBe('detailLoading');
    expect(runState(render({ liveRuns: [live('r1', ['calc'])], runDetails: { r1: detail('r1', 'pending') } }))).toBe('notReached');
  });

  it('the trigger node lists every live run as a chip and carries the live count, with no step record', () => {
    const tree = render({ nodeId: 'trigger', liveRuns: [live('r1', ['calc']), live('r2', ['pay'])] });
    expect(byProp(tree, 'data-run-chip').map((c) => c.props['data-run-chip'])).toEqual(['r1', 'r2']);
    expect(byProp(tree, 'data-step-status')).toEqual([]);
    expect(JSON.stringify(tree.toJSON())).toContain('execution.liveCount');
  });

  it('a gate node shows the activation roster and the wait-forever default', () => {
    const tree = render({ nodeId: 'gate', approversByGate: { gate: ['a@x.io', 'b@x.io'] } });
    expect(byProp(tree, 'data-gate-approvers')[0].children.length).toBe(2);
    expect(JSON.stringify(tree.toJSON())).toContain('gate.noTimeout');
    expect(byProp(render({ nodeId: 'gate' }), 'data-gate-approvers')).toEqual([]);
  });
});
