/**
 * Locks the `TASK_PRIORITY` window map invariants — the normalized (type, band)
 * priority SSOT. These guards prevent a future edit from re-introducing an
 * overlap / gap / unbounded window, and bound the lane-mode offset so a
 * batchSplit child can never cross out of its parent's window.
 */

import { describe, it, expect } from 'vitest';
import {
  TASK_PRIORITY,
  MAX_LANE_OFFSET,
  windowFor,
  basePriorityFor,
} from '../../src/agents/architect/graph/code/state';

// Every (type, band) window in ascending queue order.
const ORDERED: ReadonlyArray<{ label: string; window: { min: number; max: number } }> = [
  { label: 'setup.root', window: TASK_PRIORITY.setup.root },
  { label: 'setup.default', window: TASK_PRIORITY.setup.default },
  { label: 'design-system', window: TASK_PRIORITY['design-system'].default },
  { label: 'feature.foundation', window: TASK_PRIORITY.feature.foundation },
  { label: 'feature.platform', window: TASK_PRIORITY.feature.platform },
  { label: 'feature.default', window: TASK_PRIORITY.feature.default },
  { label: 'feature.integration', window: TASK_PRIORITY.feature.integration },
  { label: 'ui', window: TASK_PRIORITY.ui.default },
  { label: 'seam', window: TASK_PRIORITY.seam.default },
  { label: 'test-code', window: TASK_PRIORITY['test-code'].default },
  { label: 'doc', window: TASK_PRIORITY.doc.default },
  { label: 'error', window: TASK_PRIORITY.error.default },
  { label: 'verification', window: TASK_PRIORITY.verification.default },
];

describe('TASK_PRIORITY window map invariants', () => {
  it('every window has min <= max', () => {
    for (const { label, window } of ORDERED) {
      expect(window.min, `${label}.min <= max`).toBeLessThanOrEqual(window.max);
    }
  });

  it('windows are strictly ordered and non-overlapping (ascending queue order)', () => {
    for (let i = 1; i < ORDERED.length; i++) {
      const prev = ORDERED[i - 1];
      const cur = ORDERED[i];
      expect(
        prev.window.max,
        `${prev.label} (≤${prev.window.max}) must end before ${cur.label} (≥${cur.window.min})`,
      ).toBeLessThan(cur.window.min);
    }
  });

  it('MAX_LANE_OFFSET cannot push a lane child out of any lane-fanning window', () => {
    // Lane-mode children get `parentPriority + offset` with the parent at its
    // window base, so the offset must stay <= (max - min) for EVERY window a
    // lane parent can occupy (feature bands / ordinary feature / ui / seam).
    const widthOf = (w: { min: number; max: number }) => w.max - w.min;
    const laneFanning = [
      TASK_PRIORITY.feature.foundation,
      TASK_PRIORITY.feature.platform,
      TASK_PRIORITY.feature.default,
      TASK_PRIORITY.feature.integration,
      TASK_PRIORITY.ui.default,
      TASK_PRIORITY.seam.default,
    ];
    for (const w of laneFanning) {
      expect(MAX_LANE_OFFSET).toBeLessThanOrEqual(widthOf(w));
    }
  });

  it('verification is a single-point window (final task)', () => {
    expect(TASK_PRIORITY.verification.default.min).toBe(
      TASK_PRIORITY.verification.default.max,
    );
  });
});

describe('windowFor / basePriorityFor helpers', () => {
  it('band-less band resolves to the type default window', () => {
    expect(windowFor('feature')).toEqual(TASK_PRIORITY.feature.default);
    expect(windowFor('setup')).toEqual(TASK_PRIORITY.setup.default);
  });

  it('feature bands resolve to their sub-windows', () => {
    expect(windowFor('feature', 'foundation')).toEqual(TASK_PRIORITY.feature.foundation);
    expect(windowFor('feature', 'integration')).toEqual(TASK_PRIORITY.feature.integration);
  });

  it('an unknown / band-less type (explain) falls back to the ordinary feature window', () => {
    expect(windowFor('explain' as any)).toEqual(TASK_PRIORITY.feature.default);
  });

  it('basePriorityFor returns the (type, band) window base', () => {
    expect(basePriorityFor('feature')).toBe(300);
    expect(basePriorityFor('ui')).toBe(650);
    expect(basePriorityFor('verification')).toBe(1000);
    expect(basePriorityFor('setup', 'root')).toBe(100);
  });
});
