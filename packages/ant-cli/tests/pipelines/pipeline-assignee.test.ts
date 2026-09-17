/**
 * Gate candidate / assignee split (doc 46 §5a-ii), one axis one file:
 * the `<assignee>` tag (registry entry + seal lift), the candidate set, the
 * nomination the gate reads, the ∈-candidates check, and audience narrowing
 * with its whole-roster fallback. Authority never moves — the resolve leg's
 * decision table stays in `tests/http/pipeline-routes-policy.test.ts`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { PipelineDef } from '@ant/shared';
import {
  gateCandidates,
  narrowAudience,
  nominatedAssigneeFor,
  parseAssigneeNomination,
  resolveGateAssignees,
} from '../../src/core/pipelines/assignees';
import { findTag, stripRegisteredTags, transformAndStrip } from '../../src/core/streaming/OutputTagRegistry';
import { gateAudience, reassignGate } from '../../src/infrastructure/scheduling/pipelineRun/gates';

const SRC = path.join(__dirname, '../../src');

const DEF = {
  version: 2,
  name: 'refund',
  steps: [
    { id: 'triage', customJobRef: 'ops/refund', directive: 't' },
    { id: 'calc', customJobRef: 'ops/refund', directive: 'c' },
    { id: 'gate', type: 'approval', prompt: 'ok?', needs: ['calc', 'triage'] },
    { id: 'pay', customJobRef: 'ops/refund', directive: 'p' },
  ],
} as unknown as PipelineDef;

describe('<assignee> — one registered tag, lifted like <verdict>', () => {
  it('is a registered metadata tag with a chat render and a post-stream extract', () => {
    const tag = findTag<string | undefined>('assignee');
    expect(tag).toBeDefined();
    expect(tag!.axis).toMatchObject({ intent: 'metadata', blocking: 'non-blocking' });
    expect(tag!.axis.processing).toEqual(expect.arrayContaining(['consumed-formatted', 'post-stream']));
    expect(tag!.extract?.('done.\n<assignee>Bob@Corp.com</assignee>')).toBe('bob@corp.com');
  });

  it('the LAST nomination wins, ids normalize to lowercase, prose/none/oversize yield nothing', () => {
    expect(parseAssigneeNomination('<assignee>a@x.io</assignee> then <assignee>B@x.io</assignee>')).toBe('b@x.io');
    expect(parseAssigneeNomination('no tag here')).toBeUndefined();
    expect(parseAssigneeNomination(undefined)).toBeUndefined();
    expect(parseAssigneeNomination(`<assignee>${'a'.repeat(300)}</assignee>`)).toBeUndefined();
    expect(parseAssigneeNomination('<assignee>two words</assignee>')).toBeUndefined();
  });

  it('never reaches the reader raw: stripped from a step answer, rendered as one audit line in chat', () => {
    expect(stripRegisteredTags('결정했습니다.\n<assignee>bob@x.io</assignee>')).not.toMatch(/<assignee>/);
    const text = transformAndStrip('done\n<assignee>bob@x.io</assignee>', 'en');
    expect(text).toMatch(/Reviewer nominated: \*\*bob@x\.io\*\*/);
    expect(text).not.toMatch(/<assignee>/);
  });
});

describe('candidates ∪ nomination → assignees', () => {
  it('candidates = activator first, then the gate roster, deduped; a gate off the map = activator only', () => {
    const activation = { approvers: { gate: ['bob', 'alice', 'carol'] } };
    expect(gateCandidates('alice', activation, 'gate')).toEqual(['alice', 'bob', 'carol']);
    expect(gateCandidates('alice', activation, 'other-gate')).toEqual(['alice']);
    expect(gateCandidates('alice', null, 'gate')).toEqual(['alice']);
  });

  it('the gate reads the first DIRECT need (definition order) that sealed a nomination — never a transitive one', () => {
    const run = { steps: [{ stepId: 'triage', status: 'succeeded', assignee: 'carol' }, { stepId: 'calc', status: 'succeeded' }] } as any;
    expect(nominatedAssigneeFor(DEF, run, 'gate')).toBe('carol'); // needs: [calc, triage] → calc has none, triage nominated
    const both = { steps: [{ stepId: 'triage', status: 'succeeded', assignee: 'carol' }, { stepId: 'calc', status: 'succeeded', assignee: 'bob' }] } as any;
    expect(nominatedAssigneeFor(DEF, both, 'gate')).toBe('bob'); // first listed need wins
    // `pay` needs only `gate` (implicit) — a gate step never nominates.
    expect(nominatedAssigneeFor(DEF, both, 'pay')).toBeUndefined();
    expect(nominatedAssigneeFor(DEF, both, 'missing')).toBeUndefined();
  });

  it('a nomination is kept only when it names a candidate; otherwise dropped and audited, never widened', () => {
    expect(resolveGateAssignees('bob', ['alice', 'bob'])).toEqual({ assignees: ['bob'] });
    expect(resolveGateAssignees('dave', ['alice', 'bob'])).toEqual({ unresolved: 'dave' });
    expect(resolveGateAssignees(undefined, ['alice', 'bob'])).toEqual({});
  });

  it('audience narrows to the surviving assignees plus the activator; none surviving = the whole roster', () => {
    expect(narrowAudience('alice', ['bob', 'carol'], ['bob'])).toEqual(['alice', 'bob']);
    expect(narrowAudience('alice', ['bob', 'carol'], ['alice'])).toEqual(['alice']);
    // Roster edit dropped the assignee → fall back to everyone, never a silenced gate.
    expect(narrowAudience('alice', ['bob', 'carol'], ['dave'])).toEqual(['alice', 'bob', 'carol']);
    expect(narrowAudience('alice', ['bob', 'carol'], undefined)).toEqual(['alice', 'bob', 'carol']);
  });
});

describe('gateAudience — the live roster read, narrowed per leg', () => {
  let tmp: string | undefined;
  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it('only the REMINDER leg narrows; arm, reassign, roster re-fire and resolved reach every candidate (friction, not a wall)', () => {
    const gates = fs.readFileSync(path.join(SRC, 'infrastructure/scheduling/pipelineRun/gates.ts'), 'utf-8');
    // A non-assigned candidate with the app open only learns of the gate from the
    // arm's approvalRequested row (GET /approvals is fetched on mount/reconnect) —
    // narrowing the arm hid the row they were meant to be able to self-claim.
    expect(gates.match(/narrowToAssignees: true/g)?.length).toBe(1);
    expect(gates.indexOf('narrowToAssignees: true')).toBeGreaterThan(gates.indexOf('export async function handleGateRemind'));
    // Routing lives on the run record only — the HITL record carries no assignees to resurrect.
    expect(fs.readFileSync(path.join(SRC, 'infrastructure/scheduling/pipelineRun/types.ts'), 'utf-8')).not.toMatch(/assignees/);
  });

  it('with assignees, the audience narrows to them + the activator; without, it is the whole roster', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-assignee-'));
    const dir = path.join(tmp, 'acme', 'alice', '.ant', 'pipeline-activations', 'proj-a');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'activation.json'),
      JSON.stringify({ pipelineId: 'refund', pipelineScope: 'org', projectId: 'proj-a', activatedAt: '2026-09-16T00:00:00.000Z', approvers: { gate: ['bob', 'carol'] } }),
    );
    const ctx = { deps: { workspacesPath: tmp } } as any;
    const owner = { userId: 'alice', organizationId: 'acme', organizationKind: 'team' as const };
    expect(gateAudience(ctx, owner, 'proj-a', 'gate', ['carol']).map((r) => `${r.role}:${r.userId}`)).toEqual(['owner:alice', 'approver:carol']);
    expect(gateAudience(ctx, owner, 'proj-a', 'gate').map((r) => r.userId)).toEqual(['alice', 'bob', 'carol']);
    // Unreadable sidecar = owner only, never a throw.
    fs.writeFileSync(path.join(dir, 'activation.json'), '{not json');
    expect(gateAudience(ctx, owner, 'proj-a', 'gate', ['carol']).map((r) => r.userId)).toEqual(['alice']);
  });
});

describe('reassignGate — the one routing write, re-checked against a racing resolve', () => {
  let tmp: string;
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const OWNER = { userId: 'alice', organizationId: 'acme', organizationKind: 'team' as const };
  const HITL = { gateId: 'gate-r1-gate', cardId: 'pipe-gate-r1-gate', runId: 'r1', stepId: 'gate', pipelineId: 'refund', projectId: 'proj-a', owner: OWNER, onTimeout: 'reject', anchorJobId: 'job-1', prompt: 'ok?' };
  const RUN = (gate: Record<string, unknown> = {}) => ({
    runId: 'r1',
    pipelineId: 'refund',
    projectId: 'proj-a',
    firedBy: 'manual',
    fireEpoch: 1,
    status: 'awaiting_human',
    startedAt: '2026-09-16T00:00:00.000Z',
    defSnapshot: DEF,
    steps: [
      { stepId: 'calc', status: 'succeeded', jobId: 'job-1' },
      { stepId: 'gate', status: 'awaiting_gate', gate: { gateId: 'gate-r1-gate', cardId: 'pipe-gate-r1-gate', prompt: 'ok?', armedAt: '2026-09-16T00:00:01.000Z', assignees: ['bob'], assigneeSource: 'step', ...gate } },
    ],
  });

  function makeCtx(seed: Record<string, unknown>, opts: { resolveAfterMutate?: boolean } = {}) {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-reassign-'));
    const dir = path.join(tmp, 'acme', 'alice', '.ant', 'pipeline-activations', 'proj-a');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'activation.json'), JSON.stringify({ pipelineId: 'refund', pipelineScope: 'org', projectId: 'proj-a', activatedAt: '2026-09-16T00:00:00.000Z', approvers: { gate: ['bob', 'carol'] } }));
    const keys = new Map<string, string>([
      ['ant:pipe:run:r1', JSON.stringify(seed)],
      ['ant:pipe:hitl:gate-r1-gate', JSON.stringify(HITL)],
    ]);
    const cards: any[] = [];
    const notices: any[] = [];
    const ctx = {
      deps: {
        workspacesPath: tmp,
        scheduleQueue: { cancelDelayed: async () => {} },
        stateStore: {
          getKey: async (k: string) => keys.get(k) ?? null,
          setKeyWithTTL: async (k: string, v: string) => void keys.set(k, v),
          deleteKey: async (k: string) => void keys.delete(k),
          acquireLock: async () => true,
          releaseLock: async () => {
            // The resolve funnel wins the lock right after our mutation and takes the HITL down.
            if (opts.resolveAfterMutate) {
              const run = JSON.parse(keys.get('ant:pipe:run:r1')!);
              run.steps[1].gate.decision = 'approved';
              keys.set('ant:pipe:run:r1', JSON.stringify(run));
              keys.delete('ant:pipe:hitl:gate-r1-gate');
            }
          },
          refreshSlot: async () => true,
          publish: async () => {},
        },
        chatService: { appendChoicePresented: async (_p: string, _f: string, args: any) => void cards.push(args) },
      },
      notify: async (n: any) => void notices.push(n),
    } as any;
    return { ctx, keys, cards, notices };
  }

  it('writes the routing on the run record, re-presents the card under the SAME cardId, and re-fires the row to every candidate', async () => {
    const { ctx, keys, cards, notices } = makeCtx(RUN());
    expect(await reassignGate(ctx, 'gate-r1-gate', 'carol', 'alice')).toBe(true);
    const gate = JSON.parse(keys.get('ant:pipe:run:r1')!).steps[1].gate;
    expect(gate).toMatchObject({ assignees: ['carol'], assigneeSource: 'human', assignedBy: 'alice' });
    // The HITL record is untouched — it carries no routing.
    expect(JSON.parse(keys.get('ant:pipe:hitl:gate-r1-gate')!)).toEqual(HITL);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ cardId: 'pipe-gate-r1-gate', jobId: 'job-1', cardType: 'pipeline_approval', payload: { gateId: 'gate-r1-gate', assignees: ['carol'], pipelineName: 'refund' } });
    expect(notices.map((n) => `${n.kind}:${n.recipient.userId}`).sort()).toEqual(['approvalRequested:alice', 'approvalRequested:bob', 'approvalRequested:carol']);
    expect(notices[0].assignees).toEqual(['carol']);
  });

  it('null hands the gate back to everyone: no assignees on the record, the card, or the row', async () => {
    const { ctx, keys, cards, notices } = makeCtx(RUN());
    expect(await reassignGate(ctx, 'gate-r1-gate', null, 'bob')).toBe(true);
    const gate = JSON.parse(keys.get('ant:pipe:run:r1')!).steps[1].gate;
    expect(gate.assignees).toBeUndefined();
    expect(gate).toMatchObject({ assigneeSource: 'human', assignedBy: 'bob' });
    expect(cards[0].payload.assignees).toBeUndefined();
    expect(notices).toHaveLength(3);
    expect(notices.every((n) => n.assignees === undefined)).toBe(true);
  });

  it('a resolve that lands between the mutation and the fan-out wins: nothing is re-presented, no ghost row, false to the caller', async () => {
    const { ctx, keys, cards, notices } = makeCtx(RUN(), { resolveAfterMutate: true });
    expect(await reassignGate(ctx, 'gate-r1-gate', 'carol', 'alice')).toBe(false);
    expect(keys.has('ant:pipe:hitl:gate-r1-gate')).toBe(false);
    expect(cards).toEqual([]);
    expect(notices).toEqual([]);
  });

  it('an already-decided gate, a missing HITL record, or a tool gate is refused without a write', async () => {
    const decided = makeCtx(RUN({ decision: 'approved' }));
    expect(await reassignGate(decided.ctx, 'gate-r1-gate', 'carol', 'alice')).toBe(false);
    expect(decided.notices).toEqual([]);
    const gone = makeCtx(RUN());
    gone.keys.delete('ant:pipe:hitl:gate-r1-gate');
    expect(await reassignGate(gone.ctx, 'gate-r1-gate', 'carol', 'alice')).toBe(false);
    const tool = makeCtx(RUN());
    tool.keys.set('ant:pipe:hitl:gate-r1-gate', JSON.stringify({ ...HITL, kind: 'tool', tool: 'run_command' }));
    expect(await reassignGate(tool.ctx, 'gate-r1-gate', 'carol', 'alice')).toBe(false);
    expect(JSON.parse(tool.keys.get('ant:pipe:run:r1')!).steps[1].gate.assignees).toEqual(['bob']);
  });
});
