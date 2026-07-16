/**
 * flushTokenLoggers — token logging is fire-and-forget at call sites; the
 * job-runner terminal catch drains pending writes before teardown so a
 * first-node crash no longer leaves a 0-byte token debug file
 * (`tiny-counting-mocha` forensics gap).
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  getTokenLogger,
  clearTokenLogger,
  flushTokenLoggers,
} from '../src/core/utils/tokenLogger';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'token-flush-'));

afterEach(async () => {
  await clearTokenLogger('flush-job');
});

describe('flushTokenLoggers', () => {
  it('drains un-awaited log() writes so the file exists with the entry', async () => {
    const logger = getTokenLogger({ jobId: 'flush-job', featurePath: tmpRoot });
    // Fire-and-forget, exactly like logTokenUsageToFile call sites.
    void logger.log(
      { inputTokens: 10, outputTokens: 5 },
      { taskId: 'estimating', taskName: 'estimating', node: 'decompose', callIndex: 0 },
    );

    await flushTokenLoggers();

    const file = logger.getLogFilePath();
    expect(fs.existsSync(file)).toBe(true);
    const lines = fs.readFileSync(file, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]).node).toBe('decompose');
  });

  it('is a no-op with no live loggers', async () => {
    await clearTokenLogger('flush-job');
    await expect(flushTokenLoggers()).resolves.toBeUndefined();
  });
});
