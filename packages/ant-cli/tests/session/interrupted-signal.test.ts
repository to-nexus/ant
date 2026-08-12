/**
 * `deriveInterruptedJobSignal` — the single derivation of "which interrupted
 * job exists on this feature" for reasoning consumers (triage prompt block,
 * inline-ask dispatch). Built on `deriveResumableState` so it cannot drift
 * from the runner/route resumable verdict.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  deriveInterruptedJobSignal,
  deriveInlineAskWorkRouting,
  type InterruptedJobSignal,
} from '../../src/core/session/interruptedSignal';

let featurePath: string;

function writeSession(agent: string, job: string, data: Record<string, any>) {
  const dir = path.join(featurePath, 'sessions', agent);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${job}.json`), JSON.stringify(data, null, 2));
}

beforeEach(() => {
  featurePath = fs.mkdtempSync(path.join(os.tmpdir(), 'interrupted-signal-'));
});

afterEach(() => {
  fs.rmSync(featurePath, { recursive: true, force: true });
});

describe('deriveInterruptedJobSignal', () => {
  it('surfaces an explicitly interrupted session with task names and dismissed flag', () => {
    writeSession('architect', 'code', {
      state: {
        jobId: 'icy-landing-glade',
        taskQueue: [{ id: 't1', name: 'Archetype engine' }, { id: 't2', name: 'Modifier domain' }],
        interruption: { reason: 'user_stopped', message: 'm', timestamp: 't', canResume: true, dismissed: true },
      },
    });

    const signal = deriveInterruptedJobSignal(featurePath);
    expect(signal).not.toBeNull();
    expect(signal!.jobId).toBe('icy-landing-glade');
    expect(signal!.jobType).toBe('code');
    expect(signal!.agent).toBe('architect');
    expect(signal!.canResume).toBe(true);
    expect(signal!.dismissed).toBe(true);
    expect(signal!.taskNames).toEqual(['Archetype engine', 'Modifier domain']);
  });

  it('surfaces a synthesized-crash session (leftover work, no interruption marker)', () => {
    // The old orchestrator scan hard-required state.interruption and missed these.
    writeSession('architect', 'code', {
      state: { jobId: 'j1', taskQueue: [{ id: 't1', name: 'T' }] },
    });
    const signal = deriveInterruptedJobSignal(featurePath);
    expect(signal).not.toBeNull();
    expect(signal!.dismissed).toBe(false);
    expect(signal!.canResume).toBe(true);
  });

  it('reports canResume=false for non-mid-graph job types (plan) but still surfaces the work', () => {
    writeSession('planner', 'plan', {
      state: { jobId: 'p1', taskQueue: [{ id: 't1', name: 'T' }] },
    });
    const signal = deriveInterruptedJobSignal(featurePath);
    expect(signal).not.toBeNull();
    expect(signal!.canResume).toBe(false);
  });

  it('returns null when no session holds resumable work (drained queue, completed)', () => {
    writeSession('architect', 'code', {
      state: {
        jobId: 'j1',
        taskQueue: [],
        completedTasks: ['t1'],
        jobTiming: { completedAt: '2026-08-01T00:00:00Z' },
      },
    });
    expect(deriveInterruptedJobSignal(featurePath)).toBeNull();
  });

  it('skips the caller-owned session via excludeJobId (a job must not report itself)', () => {
    writeSession('architect', 'code', {
      state: { jobId: 'self-job', taskQueue: [{ id: 't1', name: 'T' }] },
    });
    expect(deriveInterruptedJobSignal(featurePath, { excludeJobId: 'self-job' })).toBeNull();
  });

  it('falls back to the matching run kanbanSnapshot when queue arrays are drained', () => {
    writeSession('architect', 'code', {
      runs: [
        {
          runId: 1,
          jobId: 'j1',
          kanbanSnapshot: {
            jobId: 'j1',
            todo: [{ id: 't2', name: 'From snapshot' }],
            inProgress: [{ id: 't1', name: 'In flight' }],
          },
        },
      ],
      state: {
        jobId: 'j1',
        taskQueue: [],
        currentTask: { id: 't1' }, // resumable work, but no name on it
        interruption: { reason: 'user_stopped', message: 'm', timestamp: 't', canResume: true },
      },
    });
    const signal = deriveInterruptedJobSignal(featurePath);
    expect(signal).not.toBeNull();
    expect(signal!.taskNames).toEqual(['In flight', 'From snapshot']);
  });

  it('returns null on an empty feature', () => {
    expect(deriveInterruptedJobSignal(featurePath)).toBeNull();
  });
});

describe('deriveInlineAskWorkRouting — dispatch policy table', () => {
  const signal = (over: Partial<InterruptedJobSignal> = {}): InterruptedJobSignal => ({
    jobId: 'j1',
    jobType: 'code' as any,
    agent: 'architect',
    canResume: true,
    dismissed: false,
    taskNames: [],
    ...over,
  });

  it('resume request + canResume → resume-request with target fields', () => {
    expect(deriveInlineAskWorkRouting(true, signal({ dismissed: true }), 'resume it')).toEqual({
      action: 'resume-request',
      resumeJobId: 'j1',
      resumeJobType: 'code',
      resumeDismissed: true,
      originalDirective: 'resume it',
    });
  });

  it('resume request against a non-resumable session is IGNORED (deterministic gate)', () => {
    const routing = deriveInlineAskWorkRouting(true, signal({ canResume: false, dismissed: true }), 'x');
    expect(routing.action).toBe('newJob');
  });

  it('resume request with no interrupted session at all → no action (LLM cannot mint a resume)', () => {
    expect(deriveInlineAskWorkRouting(true, null, 'x')).toEqual({});
  });

  it('dismissed && work && NOT a resume request MUST be newJob, never undefined (silent-continue breach guard)', () => {
    expect(deriveInlineAskWorkRouting(false, signal({ dismissed: true }), 'x')).toEqual({ action: 'newJob' });
  });

  it('live undismissed interruption keeps the legacy continue path (no action)', () => {
    expect(deriveInlineAskWorkRouting(false, signal(), 'x')).toEqual({});
  });
});
