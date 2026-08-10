/**
 * Universal graph realtime-registration axis — every node the universal
 * graph wires must be registered on the surfaces the FE reads:
 *
 *   1. `ACTOR_MAPPINGS['universal:universal:<node>']` — workflow panel
 *      description/actors (a missing row renders a bare, undocumented node).
 *   2. Phase-label map (`resolveNodePhaseLabel`) for every phase id the
 *      graph passes to `withPhaseTracking` — a missing entry leaks the raw
 *      phase id into the token-gauge tooltip.
 *
 * Table-driven gate truth: introspects the COMPILED graph, so adding a node
 * without registering it fails here — no prose pinned.
 */

import { describe, it, expect } from 'vitest';
import { buildUniversalGraph } from '../../src/agents/universal/graph/graph';
import { ACTOR_MAPPINGS } from '../../src/periphery/adapters/http/services/GraphMetadataService';
import { resolveNodePhaseLabel } from '../../src/agents/common/graph/timing/estimatingLabels';

function compiledNodeIds(): string[] {
  const compiled: any = buildUniversalGraph();
  const nodes = compiled.nodes || compiled._nodes || new Map();
  const ids: string[] = nodes instanceof Map ? Array.from(nodes.keys()) : Object.keys(nodes);
  return ids.filter((id) => id !== '__start__' && id !== '__end__');
}

describe('universal graph — realtime surface registration', () => {
  const nodeIds = compiledNodeIds();

  it('graph compiles with the expected node set', () => {
    expect(nodeIds.sort()).toEqual(['agent', 'resolve', 'respond', 'tool'].sort());
  });

  it.each(compiledNodeIds().map((id) => [id] as const))(
    'ACTOR_MAPPINGS has universal:universal:%s',
    (nodeId) => {
      expect(ACTOR_MAPPINGS[`universal:universal:${nodeId}`]).toBeDefined();
    },
  );

  // Phase ids universal passes to withPhaseTracking (graph.ts wiring).
  it.each([['agent']] as const)(
    'phase label map resolves %s (no raw-id fallback)',
    (phaseId) => {
      expect(resolveNodePhaseLabel(phaseId, 'en')).not.toBe(phaseId);
      expect(resolveNodePhaseLabel(phaseId, 'ko')).not.toBe(phaseId);
    },
  );
});
