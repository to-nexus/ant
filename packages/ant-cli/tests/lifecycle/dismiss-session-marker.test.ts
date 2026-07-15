/**
 * `setSessionDismissed` — single writer of the session-file
 * `interruption.dismissed` marker (sharp-choking-glove RCA).
 *
 * The sealed-record dismiss hole: a user-stopped job is finalized (Redis
 * sealed) at stop time, so the cancelled-card dismiss reaches `/job/dismiss`
 * with NO Redis record and previously returned without touching the session —
 * leaving the interrupted taskQueue armed to hijack the next chat turn.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { setSessionDismissed } from '../../src/periphery/adapters/http/routes/helpers/sessionCleanup';

let featurePath: string;

function writeDesignSession(state: Record<string, any>) {
  const dir = path.join(featurePath, 'sessions', 'architect');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'design.json'), JSON.stringify({ state }, null, 2));
}

function readDesignSession(): any {
  return JSON.parse(fs.readFileSync(path.join(featurePath, 'sessions', 'architect', 'design.json'), 'utf-8'));
}

beforeEach(() => {
  featurePath = fs.mkdtempSync(path.join(os.tmpdir(), 'dismiss-marker-'));
});

afterEach(() => {
  fs.rmSync(featurePath, { recursive: true, force: true });
});

describe('setSessionDismissed', () => {
  it('patches dismissed=true on the session matching jobId, leaving canResume untouched', async () => {
    writeDesignSession({
      jobId: 'sharp-choking-glove',
      taskQueue: [{ id: 't1' }],
      interruption: { reason: 'user_stopped', message: 'm', timestamp: 't', canResume: true },
    });

    const patched = await setSessionDismissed(undefined, featurePath, 'sharp-choking-glove', true);
    expect(patched).toBe(true);

    const session = readDesignSession();
    expect(session.state.interruption.dismissed).toBe(true);
    expect(session.state.interruption.canResume).toBe(true); // orthogonal axis untouched
    expect(session.state.interruption.metadata?.stoppedBy).toBe('dismiss');
    expect(session.state.taskQueue).toHaveLength(1); // queue stays as history
  });

  it('is idempotent', async () => {
    writeDesignSession({
      jobId: 'j1',
      interruption: { reason: 'user_stopped', message: 'm', timestamp: 't', canResume: true },
    });
    expect(await setSessionDismissed(undefined, featurePath, 'j1', true)).toBe(true);
    expect(await setSessionDismissed(undefined, featurePath, 'j1', true)).toBe(true);
    expect(readDesignSession().state.interruption.dismissed).toBe(true);
  });

  it('clears the marker on explicit resume (dismissed=false)', async () => {
    writeDesignSession({
      jobId: 'j1',
      interruption: { reason: 'user_stopped', message: 'm', timestamp: 't', canResume: true, dismissed: true },
    });
    expect(await setSessionDismissed(undefined, featurePath, 'j1', false)).toBe(true);
    expect(readDesignSession().state.interruption.dismissed).toBe(false);
  });

  it('no-ops (returns false) when no session matches the jobId or none has an interruption', async () => {
    writeDesignSession({ jobId: 'other-job', taskQueue: [{ id: 't1' }] });
    expect(await setSessionDismissed(undefined, featurePath, 'j1', true)).toBe(false);
    expect(await setSessionDismissed(undefined, featurePath, 'other-job', true)).toBe(false);
  });
});
