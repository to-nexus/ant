/**
 * Pipeline activation — one axis, one file: the activation.json store
 * round-trip, the 1:1 uniqueness lookups, and the reconciler's disk-conflict
 * rule (earliest activatedAt wins; the loser is not scheduled/projected).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  saveActivation,
  loadActivation,
  deleteActivation,
  listActivations,
  findActivationByProject,
  PipelineValidationError,
} from '../../src/core/pipelines/store';
import { reconcilePipelines } from '../../src/infrastructure/scheduling/PipelineReconciler';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-actv-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const ACT = (projectId: string, activatedAt = '2026-08-20T00:00:00.000Z') => ({ projectId, activatedAt });

describe('activation store round-trip', () => {
  it('save → load → delete → null', async () => {
    await saveActivation(tmp, 'p1', ACT('proj-a'));
    expect(loadActivation(tmp, 'p1')).toEqual(ACT('proj-a'));
    deleteActivation(tmp, 'p1');
    expect(loadActivation(tmp, 'p1')).toBeNull();
  });

  it('missing file reads as deactivated (null), never a throw', () => {
    expect(loadActivation(tmp, 'ghost')).toBeNull();
  });

  it('an invalid sidecar throws (never silently deactivates)', () => {
    fs.mkdirSync(path.join(tmp, 'p1'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'p1', 'activation.json'), '{"activatedAt": "2026-08-20T00:00:00.000Z"}');
    expect(() => loadActivation(tmp, 'p1')).toThrow(PipelineValidationError);
  });

  it('saveActivation rejects an invalid record', async () => {
    await expect(saveActivation(tmp, 'p1', { projectId: '', activatedAt: 'x' } as any)).rejects.toThrow(
      PipelineValidationError,
    );
  });
});

describe('1:1 uniqueness lookups', () => {
  it('listActivations returns every activated pipeline; findActivationByProject resolves the binding', async () => {
    await saveActivation(tmp, 'p1', ACT('proj-a'));
    await saveActivation(tmp, 'p2', ACT('proj-b'));
    fs.mkdirSync(path.join(tmp, 'p3'), { recursive: true }); // deactivated
    expect(listActivations(tmp).map((x) => x.pipelineId)).toEqual(['p1', 'p2']);
    expect(findActivationByProject(tmp, 'proj-b')?.pipelineId).toBe('p2');
    expect(findActivationByProject(tmp, 'proj-z')).toBeNull();
  });
});

describe('reconciler — activation is the schedule authority, earliest wins a disk conflict', () => {
  function writePipeline(root: string, id: string, activation?: { projectId: string; activatedAt: string }) {
    const dir = path.join(root, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'pipeline.yaml'),
      yaml.dump({
        version: 2,
        name: id,
        on: { schedule: { cron: '0 9 * * 1' } },
        steps: [{ id: 'a', customJobRef: 'x/a', directive: 'a' }],
      }),
    );
    fs.writeFileSync(
      path.join(dir, 'owner.json'),
      JSON.stringify({ userId: 'user', organizationId: 'org', organizationKind: 'local' }),
    );
    if (activation) {
      fs.writeFileSync(path.join(dir, 'activation.json'), JSON.stringify(activation));
    }
  }

  function makeDeps() {
    const upserts: string[] = [];
    const removed: string[] = [];
    const keys = new Map<string, string>();
    return {
      upserts,
      removed,
      keys,
      deps: {
        stateStore: {
          acquireLock: async () => true,
          releaseLock: async () => {},
          getKey: async (k: string) => keys.get(k) ?? null,
          setKeyWithTTL: async (k: string, v: string) => void keys.set(k, v),
          deleteKey: async (k: string) => void keys.delete(k),
        } as any,
        scheduleQueue: {
          upsertCron: async (id: string) => void upserts.push(id),
          removeCron: async (id: string) => void removed.push(id),
          listCronIds: async () => [],
          armDelayed: async () => {},
          cancelDelayed: async () => {},
          addNow: async () => {},
          close: async () => {},
        } as any,
        workspacesPath: '',
      },
    };
  }

  it('schedules only ACTIVATED pipelines and projects both Redis keys', async () => {
    const pipelinesRoot = path.join(tmp, 'org', 'user', '.ant', 'pipelines');
    writePipeline(pipelinesRoot, 'active-one', ACT('proj-a'));
    writePipeline(pipelinesRoot, 'dormant');
    const { deps, upserts, keys } = makeDeps();
    deps.workspacesPath = tmp;
    await reconcilePipelines(deps as any);
    expect(upserts).toEqual(['pipe|org|user|active-one']);
    expect(keys.get('ant:pipe:proj:org:user:proj-a')).toBe('active-one');
    expect(JSON.parse(keys.get('ant:pipe:actv:org:user:active-one') ?? '{}').projectId).toBe('proj-a');
  });

  it('two activations naming one project: earliest activatedAt wins, loser is not scheduled', async () => {
    const pipelinesRoot = path.join(tmp, 'org', 'user', '.ant', 'pipelines');
    writePipeline(pipelinesRoot, 'later', ACT('proj-a', '2026-08-20T10:00:00.000Z'));
    writePipeline(pipelinesRoot, 'earlier', ACT('proj-a', '2026-08-19T10:00:00.000Z'));
    const { deps, upserts, keys } = makeDeps();
    deps.workspacesPath = tmp;
    await reconcilePipelines(deps as any);
    expect(upserts).toEqual(['pipe|org|user|earlier']);
    expect(keys.get('ant:pipe:proj:org:user:proj-a')).toBe('earlier');
    expect(keys.has('ant:pipe:actv:org:user:later')).toBe(false);
  });

  it('heals a stale overlap guard whose run doc is terminal', async () => {
    const pipelinesRoot = path.join(tmp, 'org', 'user', '.ant', 'pipelines');
    writePipeline(pipelinesRoot, 'p1', ACT('proj-a'));
    const { deps, keys } = makeDeps();
    deps.workspacesPath = tmp;
    keys.set('ant:pipe:active:org:user:p1', 'run-dead');
    // No ant:pipe:run:run-dead doc → the guard is stale and must be deleted.
    await reconcilePipelines(deps as any);
    expect(keys.has('ant:pipe:active:org:user:p1')).toBe(false);
  });
});
