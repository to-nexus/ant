import { describe, it, expect } from 'vitest';
import { recordServerStarted } from '../../src/agents/architect/graph/code/nodes/tool/utils/serverTracking';
import type { ArchitectGraphState } from '../../src/agents/architect/graph/code/state';

/**
 * `recordServerStarted` is the SSOT for the verification-leak fix:
 *
 * Background: when an LLM verification step runs `npx next dev` (or any
 * other long-running pattern) with `keep_running:true`, the
 * `run_command` handler emits a `serverStarted` side effect carrying the
 * detached child's PID + cwd. The tool node's `afterExecution` switch
 * used to drop this effect on the floor — `state.runningServers` stayed
 * empty, the learn cleanup loop ran against an empty array, and the
 * detached `next dev` survived the task. The next preview restart then
 * tripped "Another next dev server is already running".
 *
 * These tests pin the helper's behaviour so the regression cannot
 * silently come back via a future refactor.
 */

function emptyState(): ArchitectGraphState {
  return {} as unknown as ArchitectGraphState;
}

describe('recordServerStarted', () => {
  it('lazily initialises runningServers and records the entry', () => {
    const state = emptyState();
    recordServerStarted(state, {
      type: 'serverStarted',
      pid: 12345,
      command: 'npx next dev',
      workingDir: '/repo/apps/hub',
    });
    expect(state.runningServers).toBeDefined();
    expect(state.runningServers!.length).toBe(1);
    const entry = state.runningServers![0];
    expect(entry.pid).toBe(12345);
    expect(entry.command).toBe('npx next dev');
    expect(entry.workingDir).toBe('/repo/apps/hub');
    expect(typeof entry.startedAt).toBe('number');
  });

  it('appends additional entries without clobbering existing ones', () => {
    const state = emptyState();
    recordServerStarted(state, {
      type: 'serverStarted', pid: 1, command: 'a', workingDir: '/a',
    });
    recordServerStarted(state, {
      type: 'serverStarted', pid: 2, command: 'b', workingDir: '/b',
    });
    expect(state.runningServers!.map(s => s.pid)).toEqual([1, 2]);
  });

  it('dedupes by PID — second call for the same PID is a no-op', () => {
    const state = emptyState();
    recordServerStarted(state, {
      type: 'serverStarted', pid: 7, command: 'first', workingDir: '/a',
    });
    recordServerStarted(state, {
      type: 'serverStarted', pid: 7, command: 'second-attempt', workingDir: '/b',
    });
    expect(state.runningServers!.length).toBe(1);
    // The original entry wins — replaying must NOT overwrite the cwd
    // (the killer needs the original cwd to clean the framework lock).
    expect(state.runningServers![0].command).toBe('first');
    expect(state.runningServers![0].workingDir).toBe('/a');
  });

  it('drops invalid PIDs (zero, negative, NaN, non-number)', () => {
    const state = emptyState();
    for (const pid of [0, -1, NaN, undefined as any, null as any, '12345' as any]) {
      recordServerStarted(state, {
        type: 'serverStarted', pid, command: 'x', workingDir: '/y',
      } as any);
    }
    // Either runningServers stayed undefined or stayed empty — both are
    // acceptable signals of "nothing was recorded".
    expect(state.runningServers === undefined || state.runningServers.length === 0).toBe(true);
  });
});
