/**
 * Planner graph ↔ satellite-metadata coverage guard.
 *
 * The plan-job workflow diagram is data-driven: node ids + edges are read out of
 * the compiled `buildPlanGraph()` at runtime, so topology auto-reflects any node
 * change. But three hand-authored tables keyed by node id must be kept in sync by
 * hand — `ACTOR_MAPPINGS` (description + actor links) and the `estimatingLabels`
 * phase-label map. When the monolithic `generate` node was split into
 * `plan → execute`, those tables were not updated: `generate` was dead, the new
 * nodes rendered bare, and the execute phase label resolved to a bogus `'n'`.
 *
 * This test names the exact missing entry instead of letting it rot silently.
 */

import { describe, it, expect } from 'vitest';
import {
  GraphMetadataService,
  ACTOR_MAPPINGS,
} from '../../src/periphery/adapters/http/services/GraphMetadataService';
import { resolveNodePhaseLabel } from '../../src/agents/common/graph/timing/estimatingLabels';

describe('planner:plan graph ↔ ACTOR_MAPPINGS coverage', () => {
  const svc = new GraphMetadataService();

  it('every compiled planner node has an ACTOR_MAPPINGS entry with a description', async () => {
    const meta = await svc.extractGraphMetadata('planner', 'plan');
    expect(meta.nodes.length).toBeGreaterThan(0);
    for (const node of meta.nodes) {
      expect(
        ACTOR_MAPPINGS[`planner:plan:${node.id}`],
        `graph node '${node.id}' has no planner:plan:${node.id} ACTOR_MAPPINGS entry`,
      ).toBeDefined();
      expect(
        node.description,
        `graph node '${node.id}' renders with no description`,
      ).toBeTruthy();
    }
  });

  it('no planner:plan:* mapping points at a node absent from the graph (catches dead `generate`)', async () => {
    const meta = await svc.extractGraphMetadata('planner', 'plan');
    const nodeIds = new Set(meta.nodes.map((n) => n.id));
    const planKeys = Object.keys(ACTOR_MAPPINGS).filter((k) => k.startsWith('planner:plan:'));
    for (const key of planKeys) {
      const nodeId = key.slice('planner:plan:'.length);
      expect(
        nodeIds.has(nodeId),
        `stale ACTOR_MAPPINGS key '${key}' references a non-existent graph node`,
      ).toBe(true);
    }
  });
});

describe('planner phase labels resolve (catches `n`-style typos / retired ids)', () => {
  // The labelIds the planner graph wires: plan node uses the shared 'plan' label,
  // execute node uses the planner-specific 'planExecute' (graph.ts withPhaseTracking).
  it.each(['plan', 'planExecute'])('label id %s resolves to a real string', (labelId) => {
    const en = resolveNodePhaseLabel(labelId, 'en');
    const ko = resolveNodePhaseLabel(labelId, 'ko');
    // Unknown ids fall back to the id itself — that is the failure we guard against.
    expect(en, `phase label '${labelId}' is unresolved (falls back to the id)`).not.toBe(labelId);
    expect(ko).not.toBe(labelId);
  });

  it('the retired planner `generate` / `write` label ids are gone', () => {
    expect(resolveNodePhaseLabel('generate', 'en')).toBe('generate');
    expect(resolveNodePhaseLabel('write', 'en')).toBe('write');
  });
});
