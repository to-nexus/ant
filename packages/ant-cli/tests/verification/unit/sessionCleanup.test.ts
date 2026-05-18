import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  sealJobRedisState,
  scrubJobDebugArtifacts,
} from '../../../src/periphery/adapters/http/routes/helpers/sessionCleanup';

describe('sessionCleanup debug artifact policy', () => {
  let featurePath: string;
  const jobId = 'clean-handing-dream';

  beforeEach(async () => {
    featurePath = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-session-cleanup-'));
    await fs.mkdir(path.join(featurePath, 'sessions', 'architect', 'debug', 'logs'), { recursive: true });
    await fs.mkdir(path.join(featurePath, 'sessions', 'architect', 'debug', 'tokens'), { recursive: true });

    await fs.writeFile(
      path.join(featurePath, 'sessions', 'architect', 'debug', 'logs', `log-${jobId}.json`),
      '{"events":[]}',
      'utf-8',
    );
    await fs.writeFile(
      path.join(featurePath, 'sessions', 'architect', 'debug', 'tokens', `token-${jobId}.json`),
      '{"tokens":[]}',
      'utf-8',
    );
    await fs.writeFile(
      path.join(featurePath, 'sessions', 'architect', 'debug', 'logs', 'log-another-job.json'),
      '{"events":[]}',
      'utf-8',
    );
  });

  afterEach(async () => {
    await fs.rm(featurePath, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('sealJobRedisState seals redis/in-memory state but keeps debug files on disk', async () => {
    const stateStore = {
      deleteJobStatus: vi.fn().mockResolvedValue(undefined),
      deleteTaskQueue: vi.fn().mockResolvedValue(undefined),
      deleteWorkflowState: vi.fn().mockResolvedValue(undefined),
      clearUserStopped: vi.fn().mockResolvedValue(undefined),
      deleteJobMapping: vi.fn().mockResolvedValue(undefined),
      deleteKillReason: vi.fn().mockResolvedValue(undefined),
    } as any;
    const kanbanService = {
      clearJobMemory: vi.fn().mockResolvedValue(undefined),
    } as any;

    await sealJobRedisState(stateStore, kanbanService, jobId);

    expect(stateStore.deleteJobStatus).toHaveBeenCalledWith(jobId);
    expect(kanbanService.clearJobMemory).toHaveBeenCalledWith(jobId);

    await expect(
      fs.access(path.join(featurePath, 'sessions', 'architect', 'debug', 'logs', `log-${jobId}.json`)),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(featurePath, 'sessions', 'architect', 'debug', 'tokens', `token-${jobId}.json`)),
    ).resolves.toBeUndefined();
  });

  it('scrubJobDebugArtifacts removes only files tied to the target jobId', async () => {
    await scrubJobDebugArtifacts(featurePath, 'design', jobId);

    await expect(
      fs.access(path.join(featurePath, 'sessions', 'architect', 'debug', 'logs', `log-${jobId}.json`)),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(featurePath, 'sessions', 'architect', 'debug', 'tokens', `token-${jobId}.json`)),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(featurePath, 'sessions', 'architect', 'debug', 'logs', 'log-another-job.json')),
    ).resolves.toBeUndefined();
  });
});
