/**
 * F3.1 — extractDependencies invariant test.
 *
 * Pins the regex catalog (PRD/GDD §X plus the stable identifier
 * prefixes from the plan-density-restoration work) and the `hasPrdRef`
 * flag — both are load-bearing for the rev-plan → design sync
 * pipeline.
 */

import { describe, it, expect } from 'vitest';
import {
  extractDependencies,
  EXTRACTOR_VERSION,
  tasksWithoutPlanRef,
  type DesignSessionCheckpointLike,
} from '../../src/core/refine/extractDependencies';
import type { DesignTask } from '../../src/agents/architect/types/task';

function task(
  id: string,
  description: string,
  extra: Partial<DesignTask> = {},
): DesignTask {
  return {
    id,
    name: id,
    type: 'doc',
    priority: 100,
    description,
    completed: false,
    ...extra,
  } as DesignTask;
}

const SERVICE_RAC = {
  refs: ['inputs/sources/prd.md'],
  context: [],
} as DesignSessionCheckpointLike['resolvedAction'] as any;

const GAME_RAC = {
  refs: ['inputs/sources/gdd.md'],
  context: [],
} as DesignSessionCheckpointLike['resolvedAction'] as any;

const NO_PLAN_REF_RAC = {
  refs: ['outputs/design/spec/spec-foo.md'],
  context: ['inputs/sources/prd.md'],
} as DesignSessionCheckpointLike['resolvedAction'] as any;

describe('extractDependencies — service-axis identifiers', () => {
  it('pulls PRD §X / SC- / FL- / FR- / CP- / RB- from descriptions', () => {
    const checkpoint: DesignSessionCheckpointLike = {
      resolvedAction: SERVICE_RAC,
      taskQueue: [
        task('be-1', 'Implements PRD §10 / RB-Seller and PRD §11 (payment dependency)'),
        task('fe-1', 'Implements PRD §6 / SC-ProductDetail; references CP-Pagination and FR-12'),
        task('fl-1', 'Covers FL-Buy from PRD §4 Core Flows.'),
      ],
    };
    const deps = extractDependencies(checkpoint);
    const byId = Object.fromEntries(deps.map(d => [d.taskId, d]));
    expect(byId['be-1'].citedSections).toEqual(
      expect.arrayContaining(['PRD §10', 'PRD §11', 'RB-Seller']),
    );
    expect(byId['fe-1'].citedSections).toEqual(
      expect.arrayContaining(['PRD §6', 'SC-ProductDetail', 'CP-Pagination', 'FR-12']),
    );
    expect(byId['fl-1'].citedSections).toEqual(
      expect.arrayContaining(['PRD §4', 'FL-Buy']),
    );
  });
});

describe('extractDependencies — game-axis identifiers', () => {
  it('pulls GDD §X / CL- / MC- / EN- / LV- / RW- / GM- / MP- from descriptions', () => {
    const checkpoint: DesignSessionCheckpointLike = {
      resolvedAction: GAME_RAC,
      taskQueue: [
        task('art-1', 'Implements GDD §8 / EN-Hero and EN-Boss; lives under LV-Castle'),
        task('art-2', 'Implements GDD §4 / MC-Combat; rewards via RW-Score'),
        task('mode-1', 'Drives GM-CoOp and persists MP-Hero-Unlock per GDD §11'),
        task('loop-1', 'Coreloop: CL-Spawn → CL-Combat → CL-Reward (GDD §2)'),
      ],
    };
    const deps = extractDependencies(checkpoint);
    const byId = Object.fromEntries(deps.map(d => [d.taskId, d]));
    expect(byId['art-1'].citedSections).toEqual(
      expect.arrayContaining(['GDD §8', 'EN-Hero', 'EN-Boss', 'LV-Castle']),
    );
    expect(byId['art-2'].citedSections).toEqual(
      expect.arrayContaining(['GDD §4', 'MC-Combat', 'RW-Score']),
    );
    expect(byId['mode-1'].citedSections).toEqual(
      expect.arrayContaining(['GM-CoOp', 'MP-Hero-Unlock', 'GDD §11']),
    );
    expect(byId['loop-1'].citedSections).toEqual(
      expect.arrayContaining(['CL-Spawn', 'CL-Combat', 'CL-Reward', 'GDD §2']),
    );
  });
});

describe('extractDependencies — assignedSections feed and dedup', () => {
  it('grep also runs on assignedSections, dedups identical citations', () => {
    const checkpoint: DesignSessionCheckpointLike = {
      resolvedAction: SERVICE_RAC,
      taskQueue: [
        task('shared-1', 'PRD §6 / SC-Search appears in description.', {
          assignedSections: ['§ Routing', 'PRD §6 / SC-Search'],
        }),
      ],
    };
    const deps = extractDependencies(checkpoint);
    expect(deps[0].citedSections.filter(s => s === 'PRD §6')).toHaveLength(1);
    expect(deps[0].citedSections).toContain('SC-Search');
  });
});

describe('extractDependencies — hasPrdRef provenance', () => {
  it('hasPrdRef=true when RAC.refs contains the canonical plan filename', () => {
    const checkpoint: DesignSessionCheckpointLike = {
      resolvedAction: SERVICE_RAC,
      taskQueue: [task('a', 'Implements PRD §6 / SC-Search')],
    };
    expect(extractDependencies(checkpoint)[0].hasPrdRef).toBe(true);
  });

  it('hasPrdRef=false when plan doc only sits under context (demoted)', () => {
    const checkpoint: DesignSessionCheckpointLike = {
      resolvedAction: NO_PLAN_REF_RAC,
      taskQueue: [task('a', 'Implements PRD §6 / SC-Search')],
    };
    expect(extractDependencies(checkpoint)[0].hasPrdRef).toBe(false);
  });

  it('tasksWithoutPlanRef filters down to the unscannable subset', () => {
    const deps = extractDependencies({
      resolvedAction: NO_PLAN_REF_RAC,
      taskQueue: [
        task('a', 'PRD §6'),
        task('b', 'PRD §7'),
      ],
    });
    expect(tasksWithoutPlanRef(deps)).toHaveLength(2);
  });
});

describe('extractDependencies — versioning + edge cases', () => {
  it('exports an extractor version (caller cache invalidation key)', () => {
    expect(EXTRACTOR_VERSION).toMatch(/^\d+$/);
  });

  it('empty checkpoint returns []', () => {
    expect(extractDependencies({})).toEqual([]);
  });

  it('whitespace around § normalises (PRD § 6 ≡ PRD §6)', () => {
    const checkpoint: DesignSessionCheckpointLike = {
      resolvedAction: SERVICE_RAC,
      taskQueue: [task('a', 'Cites PRD § 6 only.')],
    };
    expect(extractDependencies(checkpoint)[0].citedSections).toContain('PRD §6');
  });
});
