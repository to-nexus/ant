/**
 * Per-node model-slot ↔ compiled-graph coverage guard.
 *
 * The project-settings model picker used to hardcode which graph nodes are
 * overridable (a parallel copy of the graph that silently drifted — e.g. the
 * planner `generate` → `plan`+`execute` split, and visual `explain` being
 * overridable in the BE but missing from the picker). The slot set now lives in
 * `@ant/shared` (`OVERRIDABLE_MODEL_SLOTS`); this test reconciles it against the
 * DYNAMIC `GraphMetadataService` node topology so a graph refactor that adds /
 * renames / removes an LLM node fails here instead of drifting.
 *
 * Scope note: the "llm-touching" signal comes from `GraphMetadataService`'s
 * hand-authored `ACTOR_MAPPINGS`, not from runtime. So Assertion B guards the
 * picker against the *actor table*, which is itself only partially complete for
 * the architect jobs; it is strongest for `planner:plan` and `creator:visual`
 * whose tables are current.
 */

import { describe, it, expect } from 'vitest';
import {
  OVERRIDABLE_MODEL_SLOTS,
  MODEL_JOB_AGENT,
  NON_OVERRIDABLE_LLM_NODES,
  type ModelJobKey,
} from '@ant/shared';
import {
  GraphMetadataService,
  ACTOR_MAPPINGS,
} from '../../src/periphery/adapters/http/services/GraphMetadataService';

// Actor id for the LLM API (ActorType.LLM / COMMON_ACTORS.llm.id).
const LLM_ACTOR = 'llm';

const svc = new GraphMetadataService();
const jobs = Object.keys(OVERRIDABLE_MODEL_SLOTS) as ModelJobKey[];

describe('OVERRIDABLE_MODEL_SLOTS ↔ compiled graph coverage', () => {
  it.each(jobs)(
    'A: every %s slot maps to a real compiled graph node',
    async (job) => {
      const agent = MODEL_JOB_AGENT[job];
      const meta = await svc.extractGraphMetadata(agent, job);
      const nodeIds = new Set(meta.nodes.map((n) => n.id));
      expect(meta.nodes.length, `${agent}:${job} graph produced no nodes`).toBeGreaterThan(0);
      for (const slot of OVERRIDABLE_MODEL_SLOTS[job]) {
        expect(
          nodeIds.has(slot),
          `SSOT slot '${job}.${slot}' has no matching node in the ${agent}:${job} graph — was the node renamed or removed?`,
        ).toBe(true);
      }
    },
  );

  it.each(jobs)(
    'B: every llm-tagged %s node is a picker slot or a declared-fixed node',
    async (job) => {
      const agent = MODEL_JOB_AGENT[job];
      const meta = await svc.extractGraphMetadata(agent, job);
      const slots = new Set<string>(OVERRIDABLE_MODEL_SLOTS[job]);
      const fixed = new Set<string>(NON_OVERRIDABLE_LLM_NODES[`${agent}:${job}`] ?? []);
      const llmNodes = meta.nodes
        .filter((n) => n.interactsWithActors.includes(LLM_ACTOR))
        .map((n) => n.id);
      for (const id of llmNodes) {
        expect(
          slots.has(id) || fixed.has(id),
          `graph node '${agent}:${job}:${id}' touches the llm actor but is neither a picker slot (OVERRIDABLE_MODEL_SLOTS.${job}) nor declared fixed (NON_OVERRIDABLE_LLM_NODES['${agent}:${job}']) — add a slot or declare it intentionally non-overridable`,
        ).toBe(true);
      }
    },
  );

  it.each(jobs)(
    'C: %s fixed-node exclusions name real, llm-tagged graph nodes (no stale exclusions)',
    async (job) => {
      const agent = MODEL_JOB_AGENT[job];
      const fixed = NON_OVERRIDABLE_LLM_NODES[`${agent}:${job}`] ?? [];
      if (fixed.length === 0) return;
      const meta = await svc.extractGraphMetadata(agent, job);
      const llmNodeIds = new Set(
        meta.nodes.filter((n) => n.interactsWithActors.includes(LLM_ACTOR)).map((n) => n.id),
      );
      for (const id of fixed) {
        expect(
          llmNodeIds.has(id),
          `NON_OVERRIDABLE_LLM_NODES lists '${agent}:${job}:${id}' but no such llm-tagged node exists in the graph (stale exclusion?)`,
        ).toBe(true);
      }
    },
  );
});

describe('creator:visual graph ↔ ACTOR_MAPPINGS coverage', () => {
  it('every compiled visual node has a creator:visual ACTOR_MAPPINGS entry with a description', async () => {
    const meta = await svc.extractGraphMetadata('creator', 'visual');
    expect(meta.nodes.length).toBeGreaterThan(0);
    for (const node of meta.nodes) {
      expect(
        ACTOR_MAPPINGS[`creator:visual:${node.id}`],
        `visual graph node '${node.id}' has no creator:visual:${node.id} ACTOR_MAPPINGS entry`,
      ).toBeDefined();
      expect(
        node.description,
        `visual graph node '${node.id}' renders with no description`,
      ).toBeTruthy();
    }
  });

  it('no creator:visual:* mapping points at a node absent from the graph', async () => {
    const meta = await svc.extractGraphMetadata('creator', 'visual');
    const nodeIds = new Set(meta.nodes.map((n) => n.id));
    for (const key of Object.keys(ACTOR_MAPPINGS).filter((k) => k.startsWith('creator:visual:'))) {
      const nodeId = key.slice('creator:visual:'.length);
      expect(
        nodeIds.has(nodeId),
        `stale ACTOR_MAPPINGS key '${key}' references a non-existent graph node`,
      ).toBe(true);
    }
  });
});
