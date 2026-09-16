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
import { gateAudience } from '../../src/infrastructure/scheduling/pipelineRun/gates';

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
  let tmp: string;
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('request leg narrows to the assignee; the resolved leg (no assignees) reaches the whole roster', () => {
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
