/**
 * Superseded-session archive — the durability half of the dismiss contract
 * (icy-landing-glade RCA). A fresh takeover archives the old state so
 * `/resume` by jobId stays valid after later jobs overwrite the
 * last-writer-wins `session.state` slot.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  archiveSupersededState,
  findArchivedState,
  restoreArchivedState,
  deleteArchivedState,
} from '../../src/core/session/archive';

let featurePath: string;

const archivedDir = () => path.join(featurePath, 'sessions', 'architect', 'code.archived');

function writeLiveSession(state: Record<string, any>) {
  const dir = path.join(featurePath, 'sessions', 'architect');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'code.json'), JSON.stringify({ runs: [], state }, null, 2));
}

function readLiveSession(): any {
  return JSON.parse(fs.readFileSync(path.join(featurePath, 'sessions', 'architect', 'code.json'), 'utf-8'));
}

const interrupted = (jobId: string) => ({
  jobId,
  taskQueue: [{ id: 't1', name: `task of ${jobId}` }],
  interruption: { reason: 'user_stopped', message: 'm', timestamp: 't', canResume: true, dismissed: true },
});

beforeEach(() => {
  featurePath = fs.mkdtempSync(path.join(os.tmpdir(), 'session-archive-'));
});

afterEach(() => {
  fs.rmSync(featurePath, { recursive: true, force: true });
});

describe('archiveSupersededState / findArchivedState', () => {
  it('writes the envelope under sessions/{agent}/{jobType}.archived/{jobId}.json and finds it by jobId', async () => {
    expect(await archiveSupersededState(featurePath, 'architect', 'code', interrupted('old-job') as any)).toBe(true);

    const hit = await findArchivedState(featurePath, 'old-job');
    expect(hit).not.toBeNull();
    expect(hit!.agent).toBe('architect');
    expect(hit!.jobType).toBe('code');
    expect(hit!.state.jobId).toBe('old-job');
    expect((hit!.state as any).taskQueue).toHaveLength(1);
  });

  it('refuses a state without jobId', async () => {
    expect(await archiveSupersededState(featurePath, 'architect', 'code', {} as any)).toBe(false);
  });

  it('prunes to the newest 3 archives', async () => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      expect(await archiveSupersededState(featurePath, 'architect', 'code', interrupted(id) as any)).toBe(true);
    }
    const files = fs.readdirSync(archivedDir()).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(3);
  });

  it('returns null for an unknown jobId', async () => {
    expect(await findArchivedState(featurePath, 'nope')).toBeNull();
  });
});

describe('restoreArchivedState', () => {
  it('swaps the archived state back into the live slot and deletes the archive file', async () => {
    await archiveSupersededState(featurePath, 'architect', 'code', interrupted('old-job') as any);
    writeLiveSession({ jobId: 'new-job', taskQueue: [], completedTasks: ['x'] });

    const restored = await restoreArchivedState(featurePath, 'old-job');
    expect(restored).not.toBeNull();
    expect(readLiveSession().state.jobId).toBe('old-job');
    expect(await findArchivedState(featurePath, 'old-job')).toBeNull();
  });

  it('archives the live slot first when it still holds a DIFFERENT job\'s resumable work (symmetric swap)', async () => {
    await archiveSupersededState(featurePath, 'architect', 'code', interrupted('old-job') as any);
    writeLiveSession(interrupted('newer-job'));

    await restoreArchivedState(featurePath, 'old-job');

    expect(readLiveSession().state.jobId).toBe('old-job');
    const swapped = await findArchivedState(featurePath, 'newer-job');
    expect(swapped).not.toBeNull();
    expect((swapped!.state as any).taskQueue[0].name).toBe('task of newer-job');
  });

  it('returns null when the archive is missing or the live session is unreadable', async () => {
    expect(await restoreArchivedState(featurePath, 'ghost')).toBeNull();
    // Archive exists but no live session file to restore into:
    await archiveSupersededState(featurePath, 'architect', 'code', interrupted('old-job') as any);
    fs.rmSync(path.join(featurePath, 'sessions', 'architect', 'code.json'), { force: true });
    expect(await restoreArchivedState(featurePath, 'old-job')).toBeNull();
  });
});

describe('deleteArchivedState', () => {
  it('removes a single jobId\'s archive (trash-can delete path)', async () => {
    await archiveSupersededState(featurePath, 'architect', 'code', interrupted('old-job') as any);
    await deleteArchivedState(featurePath, 'old-job');
    expect(await findArchivedState(featurePath, 'old-job')).toBeNull();
  });
});
