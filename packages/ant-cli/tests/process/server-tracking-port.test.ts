import { describe, expect, it } from 'vitest';

import { recordServerStarted } from '../../src/agents/architect/graph/code/nodes/tool/utils/serverTracking';

describe('recordServerStarted — port propagation', () => {
  it('persists the resolved port into the runningServers ledger', () => {
    const state: any = {};
    recordServerStarted(state, {
      type: 'serverStarted',
      pid: 4242,
      command: 'pnpm dev',
      workingDir: '/tmp',
      port: 3001,
    });
    expect(state.runningServers).toHaveLength(1);
    expect(state.runningServers[0]).toMatchObject({ pid: 4242, port: 3001 });
    expect(typeof state.runningServers[0].startedAt).toBe('number');
  });

  it('tolerates a missing port (undefined)', () => {
    const state: any = {};
    recordServerStarted(state, { type: 'serverStarted', pid: 7, command: 'go run .', workingDir: '/tmp' } as any);
    expect(state.runningServers[0].port).toBeUndefined();
  });
});
