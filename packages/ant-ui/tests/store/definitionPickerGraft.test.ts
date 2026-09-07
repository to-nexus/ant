/**
 * The two client-side grafts the universal `@ctx:` picker adds to the artifacts
 * tree — `_agents/` and `_pipelines/` — and the "empty ≠ unloaded" status the
 * pipeline graft reads. Offered ⇒ resolvable: every row these build must be a
 * path the agent plane resolves, filtered by the SAME shared rules the accept
 * gate applies.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create } from 'zustand';
import {
  PIPELINE_FILE_NAME,
  UNIVERSAL_AGENTS_DIRNAME,
  UNIVERSAL_PIPELINES_DIRNAME,
  type CustomAgentDefinitionFileNode,
  type PipelineListEntry,
} from '@ant/shared';
// The hook modules import the root store (which reaches `window` via the SSE
// manager); only their pure builders are under test here.
vi.mock('@/domain/store', () => ({ useStore: vi.fn() }));

import { buildPipelinesNode } from '../../src/application/hooks/ui/usePipelineDefinitionPickerTree';
import { buildAgentsNode, mapDefinitionNodes } from '../../src/application/hooks/ui/useAgentDefinitionPickerTree';

const api = vi.hoisted(() => ({
  activatePipeline: vi.fn(),
  deactivatePipeline: vi.fn(),
  enablePipeline: vi.fn(),
  disablePipeline: vi.fn(),
  promotePipeline: vi.fn(),
  updatePipelineEditors: vi.fn(),
  fetchActivatableProjects: vi.fn().mockResolvedValue({ projects: [] }),
  fetchActivePipeline: vi.fn(),
  fetchPipelines: vi.fn(),
  fetchPipeline: vi.fn(),
  createPipeline: vi.fn(),
  updatePipeline: vi.fn(),
  deletePipeline: vi.fn(),
  previewPipelineFires: vi.fn(),
  runPipelineNow: vi.fn(),
  fetchPipelineRuns: vi.fn().mockResolvedValue({ runs: [] }),
  fetchPipelineRun: vi.fn(),
  cancelPipelineRun: vi.fn(),
  fetchPipelineApprovals: vi.fn().mockResolvedValue({ approvals: [] }),
  resolvePipelineApproval: vi.fn(),
  answerPipelineClarify: vi.fn(),
  updateActivationApprovers: vi.fn(),
}));
vi.mock('@/infrastructure/http/api/pipelines', () => api);

import { createPipelineSlice } from '../../src/domain/store/slices/pipelineSlice';

const entry = (id: string, name: string, scope: PipelineListEntry['scope']): PipelineListEntry => ({
  id,
  name,
  stepCount: 1,
  scope,
  readonly: scope === 'org',
  enabled: false,
  activations: [],
  pendingApprovalCount: 0,
});

describe('buildPipelinesNode', () => {
  it('one `pipeline.yaml` file per pipeline under `_pipelines/{id}`, org rows suffixed', () => {
    const node = buildPipelinesNode([entry('nightly', 'Nightly digest', 'user'), entry('shared', 'Shared', 'org')], 'Pipeline Definitions');
    expect(node).toEqual({
      name: 'Pipeline Definitions',
      path: UNIVERSAL_PIPELINES_DIRNAME,
      type: 'directory',
      children: [
        {
          name: 'Nightly digest',
          path: `${UNIVERSAL_PIPELINES_DIRNAME}/nightly`,
          type: 'directory',
          children: [{ name: PIPELINE_FILE_NAME, path: `${UNIVERSAL_PIPELINES_DIRNAME}/nightly/${PIPELINE_FILE_NAME}`, type: 'file' }],
        },
        {
          name: 'Shared · org',
          path: `${UNIVERSAL_PIPELINES_DIRNAME}/shared`,
          type: 'directory',
          children: [{ name: PIPELINE_FILE_NAME, path: `${UNIVERSAL_PIPELINES_DIRNAME}/shared/${PIPELINE_FILE_NAME}`, type: 'file' }],
        },
      ],
    });
  });

  it('is null with no pipelines — the group row never renders empty', () => {
    expect(buildPipelinesNode([], 'x')).toBeNull();
  });
});

describe('mapDefinitionNodes — offered ⇒ resolvable', () => {
  const prefix = `${UNIVERSAL_AGENTS_DIRNAME}/ops`;
  const serverTree: CustomAgentDefinitionFileNode[] = [
    { name: 'agent.yaml', path: 'agent.yaml', type: 'file' },
    { name: 'stray.txt', path: 'stray.txt', type: 'file' },
    { name: '.DS_Store', path: '.DS_Store', type: 'file' },
    { name: 'scratch', path: 'scratch', type: 'directory', children: [{ name: 'a.md', path: 'scratch/a.md', type: 'file' }] },
    {
      name: 'jobs',
      path: 'jobs',
      type: 'directory',
      children: [
        {
          name: 'weekly',
          path: 'jobs/weekly',
          type: 'directory',
          children: [
            { name: 'job.yaml', path: 'jobs/weekly/job.yaml', type: 'file' },
            { name: 'notes.txt', path: 'jobs/weekly/notes.txt', type: 'file' },
            {
              name: 'intents',
              path: 'jobs/weekly/intents',
              type: 'directory',
              children: [
                {
                  name: 'review',
                  path: 'jobs/weekly/intents/review',
                  type: 'directory',
                  children: [
                    { name: 'prompt.md', path: 'jobs/weekly/intents/review/prompt.md', type: 'file' },
                    { name: 'draft.md', path: 'jobs/weekly/intents/review/draft.md', type: 'file' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    { name: 'on-demand', path: 'on-demand', type: 'directory', children: [{ name: 'api.md', path: 'on-demand/api.md', type: 'file' }] },
  ];

  const flatten = (nodes: ReturnType<typeof mapDefinitionNodes>): string[] =>
    nodes.flatMap((n) => [n.path, ...flatten(n.children ?? [])]);

  it('drops files the gate refuses and directories of unknown shape, keeps the whitelist re-rooted', () => {
    const paths = flatten(mapDefinitionNodes(serverTree, prefix));
    expect(paths).toEqual([
      `${prefix}/agent.yaml`,
      `${prefix}/jobs`,
      `${prefix}/jobs/weekly`,
      `${prefix}/jobs/weekly/job.yaml`,
      `${prefix}/jobs/weekly/intents`,
      `${prefix}/jobs/weekly/intents/review`,
      `${prefix}/jobs/weekly/intents/review/prompt.md`,
      `${prefix}/on-demand`,
      `${prefix}/on-demand/api.md`,
    ]);
    for (const refused of ['stray.txt', '.DS_Store', 'scratch', 'scratch/a.md', 'jobs/weekly/notes.txt', 'jobs/weekly/intents/review/draft.md']) {
      expect(paths).not.toContain(`${prefix}/${refused}`);
    }
  });

  it('buildAgentsNode labels rows by display name (+ scope) while paths stay ids', () => {
    const node = buildAgentsNode(
      [
        { id: 'ops', name: 'Payments Ops', scope: 'org', readonly: true, jobs: [] } as any,
        { id: 'mine', name: 'Mine', scope: 'user', readonly: false, jobs: [] } as any,
      ],
      { ops: { tree: serverTree } },
      'Agent Definitions',
    );
    expect(node?.children?.map((c) => [c.name, c.path])).toEqual([
      ['Payments Ops · org', `${UNIVERSAL_AGENTS_DIRNAME}/ops`],
      ['Mine', `${UNIVERSAL_AGENTS_DIRNAME}/mine`],
    ]);
    // An agent whose tree is not loaded stays as an empty directory — the row is what triggers the fetch.
    expect(node?.children?.[1].children).toEqual([]);
  });
});

describe('pipelineSlice.ensurePipelinesLoaded — an empty list is not "never loaded"', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchPipelines.mockResolvedValue({ pipelines: [], invalid: [], orphanActivations: [] });
  });

  const makeStore = () => create<any>()((set, get, store) => ({ ...createPipelineSlice(set as any, get as any, store as any) }));

  it('fetches once from idle, then holds `ready` even with zero pipelines', async () => {
    const s = makeStore();
    expect(s.getState().pipelinesStatus).toBe('idle');
    await s.getState().ensurePipelinesLoaded();
    await s.getState().ensurePipelinesLoaded();
    expect(api.fetchPipelines).toHaveBeenCalledTimes(1);
    expect(s.getState().pipelinesStatus).toBe('ready');
    expect(s.getState().pipelines).toEqual([]);
  });

  it('dedupes concurrent callers while loading', async () => {
    const s = makeStore();
    let release: (v: unknown) => void = () => {};
    api.fetchPipelines.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const a = s.getState().ensurePipelinesLoaded();
    expect(s.getState().pipelinesStatus).toBe('loading');
    const b = s.getState().ensurePipelinesLoaded();
    release({ pipelines: [], invalid: [], orphanActivations: [] });
    await Promise.all([a, b]);
    expect(api.fetchPipelines).toHaveBeenCalledTimes(1);
  });

  it('records a failure as `error` and retries on the next ensure', async () => {
    const s = makeStore();
    api.fetchPipelines.mockRejectedValueOnce(new Error('HTTP 500'));
    await s.getState().ensurePipelinesLoaded();
    expect(s.getState().pipelinesStatus).toBe('error');
    expect(s.getState().pipelinesError).toBe('HTTP 500');
    await s.getState().ensurePipelinesLoaded();
    expect(api.fetchPipelines).toHaveBeenCalledTimes(2);
    expect(s.getState().pipelinesStatus).toBe('ready');
  });
});
