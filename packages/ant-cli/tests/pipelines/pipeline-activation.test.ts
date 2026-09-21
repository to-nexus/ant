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
  findPipelineRoot,
  PipelineValidationError,
} from '../../src/core/pipelines/store';
import { reconcilePipelines, SLOT_HEAL_GRACE_MS } from '../../src/infrastructure/scheduling/PipelineReconciler';
import { REDIS_TTL, parseRunSlotMember } from '../../src/core/constants/redis';
import { RUN_SESSION_FILE_RETENTION } from '../../src/infrastructure/scheduling/pipelineRun/sessionRetention';
import { deactivatePipelineBinding } from '../../src/infrastructure/scheduling/deactivateBinding';
import { listAccountActivationsResolved } from '../../src/infrastructure/scheduling/resolveActivation';

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

  function makeBindingDeps(seed: Record<string, string> = {}) {
    const removed: string[] = [];
    const deactivated: string[] = [];
    const deletedKeys: string[] = [];
    const published: any[] = [];
    const released: string[] = [];
    const keys = new Map<string, string>(Object.entries(seed));
    return {
      removed,
      deactivated,
      deletedKeys,
      published,
      released,
      keys,
      deps: {
        workspacesPath: tmp,
        scheduleQueue: { removeCron: async (id: string) => void removed.push(id) },
        coordinator: { deactivate: async (_o: any, projectId: string) => void deactivated.push(projectId) },
        stateStore: {
          getKey: async (k: string) => keys.get(k) ?? null,
          setKeyWithTTL: async (k: string, v: string) => void keys.set(k, v),
          deleteKey: async (k: string) => {
            deletedKeys.push(k);
            keys.delete(k);
          },
          publish: async (_ch: string, msg: any) => void published.push(msg),
          releaseSlot: async (k: string, member: string) => void released.push(`${k}|${member}`),
        },
      },
    };
  }

  const actRoot = () => path.join(tmp, 'local', 'user', '.ant', 'pipeline-activations');

  it('runs every leg in order: cron off → run cancelled → unlink (runs survive) → projections → SSE', async () => {
    await saveActivationRecord(actRoot(), ACT('p1', 'proj-a'));
    fs.mkdirSync(path.join(actRoot(), 'proj-a', 'runs'), { recursive: true });
    fs.writeFileSync(path.join(actRoot(), 'proj-a', 'runs', 'index.jsonl'), '');
    const { deps, removed, deactivated, deletedKeys, published, released, keys } = makeBindingDeps();
    const result = await deactivatePipelineBinding(deps as any, OWNER, 'proj-a');
    expect(result).toEqual({ hadActivation: true, pipelineId: 'p1' });
    // The list-path index goes with the projection.
    expect(released).toEqual(['ant:pipe:actv-idx:local:user|proj-a']);
    // The tombstone lands before the unlink — the unlink is not verifiable from here.
    expect(JSON.parse(keys.get('ant:pipe:deact:local:user:proj-a') ?? '{}')).toMatchObject({ pipelineId: 'p1' });
    // Both scheduler ids go (a cron's and a fetch poller's — the binding does not know which it had).
    expect(removed).toEqual(['pipe|local|user|proj-a', 'fetch|local|user|proj-a']);
    expect(deactivated).toEqual(['proj-a']);
    expect(loadActivationByProject(actRoot(), 'proj-a')).toBeNull();
    expect(fs.existsSync(path.join(actRoot(), 'proj-a', 'runs', 'index.jsonl'))).toBe(true);
    // Projections + poll telemetry + the claim-projection marker; the item claims themselves survive (history).
    expect(deletedKeys.sort()).toEqual([
      'ant:pipe:actv:local:user:proj-a',
      'ant:pipe:fetch:local:user:proj-a',
      'ant:pipe:items-built:local:user:proj-a',
      'ant:pipe:proj:local:user:proj-a',
    ]);
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
    expect(removed).toEqual(['pipe|local|user|ghost', 'fetch|local|user|ghost']);
    expect(deletedKeys).toHaveLength(4);
    expect(published).toEqual([]);
  });

  // The 2026-09-18 404s: activate on pod A wrote the record; pod B's NFS view
  // still answered ENOENT and the route refused. The projection bridges that
  // window — the binding is held, every leg runs, the SSE names the pipeline.
  it('a record visible only through the Redis projection still deactivates (hadActivation true)', async () => {
    const { deps, removed, deactivated, published, keys } = makeBindingDeps({
      'ant:pipe:actv:local:user:proj-a': JSON.stringify(ACT('p1', 'proj-a')),
    });
    const result = await deactivatePipelineBinding(deps as any, OWNER, 'proj-a');
    expect(result).toEqual({ hadActivation: true, pipelineId: 'p1' });
    expect(removed).toEqual(['pipe|local|user|proj-a', 'fetch|local|user|proj-a']);
    expect(deactivated).toEqual(['proj-a']);
    expect(published[0].data).toMatchObject({ cause: 'activationChanged', pipelineId: 'p1', activation: null });
    expect(keys.has('ant:pipe:deact:local:user:proj-a')).toBe(true);
  });

  it('a projection older than the tombstone is dead — no activation, no SSE', async () => {
    const { deps, published } = makeBindingDeps({
      'ant:pipe:actv:local:user:proj-a': JSON.stringify(ACT('p1', 'proj-a', '2026-08-20T00:00:00.000Z')),
      'ant:pipe:deact:local:user:proj-a': JSON.stringify({ pipelineId: 'p1', at: '2026-08-21T00:00:00.000Z' }),
    });
    const result = await deactivatePipelineBinding(deps as any, OWNER, 'proj-a');
    expect(result).toEqual({ hadActivation: false, pipelineId: null });
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

describe('findPipelineRoot — closest-wins across ordered scope roots', () => {
  // One resolver for the HTTP routes AND the universal agent plane
  // (`_pipelines/{id}`), so the two cannot disagree about which root wins.
  const defRoot = (name: string) => {
    const root = path.join(tmp, name);
    fs.mkdirSync(root, { recursive: true });
    return root;
  };
  const write = (root: string, id: string) => {
    fs.mkdirSync(path.join(root, id), { recursive: true });
    fs.writeFileSync(path.join(root, id, 'pipeline.yaml'), 'name: x\n');
  };

  it('the first root holding pipeline.yaml wins (user before org)', () => {
    const user = defRoot('user');
    const org = defRoot('org');
    write(user, 'shared');
    write(org, 'shared');
    write(org, 'org-only');
    const roots = [
      { scope: 'user' as const, root: user, readonly: false },
      { scope: 'org' as const, root: org, readonly: false, aclGoverned: true },
    ];
    expect(findPipelineRoot(roots, 'shared')?.scopeRoot.root).toBe(user);
    expect(findPipelineRoot(roots, 'org-only')?.scopeRoot.scope).toBe('org');
  });

  it('a dir without pipeline.yaml, an unknown id, or no roots → null', () => {
    const user = defRoot('user');
    fs.mkdirSync(path.join(user, 'husk'), { recursive: true });
    const roots = [{ scope: 'user' as const, root: user, readonly: false }];
    expect(findPipelineRoot(roots, 'husk')).toBeNull();
    expect(findPipelineRoot(roots, 'ghost')).toBeNull();
    expect(findPipelineRoot([], 'ghost')).toBeNull();
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
  const FETCH_ON = {
    fetch: { customJobRef: 'x/a', api: 'jira', request: { method: 'GET', path: '/search' }, items: '$.issues', key: '$.key', every: '5m' },
  };
  function writeDef(defRoot: string, id: string, opts: { enabled?: boolean; manualOnly?: boolean; fetch?: boolean } = {}) {
    const dir = path.join(defRoot, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'pipeline.yaml'),
      yaml.dump({
        version: 2,
        name: id,
        ...(opts.manualOnly ? {} : opts.fetch ? { on: FETCH_ON } : { on: { schedule: { cron: '0 9 * * 1' } } }),
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
    const everyUpserts: Array<{ id: string; everyMs: number; data: any }> = [];
    const removed: string[] = [];
    const keys = new Map<string, string>();
    const ttls = new Map<string, number>();
    /** Slot sets (ZSET member → expiry) — the live-run and account caps. */
    const slots = new Map<string, Map<string, number>>();
    /** Slot-set keys whose listing throws (the per-activation isolation row). */
    const failingSlotKeys = new Set<string>();
    const setOf = (k: string) => {
      const set = slots.get(k) ?? new Map<string, number>();
      slots.set(k, set);
      return set;
    };
    return {
      upserts,
      everyUpserts,
      removed,
      keys,
      ttls,
      slots,
      failingSlotKeys,
      deps: {
        stateStore: {
          acquireLock: async () => true,
          releaseLock: async () => {},
          getKey: async (k: string) => keys.get(k) ?? null,
          setKeyWithTTL: async (k: string, v: string, ttl: number) => {
            keys.set(k, v);
            ttls.set(k, ttl);
          },
          deleteKey: async (k: string) => void keys.delete(k),
          exists: async (k: string) => keys.has(k),
          tryAcquireLock: async (k: string, v: string) => {
            if (keys.has(k)) return false;
            keys.set(k, v);
            return true;
          },
          reserveSlot: async (k: string, member: string, limit: number, ttl: number) => {
            const set = setOf(k);
            if (!set.has(member) && set.size >= limit) return false;
            set.set(member, Date.now() + ttl * 1000);
            return true;
          },
          releaseSlot: async (k: string, member: string) => void slots.get(k)?.delete(member),
          listSlots: async (k: string) => [...(slots.get(k)?.keys() ?? [])],
          listSlotsWithExpiry: async (k: string) => {
            if (failingSlotKeys.has(k)) throw new Error('redis down');
            return [...(slots.get(k) ?? [])].map(([member, expiresAt]) => ({ member, expiresAt }));
          },
          countSlots: async (k: string) => slots.get(k)?.size ?? 0,
        } as any,
        scheduleQueue: {
          upsertCron: async (id: string) => void upserts.push(id),
          upsertEvery: async (id: string, everyMs: number, data: any) => void everyUpserts.push({ id, everyMs, data }),
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
    const { deps, upserts, keys, slots } = makeDeps();
    deps.workspacesPath = tmp;
    await reconcilePipelines(deps as any);
    expect(upserts).toEqual(['pipe|local|user|proj-a']);
    expect(keys.get('ant:pipe:proj:local:user:proj-a')).toBe('p1');
    expect(JSON.parse(keys.get('ant:pipe:actv:local:user:proj-a') ?? '{}').pipelineId).toBe('p1');
    // The refresh also (re)indexes the project for the list-path bridge.
    expect([...(slots.get('ant:pipe:actv-idx:local:user')?.keys() ?? [])]).toEqual(['proj-a']);
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

  // The deactivating pod's unlink can be swallowed by its own NFS negative
  // lookup; the tombstone lets the pass that SEES the file finish the delete
  // instead of re-arming the schedulers (a zombie activation).
  it('a disk record covered by a newer deactivation tombstone is deleted and never scheduled', async () => {
    writeDef(path.join(tmp, 'local', 'user', '.ant', 'pipelines'), 'p1');
    writeActivation(tmp, 'local', 'user', ACT('p1', 'proj-a', '2026-08-20T00:00:00.000Z'));
    const { deps, upserts, keys } = makeDeps();
    deps.workspacesPath = tmp;
    keys.set('ant:pipe:deact:local:user:proj-a', JSON.stringify({ pipelineId: 'p1', at: '2026-08-20T00:00:01.000Z' }));
    await reconcilePipelines(deps as any);
    expect(upserts).toEqual([]);
    expect(fs.existsSync(path.join(tmp, 'local', 'user', '.ant', 'pipeline-activations', 'proj-a', 'activation.json'))).toBe(false);
    expect(keys.has('ant:pipe:proj:local:user:proj-a')).toBe(false);
  });

  it('a record NEWER than the tombstone (re-activated) schedules normally', async () => {
    writeDef(path.join(tmp, 'local', 'user', '.ant', 'pipelines'), 'p1');
    writeActivation(tmp, 'local', 'user', ACT('p1', 'proj-a', '2026-08-22T00:00:00.000Z'));
    const { deps, upserts, keys } = makeDeps();
    deps.workspacesPath = tmp;
    keys.set('ant:pipe:deact:local:user:proj-a', JSON.stringify({ pipelineId: 'p1', at: '2026-08-21T00:00:00.000Z' }));
    await reconcilePipelines(deps as any);
    expect(upserts).toEqual(['pipe|local|user|proj-a']);
  });

  it('sweeps orphan crons, including old-format (pipelineId-keyed) scheduler ids', async () => {
    writeDef(path.join(tmp, 'local', 'user', '.ant', 'pipelines'), 'p1');
    writeActivation(tmp, 'local', 'user', ACT('p1', 'proj-a'));
    const { deps, removed } = makeDeps(['pipe|local|user|proj-a', 'pipe|local|user|p-old', 'other|thing']);
    deps.workspacesPath = tmp;
    await reconcilePipelines(deps as any);
    expect(removed).toEqual(['pipe|local|user|p-old']);
  });

  it('manual-only activation: projections refresh, no cron registers, a stale scheduler is swept', async () => {
    writeDef(path.join(tmp, 'local', 'user', '.ant', 'pipelines'), 'p1', { manualOnly: true });
    writeActivation(tmp, 'local', 'user', ACT('p1', 'proj-a'));
    // A scheduler left over from when the def still had a cron must be swept
    // even though the activation itself stays wanted.
    const { deps, upserts, removed, keys } = makeDeps(['pipe|local|user|proj-a']);
    deps.workspacesPath = tmp;
    await reconcilePipelines(deps as any);
    expect(upserts).toEqual([]);
    expect(removed).toEqual(['pipe|local|user|proj-a']);
    // The mutual-exclusion gate stays armed — the projection refresh is
    // decoupled from the cron upsert (it would otherwise lapse fail-OPEN).
    expect(keys.get('ant:pipe:proj:local:user:proj-a')).toBe('p1');
  });

  // A fetch activation polls on its own `every` scheduler (`fetch|…`), never a
  // cron; both prefixes are swept; the claim projection is rebuilt from the
  // disk ledger when its marker is absent — dead claims (past grace, no run
  // doc, no run log) are left out so the item is seen again.
  it('fetch activation: registers the every-poller, no cron; both prefixes are swept', async () => {
    writeDef(path.join(tmp, 'local', 'user', '.ant', 'pipelines'), 'p1', { fetch: true });
    writeActivation(tmp, 'local', 'user', ACT('p1', 'proj-a'));
    const { deps, upserts, everyUpserts, removed, keys } = makeDeps(['pipe|local|user|proj-a', 'fetch|local|user|proj-a', 'fetch|local|user|p-old']);
    deps.workspacesPath = tmp;
    await reconcilePipelines(deps as any);
    expect(upserts).toEqual([]);
    expect(everyUpserts).toEqual([
      { id: 'fetch|local|user|proj-a', everyMs: 5 * 60_000, data: expect.objectContaining({ kind: 'fetch-poll', pipelineId: 'p1', projectId: 'proj-a', pipelineScope: 'user' }) },
    ]);
    // The stale cron of a def that became a fetch trigger, and an orphan poller, both go.
    expect(removed.sort()).toEqual(['fetch|local|user|p-old', 'pipe|local|user|proj-a']);
    expect(keys.has('ant:pipe:items-built:local:user:proj-a')).toBe(true);
    expect(keys.get('ant:pipe:proj:local:user:proj-a')).toBe('p1');
  });

  it('claim ledger rebuild (per pipeline): live/terminal claims are re-projected with a fresh TTL, dead claims are not, another pipeline\'s ledger is not read, a present marker is a no-op', async () => {
    writeDef(path.join(tmp, 'local', 'user', '.ant', 'pipelines'), 'p1', { fetch: true });
    writeActivation(tmp, 'local', 'user', ACT('p1', 'proj-a'));
    const actDir = path.join(tmp, 'local', 'user', '.ant', 'pipeline-activations', 'proj-a');
    fs.mkdirSync(path.join(actDir, 'items'), { recursive: true });
    fs.mkdirSync(path.join(actDir, 'runs'), { recursive: true });
    const old = new Date(Date.now() - 60 * 60_000).toISOString();
    const fresh = new Date().toISOString();
    fs.writeFileSync(
      path.join(actDir, 'items', 'p1.jsonl'),
      [
        JSON.stringify({ key: 'OPS-1', runId: 'run-live', claimedAt: old }),      // run doc in Redis
        JSON.stringify({ key: 'OPS-2', runId: 'run-sealed', claimedAt: old }),    // run log on disk
        JSON.stringify({ key: 'OPS-3', runId: 'run-dead', claimedAt: old }),      // nothing anywhere, past grace → dead
        JSON.stringify({ key: 'OPS-4', runId: 'run-young', claimedAt: fresh }),   // nothing yet, within grace → trusted
        '{"torn":',
      ].join('\n') + '\n',
    );
    // The project's previous pipeline claimed OPS-9 from ANOTHER source — not p1's to project.
    fs.writeFileSync(path.join(actDir, 'items', 'staging.jsonl'), JSON.stringify({ key: 'OPS-9', runId: 'run-sealed', claimedAt: old }) + '\n');
    fs.writeFileSync(path.join(actDir, 'runs', 'run-sealed.jsonl'), '{"event":"run_finished"}\n');
    const { deps, keys, ttls } = makeDeps();
    deps.workspacesPath = tmp;
    keys.set('ant:pipe:run:run-live', JSON.stringify({ runId: 'run-live', status: 'running' }));
    // A claim whose Redis key is about to lapse (30d) while the item is still open in the source: the rebuild re-sets it.
    keys.set('ant:pipe:item:local:user:proj-a:p1:OPS-2', 'stale-projection');
    await reconcilePipelines(deps as any);
    const claimKey = (k: string, pipelineId = 'p1') => `ant:pipe:item:local:user:proj-a:${pipelineId}:${k}`;
    const claim = (k: string) => keys.get(claimKey(k));
    expect(JSON.parse(claim('OPS-1')!)).toEqual({ runId: 'run-live', claimedAt: old });
    expect(JSON.parse(claim('OPS-2')!)).toEqual({ runId: 'run-sealed', claimedAt: old });
    expect(ttls.get(claimKey('OPS-2'))).toBe(REDIS_TTL.PIPE.ITEM);
    expect(claim('OPS-3')).toBeUndefined();
    expect(claim('OPS-4')).toBeDefined();
    expect(keys.get(claimKey('OPS-9'))).toBeUndefined();
    expect(keys.get(claimKey('OPS-9', 'staging'))).toBeUndefined();
    // Marker present → the next reconcile does not touch the projection even if the ledger grew.
    fs.appendFileSync(path.join(actDir, 'items', 'p1.jsonl'), JSON.stringify({ key: 'OPS-5', runId: 'r5', claimedAt: fresh }) + '\n');
    await reconcilePipelines(deps as any);
    expect(claim('OPS-5')).toBeUndefined();
  });

  // Liveness is a slot SET (member = runId) on both the activation and the
  // account; the heal releases the members whose run is gone or terminal and
  // leaves a live sibling's alone.
  it('heals stale live-run slots (activation + account), keeps a live run\'s, a just-reserved doc-less member (fire mid-commit), and another project\'s', async () => {
    writeDef(path.join(tmp, 'local', 'user', '.ant', 'pipelines'), 'p1');
    writeActivation(tmp, 'local', 'user', ACT('p1', 'proj-a'));
    const { deps, keys, slots } = makeDeps();
    deps.workspacesPath = tmp;
    keys.set('ant:pipe:run:run-live', JSON.stringify({ runId: 'run-live', status: 'running' }));
    keys.set('ant:pipe:run:run-done', JSON.stringify({ runId: 'run-done', status: 'completed' }));
    // Expiry encodes the last write: ACTIVE from now = reserved this instant; a near expiry = written ~30d ago.
    const stale = Date.now() + 60_000;
    const justReserved = Date.now() + REDIS_TTL.PIPE.ACTIVE * 1000;
    const pastGrace = justReserved - SLOT_HEAL_GRACE_MS - 1;
    slots.set('ant:pipe:actruns:local:user:proj-a', new Map([['run-live', stale], ['run-done', justReserved], ['run-dead', stale], ['run-committing', justReserved], ['run-crashed', pastGrace]]));
    slots.set(
      'ant:pipe:runslots:local:user',
      // `proj-a:b:run-x` belongs to project `proj-a:b` — a prefix match would hand it to proj-a.
      new Map([['proj-a:run-live', stale], ['proj-a:run-done', justReserved], ['proj-a:run-committing', justReserved], ['proj-a:run-crashed', pastGrace], ['proj-b:run-x', stale], ['proj-a:b:run-x', stale]]),
    );
    await reconcilePipelines(deps as any);
    expect([...slots.get('ant:pipe:actruns:local:user:proj-a')!.keys()].sort()).toEqual(['run-committing', 'run-live']);
    expect([...slots.get('ant:pipe:runslots:local:user')!.keys()].sort()).toEqual(['proj-a:b:run-x', 'proj-a:run-committing', 'proj-a:run-live', 'proj-b:run-x']);
  });

  it('RUN_SLOTS member split is the inverse of the join on the LAST colon (a projectId may carry one; a runId never does)', () => {
    expect(parseRunSlotMember('proj-a:calm-river')).toEqual({ projectId: 'proj-a', runId: 'calm-river' });
    expect(parseRunSlotMember('proj-a:b:calm-river')).toEqual({ projectId: 'proj-a:b', runId: 'calm-river' });
    expect(parseRunSlotMember('no-colon')).toBeNull();
    expect(parseRunSlotMember(':run')).toBeNull();
    expect(parseRunSlotMember('proj:')).toBeNull();
  });

  it('a Redis error in one activation\'s slot heal is contained: the pass continues and that activation skips retention', async () => {
    writeDef(path.join(tmp, 'local', 'user', '.ant', 'pipelines'), 'p1');
    writeActivation(tmp, 'local', 'user', ACT('p1', 'proj-a'));
    writeActivation(tmp, 'local', 'user', ACT('p1', 'proj-b'));
    const { deps, keys, failingSlotKeys } = makeDeps();
    deps.workspacesPath = tmp;
    failingSlotKeys.add('ant:pipe:actruns:local:user:proj-a');
    const pruned: string[] = [];
    // Session-file retention must never run against an unknown live set.
    const container = path.join(tmp, 'local', 'user', 'proj-a', 'universal');
    fs.mkdirSync(path.join(container, 'sessions', 'ops'), { recursive: true });
    for (let i = 0; i < RUN_SESSION_FILE_RETENTION + 3; i += 1) {
      fs.writeFileSync(path.join(container, 'sessions', 'ops', `collect@run-${i}.json`), '{}');
    }
    const containerPathOf = (_o: any, projectId: string) => {
      pruned.push(projectId);
      return path.join(tmp, 'local', 'user', projectId, 'universal');
    };
    await reconcilePipelines({ ...deps, containerPathOf } as any);
    expect(keys.get('ant:pipe:proj:local:user:proj-a')).toBe('p1');
    expect(keys.get('ant:pipe:proj:local:user:proj-b')).toBe('p1');
    expect(pruned).toEqual(['proj-b']);
    expect(fs.readdirSync(path.join(container, 'sessions', 'ops'))).toHaveLength(RUN_SESSION_FILE_RETENTION + 3);
  });

  it('migrates a live legacy single-value guard into both slot sets and drops the key', async () => {
    writeDef(path.join(tmp, 'local', 'user', '.ant', 'pipelines'), 'p1');
    writeActivation(tmp, 'local', 'user', ACT('p1', 'proj-a'));
    const { deps, keys, slots } = makeDeps();
    deps.workspacesPath = tmp;
    keys.set('ant:pipe:active:local:user:proj-a', 'run-live');
    keys.set('ant:pipe:run:run-live', JSON.stringify({ runId: 'run-live', status: 'awaiting_human' }));
    await reconcilePipelines(deps as any);
    expect(keys.has('ant:pipe:active:local:user:proj-a')).toBe(false);
    expect([...slots.get('ant:pipe:actruns:local:user:proj-a')!.keys()]).toEqual(['run-live']);
    expect([...slots.get('ant:pipe:runslots:local:user')!.keys()]).toEqual(['proj-a:run-live']);
  });

  it('drops a terminal legacy guard without reserving anything', async () => {
    writeDef(path.join(tmp, 'local', 'user', '.ant', 'pipelines'), 'p1');
    writeActivation(tmp, 'local', 'user', ACT('p1', 'proj-a'));
    const { deps, keys, slots } = makeDeps();
    deps.workspacesPath = tmp;
    keys.set('ant:pipe:active:local:user:proj-a', 'run-dead');
    // No ant:pipe:run:run-dead doc → nothing to carry over.
    await reconcilePipelines(deps as any);
    expect(keys.has('ant:pipe:active:local:user:proj-a')).toBe(false);
    expect(slots.get('ant:pipe:actruns:local:user:proj-a')?.size ?? 0).toBe(0);
  });

  // Every run seals into its own session file (§5b); the reconciler is the ONE
  // retention owner — newest K per (agent, job) stem, judged against the healed
  // live set, so a live run's file is never a candidate whatever its age.
  it('keeps the newest K sealed run session files per stem and never touches a live run\'s', async () => {
    writeDef(path.join(tmp, 'local', 'user', '.ant', 'pipelines'), 'p1');
    writeActivation(tmp, 'local', 'user', ACT('p1', 'proj-a'));
    const { deps, keys, slots } = makeDeps();
    deps.workspacesPath = tmp;
    const container = path.join(tmp, 'local', 'user', 'proj-a', 'universal');
    const dir = path.join(container, 'sessions', 'ops');
    fs.mkdirSync(dir, { recursive: true });
    const t0 = Date.now() - 100_000;
    for (let i = 0; i < RUN_SESSION_FILE_RETENTION + 5; i++) {
      const f = path.join(dir, `author@run-${String(i).padStart(2, '0')}.json`);
      fs.writeFileSync(f, '{}');
      fs.utimesSync(f, new Date(t0 + i * 1000), new Date(t0 + i * 1000));
    }
    // The live run's file is the OLDEST of all; the shared interactive file is never a candidate.
    const liveFile = path.join(dir, 'author@run-live.json');
    fs.writeFileSync(liveFile, '{}');
    fs.utimesSync(liveFile, new Date(t0 - 50_000), new Date(t0 - 50_000));
    fs.writeFileSync(path.join(dir, 'author.json'), '{}');
    keys.set('ant:pipe:run:run-live', JSON.stringify({ runId: 'run-live', status: 'running' }));
    slots.set('ant:pipe:actruns:local:user:proj-a', new Map([['run-live', Date.now() + 60_000]]));
    (deps as any).containerPathOf = () => container;
    await reconcilePipelines(deps as any);
    const left = fs.readdirSync(dir).sort();
    expect(left).toContain('author@run-live.json');
    expect(left).toContain('author.json');
    const sealed = left.filter((n) => /^author@run-\d\d\.json$/.test(n));
    expect(sealed).toHaveLength(RUN_SESSION_FILE_RETENTION);
    expect(sealed[0]).toBe('author@run-05.json');
  });

  it('rebuilds the approver-of discovery index from activation rosters (gate-agnostic union)', async () => {
    writeDef(path.join(tmp, 'acme', '.ant', 'pipelines'), 'shared');
    writeActivation(tmp, 'acme', 'alice', {
      ...ACT('shared', 'proj-a'),
      pipelineScope: 'org',
      approvers: { 'budget-gate': ['bob@corp.com'], 'publish-gate': ['bob@corp.com', 'carol@corp.com'] },
    } as any);
    const { deps, keys } = makeDeps();
    deps.workspacesPath = tmp;
    await reconcilePipelines(deps as any);
    expect(JSON.parse(keys.get('ant:pipe:approver-of:acme:bob@corp.com') ?? '[]')).toEqual(['alice|proj-a']);
    expect(JSON.parse(keys.get('ant:pipe:approver-of:acme:carol@corp.com') ?? '[]')).toEqual(['alice|proj-a']);
  });
});

describe('approver-of index — advisory discovery projection (activate/PUT/deactivate sync + channel port)', () => {
  function kv() {
    const keys = new Map<string, string>();
    return {
      keys,
      store: {
        getKey: async (k: string) => keys.get(k) ?? null,
        setKeyWithTTL: async (k: string, v: string) => void keys.set(k, v),
        deleteKey: async (k: string) => void keys.delete(k),
      },
    };
  }

  it('sync adds new approvers, removes dropped ones, and deletes an emptied key', async () => {
    const { approverIndexEntry, syncApproverIndexForActivation, readApproverIndex } = await import(
      '../../src/core/pipelines/approverIndex'
    );
    const { keys, store } = kv();
    await syncApproverIndexForActivation(store as any, 'acme', 'alice', 'proj-a', [], ['bob@corp.com', 'carol@corp.com']);
    expect(await readApproverIndex(store as any, 'acme', 'bob@corp.com')).toEqual([approverIndexEntry('alice', 'proj-a')]);
    // Roster edit: carol out, dave in — bob untouched.
    await syncApproverIndexForActivation(store as any, 'acme', 'alice', 'proj-a', ['bob@corp.com', 'carol@corp.com'], ['bob@corp.com', 'dave@corp.com']);
    expect(await readApproverIndex(store as any, 'acme', 'carol@corp.com')).toEqual([]);
    expect(await readApproverIndex(store as any, 'acme', 'dave@corp.com')).toEqual(['alice|proj-a']);
    // Deactivation empties every roster entry for the activation.
    await syncApproverIndexForActivation(store as any, 'acme', 'alice', 'proj-a', ['bob@corp.com', 'dave@corp.com'], []);
    expect(keys.has('ant:pipe:approver-of:acme:bob@corp.com')).toBe(false);
    expect(keys.has('ant:pipe:approver-of:acme:dave@corp.com')).toBe(false);
  });

  it('deactivatePipelineBinding drops the activation from every approver roster', async () => {
    const actRoot = path.join(tmp, 'local', 'user', '.ant', 'pipeline-activations');
    await saveActivationRecord(actRoot, { ...ACT('p1', 'proj-a'), approvers: { g1: ['bob@corp.com'] } } as any);
    const { keys, store } = kv();
    keys.set('ant:pipe:approver-of:local:bob@corp.com', JSON.stringify(['user|proj-a', 'other|proj-z']));
    const deps = {
      workspacesPath: tmp,
      scheduleQueue: { removeCron: async () => {} },
      coordinator: { deactivate: async () => {} },
      stateStore: { ...store, publish: async () => {} },
    };
    await deactivatePipelineBinding(deps as any, { userId: 'user', organizationId: 'local', organizationKind: 'local' }, 'proj-a');
    expect(JSON.parse(keys.get('ant:pipe:approver-of:local:bob@corp.com') ?? '[]')).toEqual(['other|proj-z']);
  });

  it('InAppChannel.notify is fire-and-forget: a publish failure never throws (gate arm must not block)', async () => {
    const { InAppChannel } = await import('../../src/core/pipelines/notifications');
    const channel = new InAppChannel({
      publish: async () => {
        throw new Error('redis down');
      },
    } as any);
    await expect(
      channel.notify({
        kind: 'approvalRequested',
        recipient: { userId: 'bob@corp.com', organizationId: 'acme', role: 'approver' },
        gateId: 'gate-r1-g1',
        cardId: 'pipe-gate-r1-g1',
        runId: 'r1',
        pipelineId: 'p1',
        pipelineName: 'P1',
        projectId: 'proj-a',
        ownerUserId: 'alice',
        stepId: 'g1',
        prompt: 'approve?',
        armedAt: '2026-09-06T00:00:00.000Z',
        deepLink: 'ant://pipelines/approvals/gate-r1-g1',
      }),
    ).resolves.toBeUndefined();
  });

  it('InAppChannel marks approver recipients on the wire (role + ownerUserId); owner rows stay unmarked', async () => {
    const { InAppChannel } = await import('../../src/core/pipelines/notifications');
    const published: any[] = [];
    const channel = new InAppChannel({ publish: async (ch: string, msg: any) => void published.push({ ch, msg }) } as any);
    const base = {
      kind: 'approvalRequested' as const,
      gateId: 'gate-r1-g1',
      cardId: 'pipe-gate-r1-g1',
      runId: 'r1',
      pipelineId: 'p1',
      pipelineName: 'P1',
      projectId: 'proj-a',
      ownerUserId: 'alice',
      stepId: 'g1',
      prompt: 'approve?',
      armedAt: '2026-09-06T00:00:00.000Z',
      deepLink: 'x',
    };
    await channel.notify({ ...base, recipient: { userId: 'alice', organizationId: 'acme', role: 'owner' } });
    await channel.notify({ ...base, recipient: { userId: 'bob@corp.com', organizationId: 'acme', role: 'approver' } });
    expect(published).toHaveLength(2);
    expect(published[0].msg.data.approval.role).toBeUndefined();
    expect(published[1].msg.data.approval).toMatchObject({ role: 'approver', ownerUserId: 'alice' });
    // Each notice lands on ITS recipient's user channel.
    expect(published[0].ch).not.toBe(published[1].ch);
    // `assignees` is ALWAYS on the wire: the FE upserts the held row from it, so a
    // reassign back to everyone must clear the badge rather than keep the old one.
    expect(published[0].msg.data.approval.assignees).toEqual([]);
    await channel.notify({ ...base, assignees: ['bob@corp.com'], recipient: { userId: 'alice', organizationId: 'acme', role: 'owner' } });
    expect(published[2].msg.data.approval.assignees).toEqual(['bob@corp.com']);
  });
});

describe('mutateRun / commitRun — a run-record write publishes the record it wrote', () => {
  const OWNER = { userId: 'user', organizationId: 'local', organizationKind: 'local' as const };
  const RUN = (over: Record<string, unknown> = {}) => ({
    runId: 'r1',
    pipelineId: 'p1',
    projectId: 'proj-a',
    firedBy: 'manual',
    fireEpoch: 1,
    status: 'running',
    startedAt: '2026-09-16T00:00:00.000Z',
    defSnapshot: { version: 2, name: 'P', steps: [] },
    steps: [{ stepId: 's1', status: 'running', jobId: 'j1', output: { answer: 'secret', capturedAt: 't' } }],
    ...over,
  });

  function makeRunDeps(seed: Record<string, unknown>) {
    const store = new Map<string, string>([[`ant:pipe:run:${seed.runId}`, JSON.stringify(seed)]]);
    const calls: string[] = [];
    const published: any[] = [];
    const refreshed: Array<{ key: string; member: string; ttl: number }> = [];
    const deps = {
      workspacesPath: tmp,
      scheduleQueue: { cancelDelayed: async () => {} },
      stateStore: {
        getKey: async (k: string) => store.get(k) ?? null,
        setKeyWithTTL: async (k: string, v: string) => {
          calls.push('save');
          store.set(k, v);
        },
        deleteKey: async () => {},
        acquireLock: async () => true,
        releaseLock: async () => void calls.push('release'),
        refreshSlot: async (key: string, member: string, ttl: number) => {
          refreshed.push({ key, member, ttl });
          return true;
        },
        publish: async (_ch: string, msg: any) => {
          calls.push('publish');
          published.push(msg);
        },
      },
    } as any;
    return { deps, store, calls, published, refreshed };
  }

  it('a changed mutator publishes exactly one runUpdate carrying the saved record (def + answers stripped), before the lock is released', async () => {
    const { mutateRun } = await import('../../src/infrastructure/scheduling/pipelineRun/runStore');
    const { deps, calls, published } = makeRunDeps(RUN());
    const result = await mutateRun(deps, OWNER, 'r1', async (live) => ({
      run: { ...live, steps: live.steps.map((s) => ({ ...s, status: 'succeeded' as const })) },
      dispatches: [],
    }));
    expect(result?.run.steps[0].status).toBe('succeeded');
    expect(published).toHaveLength(1);
    expect(published[0].type).toBe('pipeline');
    expect(published[0].data).toMatchObject({ cause: 'runUpdate', projectId: 'proj-a', pipelineId: 'p1' });
    expect(published[0].data.run.steps[0]).toMatchObject({ status: 'succeeded' });
    expect(published[0].data.run.defSnapshot).toBeUndefined();
    expect(published[0].data.run.steps[0].output.answer).toBeUndefined();
    expect(calls).toEqual(['save', 'publish', 'release']);
  });

  it('a guard no-op (mutator returns live) re-saves for the TTL refresh and publishes nothing', async () => {
    const { mutateRun } = await import('../../src/infrastructure/scheduling/pipelineRun/runStore');
    const { deps, calls, published } = makeRunDeps(RUN());
    const result = await mutateRun(deps, OWNER, 'r1', async (live) => ({ run: live, dispatches: [] }));
    expect(result).not.toBeNull();
    expect(published).toEqual([]);
    expect(calls).toEqual(['save', 'release']);
  });

  it('commitRun (create / seal) saves then publishes the same record', async () => {
    const { commitRun } = await import('../../src/infrastructure/scheduling/pipelineRun/runStore');
    const { deps, store, published } = makeRunDeps(RUN());
    const sealed = RUN({ status: 'completed', endedAt: '2026-09-16T00:01:00.000Z' });
    await commitRun(deps, OWNER, sealed as any);
    expect(JSON.parse(store.get('ant:pipe:run:r1')!).endedAt).toBe('2026-09-16T00:01:00.000Z');
    expect(published).toHaveLength(1);
    expect(published[0].data.run).toMatchObject({ status: 'completed', endedAt: '2026-09-16T00:01:00.000Z' });
  });

  // The slot memberships are the run's liveness — reserved once at fire, they
  // would lapse under a run that waits longer than the ACTIVE bound and drop it
  // out of every listing while a new fire is admitted past the cap. Every live
  // write is their heartbeat; a terminal write leaves them for finalize to release.
  it('saveRun refreshes both slot members (activation + account, ACTIVE TTL) for a live run and not for a terminal one', async () => {
    const { mutateRun, commitRun } = await import('../../src/infrastructure/scheduling/pipelineRun/runStore');
    const live = makeRunDeps(RUN());
    await mutateRun(live.deps, OWNER, 'r1', async (run) => ({ run, dispatches: [] }));
    expect(live.refreshed).toEqual([
      { key: 'ant:pipe:actruns:local:user:proj-a', member: 'r1', ttl: REDIS_TTL.PIPE.ACTIVE },
      { key: 'ant:pipe:runslots:local:user', member: 'proj-a:r1', ttl: REDIS_TTL.PIPE.ACTIVE },
    ]);
    const sealed = makeRunDeps(RUN());
    await commitRun(sealed.deps, OWNER, RUN({ status: 'completed', endedAt: '2026-09-16T00:01:00.000Z' }) as any);
    expect(sealed.refreshed).toEqual([]);
  });
});

/**
 * `job:status:updates` is a pub/sub BROADCAST, so every API process runs the
 * same outcome handler and each one reaches finalize holding the snapshot it
 * read before its own mutation. The seal has to be decided against the LIVE
 * record, or one run sealsN times: N run_finished lines, N index rows (the
 * same run rendered twice on the FE, duplicate React key, flickering list),
 * N chat notices and N chained fires.
 */
describe('finalizeRun — the seal is claimed once, against the live record', () => {
  const OWNER = { userId: 'user', organizationId: 'local', organizationKind: 'local' as const };
  const TERMINAL = {
    runId: 'r1',
    pipelineId: 'p1',
    projectId: 'proj-a',
    firedBy: 'manual',
    fireEpoch: 1,
    status: 'completed',
    startedAt: '2026-09-16T00:00:00.000Z',
    defSnapshot: { version: 2, name: 'P', steps: [] },
    steps: [{ stepId: 's1', status: 'succeeded', jobId: 'j1' }],
  };

  function makeCtx(seed: Record<string, unknown>) {
    const store = new Map<string, string>([[`ant:pipe:run:${seed.runId}`, JSON.stringify(seed)]]);
    const deps = {
      workspacesPath: tmp,
      scheduleQueue: { cancelDelayed: async () => {} },
      stateStore: {
        getKey: async (k: string) => store.get(k) ?? null,
        setKeyWithTTL: async (k: string, v: string) => void store.set(k, v),
        deleteKey: async () => {},
        acquireLock: async () => true,
        releaseLock: async () => {},
        tryAcquireLock: async () => true,
        releaseLockIfOwner: async () => {},
        releaseSlot: async () => true,
        refreshSlot: async () => true,
        publish: async () => {},
      },
    } as any;
    return { ctx: { deps } as any, store };
  }

  const rawLines = (file: string) =>
    fs.existsSync(file) ? fs.readFileSync(file, 'utf-8').split('\n').filter((l) => l.trim().length > 0) : [];

  it('a second finalizer holding a pre-seal snapshot appends no second run_finished and no second index row', async () => {
    const { finalizeRun } = await import('../../src/infrastructure/scheduling/pipelineRun/lifecycle');
    const { deriveActivationsRoot, activationRunIndexPath, activationRunLogPath } = await import('../../src/core/pipelines/paths');
    const { ctx, store } = makeCtx(TERMINAL);

    // Both callers hold the SAME record they read before the seal.
    await finalizeRun(ctx, OWNER, TERMINAL as any);
    const sealedAt = JSON.parse(store.get('ant:pipe:run:r1')!).endedAt;
    await finalizeRun(ctx, OWNER, TERMINAL as any);

    const actRoot = deriveActivationsRoot({ workspacesPath: tmp, ...OWNER });
    expect(rawLines(activationRunIndexPath(actRoot, 'proj-a'))).toHaveLength(1);
    expect(rawLines(activationRunLogPath(actRoot, 'proj-a', 'r1')).filter((l) => l.includes('"run_finished"'))).toHaveLength(1);
    // The first seal's `endedAt` stands — a re-seal would re-stamp it.
    expect(sealedAt).toBeTruthy();
    expect(JSON.parse(store.get('ant:pipe:run:r1')!).endedAt).toBe(sealedAt);
  });

  it('a run whose record is gone has nothing to seal — no index row is written for it', async () => {
    const { finalizeRun } = await import('../../src/infrastructure/scheduling/pipelineRun/lifecycle');
    const { deriveActivationsRoot, activationRunIndexPath } = await import('../../src/core/pipelines/paths');
    const { ctx, store } = makeCtx({ ...TERMINAL, runId: 'r2', projectId: 'proj-b' });
    store.clear();
    await finalizeRun(ctx, OWNER, { ...TERMINAL, runId: 'r2', projectId: 'proj-b' } as any);
    expect(rawLines(activationRunIndexPath(deriveActivationsRoot({ workspacesPath: tmp, ...OWNER }), 'proj-b'))).toHaveLength(0);
  });
});

/**
 * The index is append-only across pods — the reader owns "one run, one row".
 */
describe('readRunIndex — an append-only index is folded by runId', () => {
  it('collapses repeated lines for one run to its newest, and `limit` counts runs', async () => {
    const { readRunIndex } = await import('../../src/core/pipelines/store');
    const { activationRunIndexPath } = await import('../../src/core/pipelines/paths');
    const actRoot = path.join(tmp, 'actv');
    const indexPath = activationRunIndexPath(actRoot, 'proj-a');
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    const line = (runId: string, over: Record<string, unknown> = {}) =>
      JSON.stringify({ runId, pipelineId: 'p1', projectId: 'proj-a', status: 'completed', firedBy: 'manual', startedAt: '2026-09-16T00:00:00.000Z', ...over });
    fs.writeFileSync(
      indexPath,
      [line('a'), line('b'), line('a', { status: 'partial', endedAt: '2026-09-16T00:02:00.000Z' }), line('c')].join('\n') + '\n',
      'utf-8',
    );

    const all = readRunIndex(actRoot, 'proj-a');
    expect(all.map((r) => r.runId)).toEqual(['c', 'b', 'a']);
    // Last line wins — the fold is a fold, not a first-seen dedupe.
    expect(all.find((r) => r.runId === 'a')).toMatchObject({ status: 'partial', endedAt: '2026-09-16T00:02:00.000Z' });
    // 4 lines, 3 runs: the tail window is spent on runs, never on duplicates.
    expect(readRunIndex(actRoot, 'proj-a', 2).map((r) => r.runId)).toEqual(['c', 'b']);
  });
});

describe('clarify answer authority — every fate is a typed outcome; an early answer is held, then applied on park', () => {
  const OWNER = { userId: 'user', organizationId: 'local', organizationKind: 'local' as const };
  const DEF = { version: 2, name: 'P', steps: [{ id: 's1', customJobRef: 'x/a', directive: 'd' }] };
  const RUN = (step: Record<string, unknown>) => ({
    runId: 'r1',
    pipelineId: 'p1',
    projectId: 'proj-a',
    firedBy: 'manual',
    fireEpoch: 1,
    status: 'running',
    startedAt: '2026-09-18T00:00:00.000Z',
    defSnapshot: DEF,
    steps: [{ stepId: 's1', ...step }],
  });
  const FUNNEL = JSON.stringify({ runId: 'r1', stepId: 's1', pipelineId: 'p1', projectId: 'proj-a', owner: OWNER });

  function makeCtx(run: Record<string, unknown> | null, opts: { funnel?: boolean; lock?: boolean } = {}) {
    const store = new Map<string, string>();
    if (run) store.set('ant:pipe:run:r1', JSON.stringify(run));
    if (opts.funnel !== false) store.set('ant:pipe:job:j1', FUNNEL);
    const dispatched: string[] = [];
    const published: any[] = [];
    const ctx = {
      deps: {
        workspacesPath: tmp,
        scheduleQueue: { cancelDelayed: async () => {}, armDelayed: async () => {} },
        stateStore: {
          getKey: async (k: string) => store.get(k) ?? null,
          setKeyWithTTL: async (k: string, v: string) => void store.set(k, v),
          deleteKey: async (k: string) => void store.delete(k),
          acquireLock: async () => opts.lock !== false,
          releaseLock: async () => {},
          refreshSlot: async () => true,
          publish: async (_ch: string, msg: any) => void published.push(msg),
        },
      },
      dispatchJobStep: async (_o: any, _d: any, _r: any, step: any, _retries: number, directive?: string, _grant?: string, awaited?: string) =>
        void dispatched.push(`${step.id}:${directive}${awaited ? `@${awaited}` : ''}`),
    } as any;
    return { ctx, store, dispatched, published };
  }
  const answer = (ctx: any, over: Record<string, unknown> = {}) =>
    import('../../src/infrastructure/scheduling/pipelineRun/hitl').then((m) =>
      m.applyClarifyAnswer(ctx, { jobId: 'j1', answer: 'yes', answeredBy: 'user', via: 'in-app', ...over }),
    );

  it('no funnel key → not-pipeline (an interactive clarify card is the caller\'s own business)', async () => {
    const { ctx, dispatched } = makeCtx(RUN({ status: 'awaiting_clarify', jobId: 'j1', clarify: { clarifyId: 'c', jobId: 'j1', question: 'q', round: 1, askedAt: 't' } }), { funnel: false });
    expect(await answer(ctx)).toBe('not-pipeline');
    expect(dispatched).toEqual([]);
  });

  it('awaiting this job\'s clarify → applied: step dispatched with the answer AND the call it must close, funnel key gone', async () => {
    const { ctx, store, dispatched, published } = makeCtx(RUN({ status: 'awaiting_clarify', jobId: 'j1', clarify: { clarifyId: 'c', jobId: 'j1', question: 'q', toolUseId: 'tu-1', round: 1, askedAt: 't' } }));
    expect(await answer(ctx)).toBe('applied');
    // The re-dispatch names the dangling tool_use: the child waits for that seal
    // instead of opening a fresh turn that re-asks (2026-09-21 report).
    expect(dispatched).toEqual(['s1:yes@tu-1']);
    expect(store.has('ant:pipe:job:j1')).toBe(false);
    expect(published.some((m) => m.data?.cause === 'clarifyAnswered')).toBe(true);
  });

  // The chat card is minted by the child BEFORE the job ends; the park lands
  // after the status update. An answer in that window used to hit the
  // awaiting guard and vanish behind a `false` — now it is held under the run
  // lock and the park applies it (one dispatch, no human re-ask).
  it('step still running under this job → held; enterAwaitingClarify then parks AND applies it (one dispatch)', async () => {
    const { ctx, store, dispatched } = makeCtx(RUN({ status: 'running', jobId: 'j1' }));
    expect(await answer(ctx)).toBe('held');
    expect(JSON.parse(store.get('ant:pipe:clarify-held:j1') ?? '{}')).toMatchObject({ answer: 'yes', via: 'in-app' });
    expect(dispatched).toEqual([]);

    const { enterAwaitingClarify } = await import('../../src/infrastructure/scheduling/pipelineRun/hitl');
    await enterAwaitingClarify(ctx, {
      kind: 'clarify-enter', owner: OWNER, pipelineId: 'p1', projectId: 'proj-a', runId: 'r1', stepId: 's1', jobId: 'j1', question: 'q?', retries: 0,
    } as any);
    expect(dispatched).toEqual(['s1:yes']);
    expect(store.has('ant:pipe:clarify-held:j1')).toBe(false);
    const run = JSON.parse(store.get('ant:pipe:run:r1')!);
    expect(run.steps[0]).toMatchObject({ status: 'dispatched', clarify: { answer: 'yes', answeredBy: 'user' } });
  });

  it('a different job or round → not-awaiting; the record is untouched', async () => {
    const { ctx, store, dispatched } = makeCtx(RUN({ status: 'awaiting_clarify', jobId: 'j2', clarify: { clarifyId: 'c', jobId: 'j2', question: 'q', round: 2, askedAt: 't' } }));
    expect(await answer(ctx)).toBe('not-awaiting');
    expect(dispatched).toEqual([]);
    expect(store.has('ant:pipe:job:j1')).toBe(true);
  });

  it('run lock unavailable → lock-starved (retryable; nothing written, nothing held)', async () => {
    const { ctx, store, dispatched } = makeCtx(RUN({ status: 'running', jobId: 'j1' }), { lock: false });
    expect(await answer(ctx)).toBe('lock-starved');
    expect(dispatched).toEqual([]);
    expect(store.has('ant:pipe:clarify-held:j1')).toBe(false);
  });
});

// The list paths (catalog, activatable-projects, pending approvals, upstream
// fan-out) enumerate by readdir, and a pod holding a negative NFS lookup
// enumerates nothing for a project another pod activated seconds ago — the
// execution view then lost its activation row (and its progress canvas) on
// every snapshot that pod answered. One resolved enumeration: disk minus
// tombstoned records, plus indexed projections the readdir could not see.
describe('listAccountActivationsResolved — the list-path visibility bridge', () => {
  const OWNER = { userId: 'user', organizationId: 'local', organizationKind: 'local' as const };
  const actRoot = () => path.join(tmp, 'local', 'user', '.ant', 'pipeline-activations');

  function makeStore(seed: Record<string, string> = {}, indexed: string[] = []) {
    const keys = new Map<string, string>(Object.entries(seed));
    const idx = new Set<string>(indexed);
    let listSlotsFails = false;
    const store = {
      getKey: async (k: string) => keys.get(k) ?? null,
      listSlots: async (k: string) => {
        if (listSlotsFails) throw new Error('redis down');
        return k === 'ant:pipe:actv-idx:local:user' ? [...idx] : [];
      },
    };
    return { store, keys, idx, failListSlots: () => void (listSlotsFails = true) };
  }

  it('disk records come back as-is; a record the tombstone covers is dropped', async () => {
    await saveActivationRecord(actRoot(), ACT('p1', 'proj-a'));
    await saveActivationRecord(actRoot(), ACT('p2', 'proj-b'));
    const { store } = makeStore({ 'ant:pipe:deact:local:user:proj-b': JSON.stringify({ pipelineId: 'p2', at: '2026-08-21T00:00:00.000Z' }) });
    const out = await listAccountActivationsResolved(store as any, tmp, OWNER);
    expect(out.map((a) => a.projectId)).toEqual(['proj-a']);
  });

  it('an indexed projection the readdir cannot see is answered from Redis; a disk record wins over its own projection', async () => {
    await saveActivationRecord(actRoot(), ACT('p1', 'proj-a'));
    const { store } = makeStore(
      {
        'ant:pipe:actv:local:user:proj-a': JSON.stringify(ACT('stale', 'proj-a')),
        'ant:pipe:actv:local:user:proj-b': JSON.stringify(ACT('p2', 'proj-b')),
      },
      ['proj-a', 'proj-b'],
    );
    const out = await listAccountActivationsResolved(store as any, tmp, OWNER);
    expect(out.map((a) => [a.projectId, a.pipelineId])).toEqual([['proj-a', 'p1'], ['proj-b', 'p2']]);
  });

  it('an indexed project with no projection (expired) and a projection under a newer tombstone contribute nothing', async () => {
    const { store } = makeStore(
      {
        'ant:pipe:actv:local:user:proj-b': JSON.stringify(ACT('p2', 'proj-b', '2026-08-20T00:00:00.000Z')),
        'ant:pipe:deact:local:user:proj-b': JSON.stringify({ pipelineId: 'p2', at: '2026-08-21T00:00:00.000Z' }),
      },
      ['proj-b', 'proj-gone'],
    );
    expect(await listAccountActivationsResolved(store as any, tmp, OWNER)).toEqual([]);
  });

  it('fails OPEN to the disk view when the index read throws', async () => {
    await saveActivationRecord(actRoot(), ACT('p1', 'proj-a'));
    const { store, failListSlots } = makeStore({}, ['proj-b']);
    failListSlots();
    const out = await listAccountActivationsResolved(store as any, tmp, OWNER);
    expect(out.map((a) => a.projectId)).toEqual(['proj-a']);
  });
});
