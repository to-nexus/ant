/**
 * The pre-paint card height dagre spaces ranks with. The rendered box is
 * height-auto, so these rows pin BEHAVIOUR (what makes a card taller), not
 * magic numbers that would relitigate every type-scale tweak.
 */

import { describe, it, expect } from 'vitest';
import { estimateNodeHeight } from '../../src/presentation/components/Pipelines/canvas/nodeMetrics';

describe('estimateNodeHeight', () => {
  it('a longer primary line wraps to a taller card', () => {
    const short = estimateNodeHeight({ primary: 'sync' });
    const long = estimateNodeHeight({ primary: 'a'.repeat(120) });
    expect(long).toBeGreaterThan(short);
  });

  it('never returns less than a one-line card, even for an empty primary', () => {
    expect(estimateNodeHeight({ primary: '' })).toBe(estimateNodeHeight({ primary: 'x' }));
    expect(estimateNodeHeight({ primary: '' })).toBeGreaterThan(0);
  });

  it('the caption is a fixed contribution — it is single-line by construction', () => {
    const base = estimateNodeHeight({ primary: 'sync' });
    const withShort = estimateNodeHeight({ primary: 'sync', caption: 'a · b' });
    const withLong = estimateNodeHeight({ primary: 'sync', caption: 'a'.repeat(200) });
    expect(withShort).toBeGreaterThan(base);
    expect(withLong).toBe(withShort);
  });

  it('a live status never changes the height — the row is reserved, so a run appearing cannot re-fit the canvas', () => {
    const idle = estimateNodeHeight({ primary: 'sync', kind: 'step' });
    expect(estimateNodeHeight({ primary: 'sync', kind: 'step', status: 'running' } as any)).toBe(idle);
    expect(estimateNodeHeight({ primary: 'sync', kind: 'gate', status: 'awaiting_gate' } as any)).toBe(idle);
    expect(idle).toBeGreaterThan(estimateNodeHeight({ primary: 'sync', kind: 'trigger' }));
  });

  it('step and gate cards reserve the live-run chip row even with no run at the step; the trigger does not', () => {
    const trigger = estimateNodeHeight({ primary: 'sync', kind: 'trigger' });
    const step = estimateNodeHeight({ primary: 'sync', kind: 'step' });
    const gate = estimateNodeHeight({ primary: 'sync', kind: 'gate' });
    expect(step).toBeGreaterThan(trigger);
    expect(gate).toBe(step);
    // Absent kind = step (the reservation is the default, so a run arriving never re-fits the canvas).
    expect(estimateNodeHeight({ primary: 'sync' })).toBe(step);
  });

  it('is monotonic in primary length', () => {
    const heights = [10, 40, 80, 160].map((n) => estimateNodeHeight({ primary: 'a'.repeat(n) }));
    expect(heights).toEqual([...heights].sort((a, b) => a - b));
  });
});
