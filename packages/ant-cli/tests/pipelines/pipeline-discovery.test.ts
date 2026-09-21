/**
 * Step discovery (`discovers`) — one axis, one file: the `<cases>` seal
 * parser and the declared-field filter, the per-case step derivation and the
 * two run seedings the executor never had to learn, the seal capture policy
 * (`onMissing`), the queue leg (every case claimed at once), the drain (room
 * under `concurrency`, re-arm), and the fire path's case-run creation
 * (queued claim promoted, prefix copied, missing parent failed loudly).
 * `on.fetch` and `discovers` are the same per-case run found by different
 * executors — the ledger rows here pin what the two share.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  discoveryStepIndex,
  discoveryItemTemplateVars,
  perCaseStepIds,
  type PipelineDef,
  type RunRecord,
} from '@ant/shared';
import { filterCaseFields, parseCaseNominations } from '../../src/core/pipelines/cases';
import { buildCaseRunSteps, buildDiscoveryRunSteps, planAdvance, applyStepOutcome } from '../../src/core/pipelines/ChainExecutor';
import { readItemClaims } from '../../src/core/pipelines/store';
import { getUniversalSessionFilePath } from '../../src/core/utils/sessionPaths';
import { captureStepOutput } from '../../src/infrastructure/scheduling/pipelineRun/seals';
import { handleCaseDrain, queueDiscoveredCases, CASE_DRAIN_DELAY_MS } from '../../src/infrastructure/scheduling/pipelineRun/discovery';
import { handleFire } from '../../src/infrastructure/scheduling/pipelineRun/fire';
import { applyOutcome, finalizeRun } from '../../src/infrastructure/scheduling/pipelineRun/lifecycle';
import { ITEM_CLAIM_GRACE_MS, claimValue, ensureItemLedger, isDeadClaim, parseClaimValue, readQueuedCases } from '../../src/infrastructure/scheduling/pipelineRun/itemLedger';
import { renderDirective } from '../../src/infrastructure/scheduling/pipelineRun/render';

// ---- the seal: <cases> → PipelineRunItem[] ----

describe('parseCaseNominations — the LAST <cases> tag, bounded like a fetch item', () => {
  it('reads nested and flat field shapes, drops unusable/duplicate keys, cuts fields, first-wins', () => {
    const text = `done.\n<cases>[{"key":"C-1","fields":{"merchant":"acme","amount":7450}},{"key":"C-2","merchant":"beta","Bad-Name":"x"},{"key":"bad key!"},{"key":"C-1","merchant":"dup"},{"nope":true},"C-3",42,{"key":"C-4","fields":{"note":"${'x'.repeat(3_000)}"}}]</cases>`;
    const r = parseCaseNominations(text)!;
    expect(r.error).toBeUndefined();
    expect(r.seen).toBe(8);
    expect(r.skipped).toBe(3);
    expect(r.cases.map((c) => c.key)).toEqual(['C-1', 'C-2', 'C-3', '42', 'C-4']);
    expect(r.cases[0].fields).toEqual({ merchant: 'acme', amount: '7450' });
    expect(r.cases[1].fields).toEqual({ merchant: 'beta' });
    expect(r.cases[2]).toEqual({ key: 'C-3' });
    expect(r.cases[4].fields!.note).toHaveLength(2_000);
  });

  it('the last tag wins; an explicit empty list is a result, no tag is undefined', () => {
    expect(parseCaseNominations('<cases>[{"key":"A"}]</cases> revised: <cases>[{"key":"B"}]</cases>')!.cases.map((c) => c.key)).toEqual(['B']);
    expect(parseCaseNominations('nothing today <cases>[]</cases>')).toEqual({ cases: [], seen: 0, skipped: 0 });
    expect(parseCaseNominations('no tag here')).toBeUndefined();
    expect(parseCaseNominations(undefined)).toBeUndefined();
  });

  it('a present tag with a non-array body is an error, never a silent zero', () => {
    expect(parseCaseNominations('<cases>{"key":"A"}</cases>')!.error).toMatch(/must be a JSON array \(got: object\)/);
    expect(parseCaseNominations('<cases>not json</cases>')!.error).toMatch(/not valid JSON/);
  });

  it('scans at most 200 cases', () => {
    const many = JSON.stringify(Array.from({ length: 250 }, (_, i) => ({ key: `K-${i}` })));
    const r = parseCaseNominations(`<cases>${many}</cases>`)!;
    expect(r.seen).toBe(200);
    expect(r.cases).toHaveLength(200);
  });

  it('filterCaseFields keeps the declared vocabulary only; an empty declaration keeps the key alone', () => {
    const cases = [{ key: 'C-1', fields: { merchant: 'a', extra: 'x' } }, { key: 'C-2' }];
    expect(filterCaseFields(cases, { fields: ['merchant'] })).toEqual([{ key: 'C-1', fields: { merchant: 'a' } }, { key: 'C-2' }]);
    expect(filterCaseFields(cases, {})).toEqual([{ key: 'C-1' }, { key: 'C-2' }]);
    expect(discoveryItemTemplateVars({ fields: ['merchant'] })).toEqual(['trigger.item.key', 'trigger.item.merchant']);
    expect(discoveryItemTemplateVars(undefined)).toEqual([]);
  });
});

// ---- the graph: which steps are per-case, and the two seedings ----

const job = (id: string, extra: Record<string, unknown> = {}) => ({ id, customJobRef: `ops/${id}`, directive: id, ...extra });
const gate = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'approval', prompt: id, ...extra });
const defOf = (steps: unknown[], concurrency = 2): PipelineDef =>
  ({ version: 2, name: 'p', on: { schedule: { cron: '0 * * * *' } }, concurrency, steps } as PipelineDef);

/** prepare → scan(discovers) → handle → gate → record, plus an independent audit branch off prepare. */
const DEF = defOf([
  job('prepare'),
  job('scan', { discovers: { fields: ['merchant'] } }),
  job('handle', { directive: 'handle {{trigger.item.key}} for {{trigger.item.merchant}} after {{steps.prepare.answer}}' }),
  gate('gate'),
  job('record'),
  job('audit', { needs: ['prepare'] }),
]);

describe('perCaseStepIds / discoveryStepIndex — the per-case steps are everything downstream of the discovering step', () => {
  it('names the discovering step and closes over its dependents, gates included; independent branches stay out', () => {
    expect(discoveryStepIndex(DEF)).toBe(1);
    expect([...perCaseStepIds(DEF)].sort()).toEqual(['gate', 'handle', 'record']);
    expect(discoveryStepIndex(defOf([job('a'), job('b')]))).toBeUndefined();
    expect(perCaseStepIds(defOf([job('a'), job('b')])).size).toBe(0);
  });
});

const parentRun = (steps: RunRecord['steps'], extra: Partial<RunRecord> = {}): RunRecord => ({
  runId: 'disc-1',
  pipelineId: 'p1',
  projectId: 'proj-a',
  firedBy: 'cron',
  fireEpoch: 1_700_000_000_000,
  status: 'running',
  steps,
  startedAt: '2026-09-21T00:00:00.000Z',
  defSnapshot: DEF,
  activationSnapshot: { pipelineId: 'p1', pipelineScope: 'user', projectId: 'proj-a', activatedAt: '2026-09-16T00:00:00.000Z', activatedBy: 'user' },
  ...extra,
});

describe('run seedings — the executor learns nothing; the step set does', () => {
  it('a discovery run pre-skips the per-case steps and seals completed once the discovering prefix does', () => {
    const steps = buildDiscoveryRunSteps(DEF);
    expect(steps.map((s) => `${s.stepId}:${s.status}`)).toEqual(['prepare:pending', 'scan:pending', 'handle:skipped', 'gate:skipped', 'record:skipped', 'audit:pending']);
    let run = parentRun(steps);
    let plan = planAdvance(DEF, run);
    expect(plan.dispatches.map((d) => d.stepId)).toEqual(['prepare']);
    plan = applyStepOutcome(DEF, plan.run, 'prepare', 'succeeded', { output: { answer: 'PREP', capturedAt: 'now' } });
    expect(plan.dispatches.map((d) => d.stepId)).toEqual(['scan']);
    plan = applyStepOutcome(DEF, plan.run, 'scan', 'succeeded', { cases: [{ key: 'C-1' }] });
    // The per-case steps never dispatch here; the independent branch still runs.
    expect(plan.dispatches.map((d) => d.stepId)).toEqual(['audit']);
    plan = applyStepOutcome(DEF, plan.run, 'audit', 'succeeded');
    expect(plan.run.status).toBe('completed');
    expect(plan.run.steps.filter((s) => s.status === 'skipped').map((s) => s.stepId)).toEqual(['handle', 'gate', 'record']);
  });

  it('a case run copies the sealed prefix (output + verdict, identity stripped), runs the per-case steps, and skips an unsealed branch', () => {
    const parent = parentRun([
      { stepId: 'prepare', status: 'succeeded', jobId: 'j-prep', turnId: 't1', output: { answer: 'PREP', capturedAt: 'now' }, retriesUsed: 1 },
      { stepId: 'scan', status: 'succeeded', jobId: 'j-scan', cases: [{ key: 'C-1' }], verdict: 'found' },
      { stepId: 'handle', status: 'skipped' },
      { stepId: 'gate', status: 'skipped' },
      { stepId: 'record', status: 'skipped' },
      { stepId: 'audit', status: 'dispatched', jobId: 'j-audit' },
    ]);
    const steps = buildCaseRunSteps(DEF, parent);
    expect(steps).toEqual([
      { stepId: 'prepare', status: 'succeeded', output: { answer: 'PREP', capturedAt: 'now' } },
      { stepId: 'scan', status: 'succeeded', verdict: 'found' },
      { stepId: 'handle', status: 'pending' },
      { stepId: 'gate', status: 'pending' },
      { stepId: 'record', status: 'pending' },
      { stepId: 'audit', status: 'skipped' },
    ]);
    const caseRun: RunRecord = { ...parentRun(steps), runId: 'case-1', firedBy: 'discovery', discoveryRunId: 'disc-1', discoveryStepId: 'scan', item: { key: 'C-1', fields: { merchant: 'acme' } } };
    const plan = planAdvance(DEF, caseRun);
    expect(plan.dispatches.map((d) => d.stepId)).toEqual(['handle']);
    // The copied prefix is what the case's directive reads — one render site, no new grammar.
    expect(renderDirective((DEF.steps[2] as any).directive, plan.run)).toBe('handle C-1 for acme after PREP');
  });
});

// ---- disk + Redis harness (fetch test precedent) ----

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-discovery-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const OWNER = { userId: 'user', organizationId: 'local', organizationKind: 'local' as const };
const ACT_ROOT = (ws: string) => path.join(ws, 'local', 'user', '.ant', 'pipeline-activations');
const CLAIM_KEY = (key: string) => `ant:pipe:item:local:user:proj-a:p1:${key}`;
const RUN_KEY = (runId: string) => `ant:pipe:run:${runId}`;

function scaffold(ws: string, def: PipelineDef): void {
  const agentDir = path.join(ws, 'local', 'user', '.ant', 'agents', 'ops');
  for (const jobId of ['prepare', 'scan', 'handle', 'record', 'audit']) fs.mkdirSync(path.join(agentDir, 'jobs', jobId), { recursive: true });
  fs.mkdirSync(path.join(agentDir, 'base'), { recursive: true });
  fs.writeFileSync(path.join(agentDir, 'base', 'role.md'), 'You handle cases.\n');
  fs.writeFileSync(path.join(agentDir, 'agent.yaml'), 'id: ops\nname: Ops\nversion: 1\n');
  for (const jobId of ['prepare', 'scan', 'handle', 'record', 'audit']) fs.writeFileSync(path.join(agentDir, 'jobs', jobId, 'job.yaml'), `id: ${jobId}\nname: ${jobId}\n`);
  const defDir = path.join(ws, 'local', 'user', '.ant', 'pipelines', 'p1');
  fs.mkdirSync(defDir, { recursive: true });
  fs.writeFileSync(path.join(defDir, 'pipeline.yaml'), JSON.stringify(def));
  fs.writeFileSync(path.join(defDir, 'availability.json'), JSON.stringify({ enabled: true, changedAt: '2026-09-16T00:00:00.000Z' }));
  const actDir = path.join(ACT_ROOT(ws), 'proj-a');
  fs.mkdirSync(actDir, { recursive: true });
  fs.writeFileSync(path.join(actDir, 'activation.json'), JSON.stringify({ pipelineId: 'p1', pipelineScope: 'user', projectId: 'proj-a', activatedAt: '2026-09-16T00:00:00.000Z' }));
}

function makeCtx(ws: string, def: PipelineDef = DEF) {
  const keys = new Map<string, string>();
  const slots = new Map<string, Set<string>>();
  const enqueued: any[] = [];
  const armed: any[] = [];
  const published: any[] = [];
  const dispatched: any[] = [];
  const locks = new Set<string>();
  const stateStore = {
    acquireLock: async (k: string) => {
      if (locks.has(k)) return false;
      locks.add(k);
      return true;
    },
    releaseLock: async (k: string) => void locks.delete(k),
    releaseLockIfOwner: async (k: string, v: string) => {
      if (keys.get(k) === v) keys.delete(k);
    },
    tryAcquireLock: async (k: string, v: string) => {
      if (keys.has(k)) return false;
      keys.set(k, v);
      return true;
    },
    exists: async (k: string) => keys.has(k),
    getKey: async (k: string) => keys.get(k) ?? null,
    setKeyWithTTL: async (k: string, v: string) => void keys.set(k, v),
    deleteKey: async (k: string) => void keys.delete(k),
    countSlots: async (k: string) => slots.get(k)?.size ?? 0,
    listSlots: async (k: string) => [...(slots.get(k) ?? [])],
    reserveSlot: async (k: string, m: string, limit: number) => {
      const set = slots.get(k) ?? new Set<string>();
      slots.set(k, set);
      if (!set.has(m) && set.size >= limit) return false;
      set.add(m);
      return true;
    },
    refreshSlot: async (k: string, m: string) => slots.get(k)?.has(m) ?? false,
    releaseSlot: async (k: string, m: string) => void slots.get(k)?.delete(m),
    publish: async (_ch: string, msg: any) => void published.push(msg),
  };
  const containerPath = path.join(ws, 'container');
  const deps = {
    stateStore,
    scheduleQueue: {
      addNow: async (d: any) => void enqueued.push(d),
      armDelayed: async (id: string, delayMs: number, data: any) => void armed.push({ id, delayMs, data }),
      cancelDelayed: async () => {},
    },
    workspacesPath: ws,
    workspaceResolver: {
      getPhysicalWorkspacesPath: () => ws,
      getProjectPath: () => containerPath,
      getUniversalContainerPath: () => containerPath,
    },
  };
  const ctx: any = {
    deps,
    executeDispatches: async (_o: any, _d: any, run: any, dispatches: any[]) => void dispatched.push({ run, dispatches }),
  };
  ctx.finalizeRun = (o: any, run: any) => finalizeRun(ctx, o, run);
  scaffold(ws, def);
  return { ctx, deps, keys, slots, enqueued, armed, published, dispatched, locks, containerPath };
}

const sealedDiscoveryRun = (): RunRecord =>
  parentRun([
    { stepId: 'prepare', status: 'succeeded', jobId: 'j-prep', output: { answer: 'PREP', capturedAt: 'now' } },
    { stepId: 'scan', status: 'succeeded', jobId: 'j-scan', cases: [{ key: 'C-1', fields: { merchant: 'acme' } }, { key: 'C-2' }, { key: 'C-3' }] },
    { stepId: 'handle', status: 'skipped' },
    { stepId: 'gate', status: 'skipped' },
    { stepId: 'record', status: 'skipped' },
    { stepId: 'audit', status: 'succeeded' },
  ], { status: 'completed', endedAt: '2026-09-21T00:10:00.000Z' });

const CASES = [{ key: 'C-1', fields: { merchant: 'acme' } }, { key: 'C-2' }, { key: 'C-3' }];

// ---- the queue leg ----

describe('queueDiscoveredCases — every case claimed at once (NX + queued ledger line), audited, drain kicked', () => {
  it('queues each unclaimed case, skips one the ledger already holds, appends cases_claimed, kicks a case-drain', async () => {
    const { ctx, keys, enqueued } = makeCtx(tmp);
    const run = sealedDiscoveryRun();
    keys.set(RUN_KEY(run.runId), JSON.stringify(run));
    keys.set('ant:pipe:items-built:local:user:proj-a', 'x');
    keys.set(CLAIM_KEY('C-2'), claimValue('run-older', '2026-09-20T00:00:00.000Z'));
    await queueDiscoveredCases(ctx, OWNER, run, 'scan', CASES);
    // Queued projection: spoken for, no run yet.
    expect(parseClaimValue(keys.get(CLAIM_KEY('C-1')) ?? null)).toEqual({ claimedAt: expect.any(String) });
    expect(parseClaimValue(keys.get(CLAIM_KEY('C-2')) ?? null)!.runId).toBe('run-older');
    const ledger = readItemClaims(ACT_ROOT(tmp), 'proj-a', 'p1');
    expect(ledger.map((l) => l.key)).toEqual(['C-1', 'C-3']);
    expect(ledger[0]).toMatchObject({ key: 'C-1', queuedFrom: 'disc-1', item: { key: 'C-1', fields: { merchant: 'acme' } } });
    expect(ledger[0].runId).toBeUndefined();
    const events = fs.readFileSync(path.join(ACT_ROOT(tmp), 'proj-a', 'runs', 'disc-1.jsonl'), 'utf-8');
    expect(events).toMatch(/"event":"cases_claimed".*"discovered":3,"queued":2,"skipped":1/);
    expect(enqueued).toEqual([{ kind: 'case-drain', owner: OWNER, pipelineId: 'p1', pipelineScope: 'user', projectId: 'proj-a' }]);
  });

  it('an explicit empty list audits and kicks nothing', async () => {
    const { ctx, keys, enqueued } = makeCtx(tmp);
    const run = sealedDiscoveryRun();
    keys.set(RUN_KEY(run.runId), JSON.stringify(run));
    await queueDiscoveredCases(ctx, OWNER, run, 'scan', []);
    expect(enqueued).toEqual([]);
    expect(fs.readFileSync(path.join(ACT_ROOT(tmp), 'proj-a', 'runs', 'disc-1.jsonl'), 'utf-8')).toMatch(/"discovered":0,"queued":0/);
  });
});

// ---- the drain ----

const DRAIN = { kind: 'case-drain' as const, owner: OWNER, pipelineId: 'p1', pipelineScope: 'user' as const, projectId: 'proj-a' };

describe('handleCaseDrain — room under concurrency, FIFO over queued lines, re-arm while cases wait', () => {
  it('fires as many queued cases as the activation has room for (discovery identity on each) and re-arms for the rest', async () => {
    const { ctx, keys, enqueued, armed } = makeCtx(tmp);
    const run = sealedDiscoveryRun();
    keys.set(RUN_KEY(run.runId), JSON.stringify(run));
    await queueDiscoveredCases(ctx, OWNER, run, 'scan', CASES);
    enqueued.length = 0;
    await handleCaseDrain(ctx, DRAIN);
    expect(enqueued.map((d) => d.kind)).toEqual(['fire', 'fire']);
    expect(enqueued[0]).toMatchObject({ firedBy: 'discovery', pipelineId: 'p1', projectId: 'proj-a', item: { key: 'C-1', fields: { merchant: 'acme' } }, discoveryRunId: 'disc-1', discoveryStepId: 'scan' });
    expect(enqueued[1].item).toEqual({ key: 'C-2' });
    expect(armed).toEqual([{ id: 'case-drain-local-user-proj-a', delayMs: CASE_DRAIN_DELAY_MS, data: DRAIN }]);
    // The drain claims nothing itself — projections are unchanged (still queued).
    expect(parseClaimValue(keys.get(CLAIM_KEY('C-1')) ?? null)!.runId).toBeUndefined();
  });

  it('a full activation fires nothing but keeps the arm; an empty queue arms nothing; a held lock skips', async () => {
    const { ctx, keys, slots, enqueued, armed } = makeCtx(tmp);
    const run = sealedDiscoveryRun();
    keys.set(RUN_KEY(run.runId), JSON.stringify(run));
    await queueDiscoveredCases(ctx, OWNER, run, 'scan', CASES);
    enqueued.length = 0;
    slots.set('ant:pipe:actruns:local:user:proj-a', new Set(['live-1', 'live-2']));
    await handleCaseDrain(ctx, DRAIN);
    expect(enqueued).toEqual([]);
    expect(armed).toHaveLength(1);
    keys.set('ant:lock:pipe-drain:local:user:proj-a', 'another-replica');
    await handleCaseDrain(ctx, DRAIN);
    expect(armed).toHaveLength(1);
    expect(keys.get('ant:lock:pipe-drain:local:user:proj-a')).toBe('another-replica');
  });

  it('a case whose fire died between claim and commit (started line, no run, past grace) is RE-QUEUED and fired again', async () => {
    const { ctx, keys, enqueued } = makeCtx(tmp);
    const run = sealedDiscoveryRun();
    keys.set(RUN_KEY(run.runId), JSON.stringify(run));
    await queueDiscoveredCases(ctx, OWNER, run, 'scan', [CASES[0]]);
    enqueued.length = 0;
    // A promoted claim whose run never landed: Redis says started, disk says started, nothing else exists.
    const dead = new Date(Date.now() - 2 * ITEM_CLAIM_GRACE_MS).toISOString();
    keys.set(CLAIM_KEY('C-1'), claimValue('run-dead', dead));
    fs.appendFileSync(path.join(ACT_ROOT(tmp), 'proj-a', 'items', 'p1.jsonl'), `${JSON.stringify({ key: 'C-1', runId: 'run-dead', claimedAt: dead, queuedFrom: 'disc-1', item: CASES[0] })}\n`);
    expect(readQueuedCases(ACT_ROOT(tmp), 'proj-a', 'p1')).toEqual([]);
    await handleCaseDrain(ctx, DRAIN);
    expect(enqueued.map((d) => d.kind)).toEqual(['fire']);
    expect(enqueued[0]).toMatchObject({ item: CASES[0], discoveryRunId: 'disc-1' });
    expect(parseClaimValue(keys.get(CLAIM_KEY('C-1')) ?? null)!.runId).toBeUndefined();
    expect(readQueuedCases(ACT_ROOT(tmp), 'proj-a', 'p1').map((c) => c.key)).toEqual(['C-1']);
    // A LIVE started claim is left alone.
    keys.set(CLAIM_KEY('C-1'), claimValue('run-live', dead));
    keys.set(RUN_KEY('run-live'), '{}');
    fs.appendFileSync(path.join(ACT_ROOT(tmp), 'proj-a', 'items', 'p1.jsonl'), `${JSON.stringify({ key: 'C-1', runId: 'run-live', claimedAt: dead, queuedFrom: 'disc-1' })}\n`);
    enqueued.length = 0;
    await handleCaseDrain(ctx, DRAIN);
    expect(enqueued).toEqual([]);
  });

  it('rebuilds the claim projection from the disk ledger before judging (fail-CLOSED, queued lines kept)', async () => {
    const { ctx, keys, enqueued } = makeCtx(tmp);
    const run = sealedDiscoveryRun();
    keys.set(RUN_KEY(run.runId), JSON.stringify(run));
    await queueDiscoveredCases(ctx, OWNER, run, 'scan', CASES);
    for (const k of [...keys.keys()]) if (k.startsWith('ant:pipe:item')) keys.delete(k);
    enqueued.length = 0;
    await handleCaseDrain(ctx, DRAIN);
    expect(keys.has('ant:pipe:items-built:local:user:proj-a')).toBe(true);
    expect(parseClaimValue(keys.get(CLAIM_KEY('C-3')) ?? null)).toEqual({ claimedAt: expect.any(String) });
    expect(enqueued).toHaveLength(2);
  });
});

// ---- the fire path: a queued case becomes a case run ----

describe('handleFire with firedBy: discovery — queued claim promoted, prefix copied, identity frozen', () => {
  const FIRE = { kind: 'fire' as const, owner: OWNER, pipelineId: 'p1', pipelineScope: 'user' as const, projectId: 'proj-a', firedBy: 'discovery' as const, fireEpoch: 1_700_000_100_000 };
  const queue = async (ctx: any, keys: Map<string, string>) => {
    const run = sealedDiscoveryRun();
    keys.set(RUN_KEY(run.runId), JSON.stringify(run));
    await queueDiscoveredCases(ctx, OWNER, run, 'scan', CASES);
  };

  it('promotes the queued claim (Redis runId + started ledger line with queuedFrom), seeds from the parent, freezes the case', async () => {
    const { ctx, keys, locks, dispatched } = makeCtx(tmp);
    await queue(ctx, keys);
    await handleFire(ctx, { ...FIRE, item: CASES[0], discoveryRunId: 'disc-1', discoveryStepId: 'scan' }, Date.now());
    expect(dispatched).toHaveLength(1);
    const run: RunRecord = dispatched[0].run;
    expect(run).toMatchObject({ firedBy: 'discovery', discoveryRunId: 'disc-1', discoveryStepId: 'scan', item: { key: 'C-1', fields: { merchant: 'acme' } } });
    expect(run.prevSuccessFireEpoch).toBeUndefined();
    expect(run.steps.map((s) => `${s.stepId}:${s.status}`)).toEqual(['prepare:succeeded', 'scan:succeeded', 'handle:dispatched', 'gate:pending', 'record:pending', 'audit:succeeded']);
    expect(run.steps[0].output?.answer).toBe('PREP');
    expect(run.steps[0].jobId).toBeUndefined();
    expect(run.steps[1].cases).toBeUndefined();
    expect(dispatched[0].dispatches.map((d: any) => d.stepId)).toEqual(['handle']);
    expect(parseClaimValue(keys.get(CLAIM_KEY('C-1')) ?? null)!.runId).toBe(run.runId);
    const ledger = readItemClaims(ACT_ROOT(tmp), 'proj-a', 'p1');
    expect(ledger.at(-1)).toEqual({ key: 'C-1', runId: run.runId, claimedAt: run.startedAt, queuedFrom: 'disc-1', item: CASES[0] });
    expect(readQueuedCases(ACT_ROOT(tmp), 'proj-a', 'p1').map((c) => c.key)).toEqual(['C-2', 'C-3']);
    expect(locks.has('ant:pipe:fired:local:user:proj-a:discovery:disc-1:C-1')).toBe(true);
    const events = fs.readFileSync(path.join(ACT_ROOT(tmp), 'proj-a', 'runs', `${run.runId}.jsonl`), 'utf-8');
    expect(events).toMatch(/"event":"fired".*"discoveryRunId":"disc-1"/);
    expect(events).toMatch(/"event":"item_claimed".*"key":"C-1"/);
  });

  it('two drains racing on one case fire it once (epoch-free NX); a case already started is skipped with the slots given back', async () => {
    const { ctx, keys, locks, slots, dispatched } = makeCtx(tmp);
    await queue(ctx, keys);
    await handleFire(ctx, { ...FIRE, item: CASES[1], discoveryRunId: 'disc-1', discoveryStepId: 'scan' }, Date.now());
    await handleFire(ctx, { ...FIRE, fireEpoch: FIRE.fireEpoch + 60_000, item: CASES[1], discoveryRunId: 'disc-1', discoveryStepId: 'scan' }, Date.now());
    expect(dispatched).toHaveLength(1);
    // Even with the fire NX gone, a started claim refuses a second run.
    locks.delete('ant:pipe:fired:local:user:proj-a:discovery:disc-1:C-2');
    await handleFire(ctx, { ...FIRE, item: CASES[1], discoveryRunId: 'disc-1', discoveryStepId: 'scan' }, Date.now());
    expect(dispatched).toHaveLength(1);
    expect(slots.get('ant:pipe:actruns:local:user:proj-a')!.size).toBe(1);
    expect(slots.get('ant:pipe:runslots:local:user')!.size).toBe(1);
  });

  it('a full activation leaves the case QUEUED (claim untouched) — the drain will retry', async () => {
    const { ctx, keys, locks, slots, dispatched } = makeCtx(tmp);
    await queue(ctx, keys);
    slots.set('ant:pipe:actruns:local:user:proj-a', new Set(['live-1', 'live-2']));
    await handleFire(ctx, { ...FIRE, item: CASES[2], discoveryRunId: 'disc-1', discoveryStepId: 'scan' }, Date.now());
    expect(dispatched).toEqual([]);
    expect(parseClaimValue(keys.get(CLAIM_KEY('C-3')) ?? null)!.runId).toBeUndefined();
    // The fire NX is given back with the slots, so the drain's next fire passes it.
    expect(locks.has('ant:pipe:fired:local:user:proj-a:discovery:disc-1:C-3')).toBe(false);
  });

  it('a discovery fire without its case or its discovery run is refused before any reservation', async () => {
    const { ctx, slots, dispatched, locks } = makeCtx(tmp);
    await handleFire(ctx, { ...FIRE, item: CASES[0] }, Date.now());
    await handleFire(ctx, { ...FIRE, discoveryRunId: 'disc-1' }, Date.now());
    expect(dispatched).toEqual([]);
    expect(slots.size).toBe(0);
    expect([...locks].some((k) => k.startsWith('ant:pipe:fired:'))).toBe(false);
  });

  it('a parent whose record is gone fails the case run LOUDLY — a sealed history row, the claim promoted, never a silent drop', async () => {
    const { ctx, keys, slots, dispatched } = makeCtx(tmp);
    await queue(ctx, keys);
    keys.delete(RUN_KEY('disc-1'));
    await handleFire(ctx, { ...FIRE, item: CASES[0], discoveryRunId: 'disc-1', discoveryStepId: 'scan' }, Date.now());
    expect(dispatched).toEqual([]);
    const runKey = [...keys.keys()].find((k) => k.startsWith('ant:pipe:run:') && k !== RUN_KEY('disc-1'))!;
    const failed = JSON.parse(keys.get(runKey)!) as RunRecord;
    expect(failed).toMatchObject({ status: 'failed', firedBy: 'discovery', discoveryRunId: 'disc-1', error: expect.stringMatching(/^discovery-run-missing/) });
    expect(failed.endedAt).toBeDefined();
    expect(failed.steps.every((s) => s.status === 'cancelled')).toBe(true);
    expect(parseClaimValue(keys.get(CLAIM_KEY('C-1')) ?? null)!.runId).toBe(failed.runId);
    expect(slots.get('ant:pipe:actruns:local:user:proj-a')!.size).toBe(0);
    expect(fs.readFileSync(path.join(ACT_ROOT(tmp), 'proj-a', 'runs', 'index.jsonl'), 'utf-8')).toMatch(/"status":"failed"/);
  });

  it('a definition with a discovering step fires DISCOVERY runs on cron: per-case steps pre-skipped', async () => {
    const { ctx, dispatched } = makeCtx(tmp);
    await handleFire(ctx, { ...FIRE, firedBy: 'cron' }, Date.now());
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].run.steps.map((s: any) => `${s.stepId}:${s.status}`)).toEqual(['prepare:dispatched', 'scan:pending', 'handle:skipped', 'gate:skipped', 'record:skipped', 'audit:pending']);
    expect(dispatched[0].run.discoveryRunId).toBeUndefined();
  });
});

// ---- the seal → queue transition, end to end through applyOutcome ----

describe('applyOutcome on a discovering step — queue, then the discovery run seals and kicks the drain', () => {
  it('a succeeded discovering seal with cases queues them, seals the run completed, and kicks the drain twice (seal + finalize)', async () => {
    const { ctx, keys, enqueued } = makeCtx(tmp);
    const live = parentRun([
      { stepId: 'prepare', status: 'succeeded', output: { answer: 'PREP', capturedAt: 'now' } },
      { stepId: 'scan', status: 'running', jobId: 'j-scan' },
      { stepId: 'handle', status: 'skipped' },
      { stepId: 'gate', status: 'skipped' },
      { stepId: 'record', status: 'skipped' },
      { stepId: 'audit', status: 'succeeded' },
    ]);
    keys.set(RUN_KEY('disc-1'), JSON.stringify(live));
    const applied = await applyOutcome(ctx, OWNER, 'disc-1', 'scan', 'succeeded', { cases: CASES }, undefined, 'j-scan');
    expect(applied).toBe(true);
    const sealed = JSON.parse(keys.get(RUN_KEY('disc-1'))!) as RunRecord;
    expect(sealed.status).toBe('completed');
    expect(sealed.endedAt).toBeDefined();
    expect(sealed.steps.find((s) => s.stepId === 'scan')!.cases).toEqual(CASES);
    expect(readQueuedCases(ACT_ROOT(tmp), 'proj-a', 'p1').map((c) => c.key)).toEqual(['C-1', 'C-2', 'C-3']);
    expect(enqueued.filter((d) => d.kind === 'case-drain')).toHaveLength(2);
    const events = fs.readFileSync(path.join(ACT_ROOT(tmp), 'proj-a', 'runs', 'disc-1.jsonl'), 'utf-8');
    expect(events.indexOf('"cases_claimed"')).toBeLessThan(events.indexOf('"run_finished"'));
  });

  it('a case run\'s discovering step arrived sealed: an outcome for it is a no-op, nothing is re-queued', async () => {
    const { ctx, keys, enqueued } = makeCtx(tmp);
    const caseRun: RunRecord = { ...parentRun(buildCaseRunSteps(DEF, sealedDiscoveryRun())), runId: 'case-9', firedBy: 'discovery', discoveryRunId: 'disc-1', discoveryStepId: 'scan', item: CASES[0] };
    keys.set(RUN_KEY('case-9'), JSON.stringify(caseRun));
    await applyOutcome(ctx, OWNER, 'case-9', 'scan', 'succeeded', { cases: CASES });
    expect(enqueued).toEqual([]);
    expect(readQueuedCases(ACT_ROOT(tmp), 'proj-a', 'p1')).toEqual([]);
  });
});

// ---- the seal reader's contract ----

describe('captureStepOutput — the discovers contract (declared fields, onMissing, invalid body, case runs excluded)', () => {
  const withSeal = (keys: Map<string, string>, containerPath: string, run: RunRecord, state: Record<string, unknown>) => {
    keys.set(RUN_KEY(run.runId), JSON.stringify(run));
    const sessionPath = getUniversalSessionFilePath(containerPath, { agentId: 'ops', jobId: 'scan' }, run.runId);
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(sessionPath, JSON.stringify({ state: { jobId: 'j-scan', ...state } }));
  };

  it('filters the sealed cases to the declared vocabulary', async () => {
    const { deps, keys, containerPath } = makeCtx(tmp);
    withSeal(keys, containerPath, parentRun([]), { cases: [{ key: 'C-1', fields: { merchant: 'acme', extra: 'x' } }] });
    const r = await captureStepOutput(deps as any, OWNER, 'disc-1', 'scan', 'j-scan');
    expect(r.cases).toEqual([{ key: 'C-1', fields: { merchant: 'acme' } }]);
    expect(r.missingCases).toBeUndefined();
  });

  it.each([
    ['no tag, default policy → missingCases', {}, undefined, { missingCases: true }],
    ['no tag, onMissing: complete → an empty list', {}, 'complete', { cases: [] }],
    ['an unreadable body → casesError', { casesError: 'the <cases> body must be a JSON array (got: object)' }, undefined, { casesError: expect.stringMatching(/JSON array/) }],
  ] as const)('%s', async (_label, state, onMissing, expected) => {
    const { deps, keys, containerPath } = makeCtx(tmp);
    const def = defOf([job('prepare'), job('scan', { discovers: onMissing ? { fields: ['merchant'], onMissing } : { fields: ['merchant'] } }), job('handle')]);
    withSeal(keys, containerPath, parentRun([], { defSnapshot: def }), state as Record<string, unknown>);
    const r = await captureStepOutput(deps as any, OWNER, 'disc-1', 'scan', 'j-scan');
    expect(r).toMatchObject(expected as Record<string, unknown>);
  });

  it('a CASE run captures no cases contract for the (already sealed) discovering step', async () => {
    const { deps, keys, containerPath } = makeCtx(tmp);
    withSeal(keys, containerPath, parentRun([], { firedBy: 'discovery', discoveryRunId: 'disc-0' }), {});
    const r = await captureStepOutput(deps as any, OWNER, 'disc-1', 'scan', 'j-scan');
    expect(r.missingCases).toBeUndefined();
    expect(r.cases).toBeUndefined();
  });
});

// ---- the ledger the two executors share ----

describe('claim ledger — queued lines are waiting, never dead; newest line per key wins', () => {
  it('isDeadClaim never judges a queued claim dead; readQueuedCases folds started lines out', async () => {
    const { ctx } = makeCtx(tmp);
    const actRoot = ACT_ROOT(tmp);
    const old = new Date(Date.now() - 3 * ITEM_CLAIM_GRACE_MS).toISOString();
    expect(await isDeadClaim(ctx.deps.stateStore, actRoot, 'proj-a', { claimedAt: old })).toBe(false);
    expect(await isDeadClaim(ctx.deps.stateStore, actRoot, 'proj-a', { runId: 'gone', claimedAt: old })).toBe(true);
    fs.mkdirSync(path.join(actRoot, 'proj-a', 'items'), { recursive: true });
    fs.writeFileSync(
      path.join(actRoot, 'proj-a', 'items', 'p1.jsonl'),
      [
        JSON.stringify({ key: 'A', claimedAt: old, queuedFrom: 'disc-1', item: { key: 'A' } }),
        JSON.stringify({ key: 'B', claimedAt: old, queuedFrom: 'disc-1', item: { key: 'B' } }),
        JSON.stringify({ key: 'A', runId: 'run-a', claimedAt: old, queuedFrom: 'disc-1' }),
      ].join('\n') + '\n',
    );
    expect(readQueuedCases(actRoot, 'proj-a', 'p1').map((c) => c.key)).toEqual(['B']);
    // The rebuild keeps the queued line (no runId) and a LIVE started one alike; newest line per key wins.
    await ctx.deps.stateStore.setKeyWithTTL(RUN_KEY('run-a'), '{}');
    await ensureItemLedger(ctx.deps.stateStore, actRoot, OWNER, 'proj-a', 'p1');
    expect(parseClaimValue(await ctx.deps.stateStore.getKey(CLAIM_KEY('B')))).toEqual({ claimedAt: old });
    expect(parseClaimValue(await ctx.deps.stateStore.getKey(CLAIM_KEY('A')))).toEqual({ runId: 'run-a', claimedAt: old });
  });

  it('claimValue / parseClaimValue round-trip both shapes', () => {
    expect(parseClaimValue(claimValue(undefined, 't'))).toEqual({ claimedAt: 't' });
    expect(parseClaimValue(claimValue('r', 't'))).toEqual({ runId: 'r', claimedAt: 't' });
    expect(parseClaimValue('{"runId":"r"}')).toBeNull();
    expect(parseClaimValue(null)).toBeNull();
  });
});
