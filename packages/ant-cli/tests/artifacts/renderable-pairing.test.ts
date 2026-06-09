import { describe, it, expect } from 'vitest';
import { createTaskQueue } from '../../src/agents/architect/graph/code/nodes/decompose/responseParser';

// ---------------------------------------------------------------------------
// `task.renderable` derivation (ui-pairing SSOT) in createTaskQueue.
//   - a `ui` task always renders;
//   - a `feature` task sharing a `ui` task's parallelGroup renders (paired);
//   - a headless feature (no paired ui in its group) does NOT render;
//   - non-feature/non-ui task types never render.
// This is the signal the SV session body-lifecycle gate keys on, so the
// derivation must be exact (not a taskType approximation).
// ---------------------------------------------------------------------------

function withVerification(tasks: any[]) {
  return [
    ...tasks,
    { id: 'final-verification', name: 'Final Verification', type: 'verification' as const, priority: 1000, description: 'Verify' },
  ] as any;
}

describe('renderable derivation — ui-pairing', () => {
  it('ui task is renderable; paired feature is renderable; headless feature and others are not', () => {
    const { taskQueue } = createTaskQueue(
      withVerification([
        { id: 'screen', name: 'Screen', type: 'feature', priority: 300, parallelGroup: 'g1' },
        { id: 'screen-ui', name: 'Screen UI', type: 'ui', priority: 301, parallelGroup: 'g1' },
        { id: 'hook', name: 'Data hook', type: 'feature', priority: 302, parallelGroup: 'g2' },
        { id: 'plain', name: 'Plain feature', type: 'feature', priority: 303 },
        { id: 'setup', name: 'Setup', type: 'setup', priority: 100 },
      ]),
      null, undefined, 3,
    );
    const get = (id: string) => taskQueue.getAll().find(t => t.id === id)! as any;

    expect(get('screen-ui').renderable).toBe(true); // ui always renders
    expect(get('screen').renderable).toBe(true); // paired with ui in g1
    // headless feature in a group with no ui → not renderable (field absent)
    expect(Object.prototype.hasOwnProperty.call(get('hook'), 'renderable')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(get('plain'), 'renderable')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(get('setup'), 'renderable')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(get('final-verification'), 'renderable')).toBe(false);
  });

  it('a feature sharing a group with a ui task in a DIFFERENT group is not renderable', () => {
    const { taskQueue } = createTaskQueue(
      withVerification([
        { id: 'feat', name: 'Feature', type: 'feature', priority: 300, parallelGroup: 'gA' },
        { id: 'other-ui', name: 'Other UI', type: 'ui', priority: 301, parallelGroup: 'gB' },
      ]),
      null, undefined, 3,
    );
    const get = (id: string) => taskQueue.getAll().find(t => t.id === id)! as any;
    expect(get('other-ui').renderable).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(get('feat'), 'renderable')).toBe(false);
  });
});
