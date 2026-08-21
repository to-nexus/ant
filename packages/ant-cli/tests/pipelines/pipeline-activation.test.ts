/**
 * Pipeline activation + availability — one axis, one file: the
 * activation.json store round-trip (activator-account, projectId-keyed),
 * the availability sidecar (missing = disabled draft), and the reconciler
 * (activations drive scheduling; disabled/unresolvable defs never schedule;
 * orphan crons are swept; stale overlap guards heal per project).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  saveActivationRecord,
  loadActivationByProject,
  deleteActivationRecord,
  listAccountActivations,
  findActivationsForPipeline,
  loadAvailability,
  saveAvailability,
  PipelineValidationError,
} from '../../src/core/pipelines/store';
import { reconcilePipelines } from '../../src/infrastructure/scheduling/PipelineReconciler';
import { deactivatePipelineBinding } from '../../src/infrastructure/scheduling/deactivateBinding';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-actv-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const ACT = (pipelineId: string, projectId: string, activatedAt = '2026-08-20T00:00:00.000Z') => ({
  pipelineId,
  pipelineScope: 'user' as 'user' | 'org',
  projectId,
  activatedAt,
});

describe('activation store round-trip (activator account, projectId-keyed)', () => {
  it('save → load → delete → null; runs dir survives deletion', async () => {
    await saveActivationRecord(tmp, ACT('p1', 'proj-a'));
    fs.mkdirSync(path.join(tmp, 'proj-a', 'runs'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'proj-a', 'runs', 'index.jsonl'), '');
    expect(loadActivationByProject(tmp, 'proj-a')).toEqual(ACT('p1', 'proj-a'));
    deleteActivationRecord(tmp, 'proj-a');
    expect(loadActivationByProject(tmp, 'proj-a')).toBeNull();
    expect(fs.existsSync(path.join(tmp, 'proj-a', 'runs', 'index.jsonl'))).toBe(true);
  });

  it('missing file reads as deactivated (null), never a throw', () => {
    expect(loadActivationByProject(tmp, 'ghost')).toBeNull();
  });

  it('rejects a traversal projectId at the store boundary before any fs access (H-016)', () => {
    for (const bad of ['../victim', '..', 'a/b', 'a\\b', '/etc', 'proj\0']) {
      expect(() => loadActivationByProject(tmp, bad)).toThrow();
      expect(() => deleteActivationRecord(tmp, bad)).toThrow();
    }
  });

  it('an invalid sidecar throws (never silently deactivates)', () => {
    fs.mkdirSync(path.join(tmp, 'proj-a'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'proj-a', 'activation.json'), '{"activatedAt": "2026-08-20T00:00:00.000Z"}');
    expect(() => loadActivationByProject(tmp, 'proj-a')).toThrow(PipelineValidationError);
  });

  it('saveActivationRecord rejects a record without pipelineId/scope', async () => {
    await expect(
      saveActivationRecord(tmp, { projectId: 'proj-a', activatedAt: '2026-08-20T00:00:00.000Z' } as any),
    ).rejects.toThrow(PipelineValidationError);
  });

  it('listAccountActivations returns every activated project; one project = one activation (structural)', async () => {
    await saveActivationRecord(tmp, ACT('p1', 'proj-a'));
    await saveActivationRecord(tmp, ACT('p2', 'proj-b'));
    fs.mkdirSync(path.join(tmp, 'proj-c'), { recursive: true }); // deactivated (runs remain)
    expect(listAccountActivations(tmp).map((a) => `${a.pipelineId}:${a.projectId}`)).toEqual([
      'p1:proj-a',
      'p2:proj-b',
    ]);
  });

  it('findActivationsForPipeline sweeps every org member (disable gate / org visibility)', async () => {
    const a = path.join(tmp, 'org', 'alice', '.ant', 'pipeline-activations');
    const b = path.join(tmp, 'org', 'bob', '.ant', 'pipeline-activations');
    await saveActivationRecord(a, { ...ACT('shared', 'proj-a'), pipelineScope: 'org' });
    await saveActivationRecord(b, { ...ACT('shared', 'proj-b'), pipelineScope: 'org' });
    await saveActivationRecord(b, ACT('other', 'proj-c'));
    const holders = findActivationsForPipeline(tmp, 'org', 'shared');
    expect(holders.map((h) => `${h.userId}:${h.activation.projectId}`).sort()).toEqual([
      'alice:proj-a',
      'bob:proj-b',
    ]);
  });
});

describe('deactivatePipelineBinding — the ONE deactivation authority (route + delete/rename cascade)', () => {
  const OWNER = { userId: 'user', organizationId: 'local', organizationKind: 'local' as const };

  function makeBindingDeps() {
    const removed: string[] = [];
    const deactivated: string[] = [];
    const deletedKeys: string[] = [];
    const published: any[] = [];
    return {
      removed,
      deactivated,
      deletedKeys,
      published,
      deps: {
        workspacesPath: tmp,
        scheduleQueue: { removeCron: async (id: string) => void removed.push(id) },
        coordinator: { deactivate: async (_o: any, projectId: string) => void deactivated.push(projectId) },
        stateStore: {
          deleteKey: async (k: string) => void deletedKeys.push(k),
          publish: async (_ch: string, msg: any) => void published.push(msg),
        },
      },
    };
  }

  const actRoot = () => path.join(tmp, 'local', 'user', '.ant', 'pipeline-activations');

  it('runs every leg in order: cron off → run cancelled → unlink (runs survive) → projections → SSE', async () => {
    await saveActivationRecord(actRoot(), ACT('p1', 'proj-a'));
    fs.mkdirSync(path.join(actRoot(), 'proj-a', 'runs'), { recursive: true });
    fs.writeFileSync(path.join(actRoot(), 'proj-a', 'runs', 'index.jsonl'), '');
    const { deps, removed, deactivated, deletedKeys, published } = makeBindingDeps();
    const result = await deactivatePipelineBinding(deps as any, OWNER, 'proj-a');
    expect(result).toEqual({ hadActivation: true, pipelineId: 'p1' });
    expect(removed).toEqual(['pipe|local|user|proj-a']);
    expect(deactivated).toEqual(['proj-a']);
    expect(loadActivationByProject(actRoot(), 'proj-a')).toBeNull();
    expect(fs.existsSync(path.join(actRoot(), 'proj-a', 'runs', 'index.jsonl'))).toBe(true);
    expect(deletedKeys.sort()).toEqual(['ant:pipe:actv:local:user:proj-a', 'ant:pipe:proj:local:user:proj-a']);
    expect(published).toHaveLength(1);
    expect(published[0].data).toMatchObject({
      cause: 'activationChanged',
      pipelineId: 'p1',
      projectId: 'proj-a',
      activation: null,
    });
  });

  it('no activation = idempotent no-op success that still heals orphan cron/projections, no SSE', async () => {
    const { deps, removed, deletedKeys, published } = makeBindingDeps();
    const result = await deactivatePipelineBinding(deps as any, OWNER, 'ghost');
    expect(result).toEqual({ hadActivation: false, pipelineId: null });
    expect(removed).toEqual(['pipe|local|user|ghost']);
    expect(deletedKeys).toHaveLength(2);
    expect(published).toEqual([]);
  });

  it('an unreadable sidecar is cleared; the SSE pipelineId comes from the hint', async () => {
    fs.mkdirSync(path.join(actRoot(), 'proj-a'), { recursive: true });
    fs.writeFileSync(path.join(actRoot(), 'proj-a', 'activation.json'), '{"broken":');
    const { deps, published } = makeBindingDeps();
    const result = await deactivatePipelineBinding(deps as any, OWNER, 'proj-a', { pipelineIdHint: 'p1' });
    expect(result).toEqual({ hadActivation: true, pipelineId: 'p1' });
    expect(fs.existsSync(path.join(actRoot(), 'proj-a', 'activation.json'))).toBe(false);
    expect(published[0].data).toMatchObject({ pipelineId: 'p1', activation: null });
  });
});

describe('availability sidecar — missing = disabled draft', () => {
  it('missing file reads disabled; save → load round-trips', async () => {
    fs.mkdirSync(path.join(tmp, 'p1'), { recursive: true });
    expect(loadAvailability(tmp, 'p1').enabled).toBe(false);
    await saveAvailability(tmp, 'p1', { enabled: true, changedAt: '2026-08-20T00:00:00.000Z', changedBy: 'me' });
    expect(loadAvailability(tmp, 'p1').enabled).toBe(true);
  });

  it('a corrupt sidecar throws (never silently enables)', () => {
    fs.mkdirSync(path.join(tmp, 'p1'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'p1', 'availability.json'), '{"enabled": "yes"}');
    expect(() => loadAvailability(tmp, 'p1')).toThrow(PipelineValidationError);
  });
});

describe('reconciler — activations drive scheduling; pinned scope; availability gates', () => {
  function writeDef(defRoot: string, id: string, opts: { enabled?: boolean } = {}) {
    const dir = path.join(defRoot, id);
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
      path.join(dir, 'availability.json'),
      JSON.stringify({ enabled: opts.enabled ?? true, changedAt: '2026-08-20T00:00:00.000Z' }),
    );
  }

  function writeActivation(ws: string, org: string, user: string, activation: ReturnType<typeof ACT>) {
    const dir = path.join(ws, org, user, '.ant', 'pipeline-activations', activation.projectId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'activation.json'), JSON.stringify(activation));
  }

  function makeDeps(registered: string[] = []) {
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
          listCronIds: async () => registered,
          armDelayed: async () => {},
          cancelDelayed: async () => {},
          addNow: async () => {},
          close: async () => {},
        } as any,
        workspacesPath: '',
      },
    };
  }

  // Fixture org ids matter: the kind derives from the org id ('local' → local,
  // 'individual' → individual, else team), and a team-kind user's PERSONAL
  // defs anchor under the INDIVIDUAL org — so local/individual fixtures keep
  // defs and activations under one org dir.
  it('schedules an activation of an enabled def and projects both Redis keys (projectId-keyed)', async () => {
    writeDef(path.join(tmp, 'local', 'user', '.ant', 'pipelines'), 'p1');
    writeActivation(tmp, 'local', 'user', ACT('p1', 'proj-a'));
    const { deps, upserts, keys } = makeDeps();
    deps.workspacesPath = tmp;
    await reconcilePipelines(deps as any);
    expect(upserts).toEqual(['pipe|local|user|proj-a']);
    expect(keys.get('ant:pipe:proj:local:user:proj-a')).toBe('p1');
    expect(JSON.parse(keys.get('ant:pipe:actv:local:user:proj-a') ?? '{}').pipelineId).toBe('p1');
  });

  it('one pipeline, two projects (even across users) — both activations schedule', async () => {
    writeDef(path.join(tmp, 'individual', 'alice', '.ant', 'pipelines'), 'p1');
    writeDef(path.join(tmp, 'individual', 'bob', '.ant', 'pipelines'), 'p1');
    writeActivation(tmp, 'individual', 'alice', ACT('p1', 'proj-a'));
    writeActivation(tmp, 'individual', 'bob', ACT('p1', 'proj-b'));
    const { deps, upserts } = makeDeps();
    deps.workspacesPath = tmp;
    await reconcilePipelines(deps as any);
    expect(upserts.sort()).toEqual(['pipe|individual|alice|proj-a', 'pipe|individual|bob|proj-b']);
  });

  it('a team member ORG-scope activation resolves the def at the org root', async () => {
    writeDef(path.join(tmp, 'acme', '.ant', 'pipelines'), 'shared');
    writeActivation(tmp, 'acme', 'alice', { ...ACT('shared', 'proj-a'), pipelineScope: 'org' });
    const { deps, upserts } = makeDeps();
    deps.workspacesPath = tmp;
    await reconcilePipelines(deps as any);
    expect(upserts).toEqual(['pipe|acme|alice|proj-a']);
  });

  it('a DISABLED def is never scheduled (hand-edited sidecar)', async () => {
    writeDef(path.join(tmp, 'local', 'user', '.ant', 'pipelines'), 'p1', { enabled: false });
    writeActivation(tmp, 'local', 'user', ACT('p1', 'proj-a'));
    const { deps, upserts } = makeDeps();
    deps.workspacesPath = tmp;
    await reconcilePipelines(deps as any);
    expect(upserts).toEqual([]);
  });

  it('an activation whose pinned def is missing is skipped, never deleted', async () => {
    writeActivation(tmp, 'local', 'user', ACT('ghost', 'proj-a'));
    const { deps, upserts } = makeDeps();
    deps.workspacesPath = tmp;
    await reconcilePipelines(deps as any);
    expect(upserts).toEqual([]);
    expect(fs.existsSync(path.join(tmp, 'local', 'user', '.ant', 'pipeline-activations', 'proj-a', 'activation.json'))).toBe(true);
  });

  it('sweeps orphan crons, including old-format (pipelineId-keyed) scheduler ids', async () => {
    writeDef(path.join(tmp, 'local', 'user', '.ant', 'pipelines'), 'p1');
    writeActivation(tmp, 'local', 'user', ACT('p1', 'proj-a'));
    const { deps, removed } = makeDeps(['pipe|local|user|proj-a', 'pipe|local|user|p-old', 'other|thing']);
    deps.workspacesPath = tmp;
    await reconcilePipelines(deps as any);
    expect(removed).toEqual(['pipe|local|user|p-old']);
  });

  it('heals a stale overlap guard whose run doc is terminal (projectId key)', async () => {
    writeDef(path.join(tmp, 'local', 'user', '.ant', 'pipelines'), 'p1');
    writeActivation(tmp, 'local', 'user', ACT('p1', 'proj-a'));
    const { deps, keys } = makeDeps();
    deps.workspacesPath = tmp;
    keys.set('ant:pipe:active:local:user:proj-a', 'run-dead');
    // No ant:pipe:run:run-dead doc → the guard is stale and must be deleted.
    await reconcilePipelines(deps as any);
    expect(keys.has('ant:pipe:active:local:user:proj-a')).toBe(false);
  });
});
