import { describe, expect, it } from 'vitest';

import { allowsPersistentProcesses } from '../../src/agents/architect/graph/code/tasks/_shared/verify/persistentProcessGate';

const s = (o: any) => o as any;

describe('allowsPersistentProcesses', () => {
  it('error task → true', () => {
    expect(allowsPersistentProcesses(s({ currentTask: { type: 'error' } }))).toBe(true);
  });

  it('runtime-error directive → true (even for a verification task)', () => {
    expect(
      allowsPersistentProcesses(
        s({
          currentTask: { type: 'verification' },
          directive: 'When I open the page it throws TypeError: cannot read properties of undefined',
        }),
      ),
    ).toBe(true);
  });

  it('prior error sub-tasks present → true', () => {
    expect(
      allowsPersistentProcesses(
        s({
          currentTask: { type: 'verification' },
          completedTasksDetails: [{ type: 'error', name: 'fix', description: 'd' }],
        }),
      ),
    ).toBe(true);
  });

  it('plain feature task, no directive, no prior errors → false', () => {
    expect(
      allowsPersistentProcesses(s({ currentTask: { type: 'feature' }, completedTasksDetails: [] })),
    ).toBe(false);
  });

  it('verification task in verify-mode (RCA cycle, _verifyEntered) → true', () => {
    expect(
      allowsPersistentProcesses(s({ currentTask: { type: 'verification' }, _verifyEntered: true })),
    ).toBe(true);
  });

  it('self-verify task in reverify (_verifyEntered) → true', () => {
    expect(
      allowsPersistentProcesses(
        s({ currentTask: { type: 'feature', selfVerifyOnDone: true }, _verifyEntered: true }),
      ),
    ).toBe(true);
  });

  it('self-verify task in apply phase (_verifyEntered false) → false', () => {
    expect(
      allowsPersistentProcesses(
        s({ currentTask: { type: 'feature', selfVerifyOnDone: true }, completedTasksDetails: [] }),
      ),
    ).toBe(false);
  });
});
