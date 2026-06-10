/**
 * Idle-sleep assertion dispatch — guards the per-OS power-assertion contract.
 *
 * The assertion keeps the host awake while a job-runner child lives so the
 * worker doesn't tear the job down with `system_sleep` on idle suspend. This
 * locks: macOS → `caffeinate -i -w <pid>`, Windows → PowerShell
 * SetThreadExecutionState watched by Wait-Process, everything else → no-op,
 * and that it NEVER throws into the job-spawn path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const spawnMock = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: any[]) => spawnMock(...args),
}));

import { holdIdleSleepAssertion } from '../../src/infrastructure/worker/sleepAssertion';

const realPlatform = process.platform;
function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

describe('holdIdleSleepAssertion', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockReturnValue({ on: vi.fn(), kill: vi.fn() });
  });

  afterEach(() => {
    setPlatform(realPlatform);
  });

  it('macOS: spawns caffeinate tied to the pid', () => {
    setPlatform('darwin');
    const guard = holdIdleSleepAssertion(123);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledWith('caffeinate', ['-i', '-w', '123'], { stdio: 'ignore' });
    expect(guard).toBeDefined();
  });

  it('Windows: spawns powershell SetThreadExecutionState watching the pid', () => {
    setPlatform('win32');
    holdIdleSleepAssertion(123);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = spawnMock.mock.calls[0];
    expect(cmd).toBe('powershell');
    const script = (args as string[]).join(' ');
    expect(script).toContain('SetThreadExecutionState');
    expect(script).toContain('0x80000001');
    expect(script).toContain('Wait-Process -Id 123');
  });

  it('Linux (and other): no-op, never spawns', () => {
    setPlatform('linux');
    const guard = holdIdleSleepAssertion(123);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(guard).toBeUndefined();
  });

  it('swallows a spawn failure and returns undefined', () => {
    setPlatform('darwin');
    spawnMock.mockImplementation(() => {
      throw new Error('caffeinate not found');
    });
    expect(() => holdIdleSleepAssertion(123)).not.toThrow();
    expect(holdIdleSleepAssertion(123)).toBeUndefined();
  });
});
