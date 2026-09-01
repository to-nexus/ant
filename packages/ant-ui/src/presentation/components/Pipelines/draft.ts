/**
 * Pure draft-editing helpers — every editor surface (canvas, inspector,
 * header) mutates the ONE `pipelineDraft` through these. Leaf module: no
 * store/http imports (planContinuation precedent) so the mutation semantics
 * stay unit-testable.
 *
 * Canvas contract: a LINEAR def (no step carries `needs`) is edited
 * positionally and stays implicit — zero YAML churn. Any structural edit on
 * a def with explicit `needs` first MATERIALIZES every implicit edge
 * (`materializeNeeds` — semantically identity), because a positional splice
 * into a mixed implicit/explicit def silently rewires the implicit edges.
 * Branching is authored in the inspector (`setStepNeeds`); free drag-to-
 * connect stays a Phase 3 surface.
 */

import {
  type ApprovalStepDef,
  type JobStepDef,
  type PipelineDef,
  type PipelineScheduleTrigger,
  type PipelineStepDef,
} from '@ant/shared';

export const TRIGGER_NODE_ID = 'trigger';

export function stepsAreLinear(def: PipelineDef): boolean {
  return def.steps.every((s) => s.needs === undefined);
}

export function uniqueStepId(def: PipelineDef, base: string): string {
  const taken = new Set(def.steps.map((s) => s.id));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i += 1) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function makeJobStep(def: PipelineDef): JobStepDef {
  // No directive by default — an empty step dispatches the shared default.
  return { id: uniqueStepId(def, 'step'), customJobRef: '' };
}

export function makeGateStep(def: PipelineDef): ApprovalStepDef {
  return {
    id: uniqueStepId(def, 'approval'),
    type: 'approval',
    prompt: '',
    timeout: { after: '24h', onTimeout: 'reject' },
    channels: ['inApp'],
  };
}

/**
 * Give every step explicit `needs` equal to its effective edges. Semantically
 * identity — required before any structural edit on a non-linear def, where a
 * positional splice would silently rewire the remaining implicit edges.
 */
export function materializeNeeds(def: PipelineDef): PipelineDef {
  return {
    ...def,
    steps: def.steps.map((s, i) => ({ ...s, needs: effectiveNeedsOf(def, i) }) as PipelineStepDef),
  };
}

/**
 * Insert after the step id (or after the trigger). Linear defs keep the
 * implicit positional splice (zero YAML churn); DAG defs materialize and
 * splice-through: the new step takes the anchor as its need and the anchor's
 * dependents (all roots, for a trigger anchor) rewire onto the new step.
 */
export function insertStepAfter(def: PipelineDef, afterNodeId: string, step: PipelineStepDef): PipelineDef {
  const index = afterNodeId === TRIGGER_NODE_ID ? -1 : def.steps.findIndex((s) => s.id === afterNodeId);
  if (stepsAreLinear(def)) {
    const steps = [...def.steps];
    steps.splice(index + 1, 0, step);
    return { ...def, steps };
  }
  const materialized = materializeNeeds(def);
  const rewired = materialized.steps.map((s) => {
    const needs = s.needs ?? [];
    if (afterNodeId === TRIGGER_NODE_ID) {
      return needs.length === 0 ? ({ ...s, needs: [step.id] } as PipelineStepDef) : s;
    }
    return needs.includes(afterNodeId)
      ? ({ ...s, needs: needs.map((n) => (n === afterNodeId ? step.id : n)) } as PipelineStepDef)
      : s;
  });
  const inserted = { ...step, needs: afterNodeId === TRIGGER_NODE_ID ? [] : [afterNodeId] } as PipelineStepDef;
  const steps = [...rewired];
  steps.splice(index + 1, 0, inserted);
  return { ...def, steps };
}

export function updateStep(def: PipelineDef, stepId: string, patch: Partial<PipelineStepDef>): PipelineDef {
  return {
    ...def,
    steps: def.steps.map((s) => (s.id === stepId ? ({ ...s, ...patch } as PipelineStepDef) : s)),
  };
}

/**
 * Remove a step. Linear defs self-heal (the implicit chain closes over the
 * hole); DAG defs materialize, then every dependent rewires onto the removed
 * step's own needs — no dangling reference can reach the validator.
 */
export function removeStep(def: PipelineDef, stepId: string): PipelineDef {
  if (stepsAreLinear(def)) {
    return { ...def, steps: def.steps.filter((s) => s.id !== stepId) };
  }
  const materialized = materializeNeeds(def);
  const removed = materialized.steps.find((s) => s.id === stepId);
  const inherited = removed?.needs ?? [];
  const steps = materialized.steps
    .filter((s) => s.id !== stepId)
    .map((s) => {
      const needs = s.needs ?? [];
      if (!needs.includes(stepId)) return s;
      const rewired = [...new Set([...needs.filter((n) => n !== stepId), ...inherited])];
      return { ...s, needs: rewired } as PipelineStepDef;
    });
  return { ...def, steps };
}

/**
 * Set a step's dependencies. `undefined` resets to the implicit default
 * (previous step in file order); `[]` makes it a root.
 */
export function setStepNeeds(def: PipelineDef, stepId: string, needs: string[] | undefined): PipelineDef {
  return {
    ...def,
    steps: def.steps.map((s) => {
      if (s.id !== stepId) return s;
      if (needs === undefined) {
        const { needs: _drop, ...rest } = s as PipelineStepDef & { needs?: string[] };
        return rest as PipelineStepDef;
      }
      return { ...s, needs } as PipelineStepDef;
    }),
  };
}

/** Transitive dependents of a step over effective edges — the cycle-proof exclusion set for a needs picker. */
export function descendantsOf(def: PipelineDef, stepId: string): Set<string> {
  const dependents = new Map<string, string[]>();
  def.steps.forEach((s, i) => {
    for (const need of effectiveNeedsOf(def, i)) {
      const list = dependents.get(need) ?? [];
      list.push(s.id);
      dependents.set(need, list);
    }
  });
  const out = new Set<string>();
  const queue = [stepId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const dep of dependents.get(id) ?? []) {
      if (out.has(dep)) continue;
      out.add(dep);
      queue.push(dep);
    }
  }
  return out;
}

export const DEFAULT_SCHEDULE_CRON = '0 9 * * 1';

export function updateSchedule(def: PipelineDef, patch: Partial<PipelineScheduleTrigger>): PipelineDef {
  return { ...def, on: { schedule: { cron: DEFAULT_SCHEDULE_CRON, ...def.on?.schedule, ...patch } } };
}

/** Toggle the schedule trigger. Off deletes `on` entirely — a manual-only def. */
export function setScheduleEnabled(def: PipelineDef, enabled: boolean): PipelineDef {
  if (!enabled) {
    const { on: _drop, ...rest } = def;
    return rest as PipelineDef;
  }
  return def.on?.schedule ? def : { ...def, on: { schedule: { cron: DEFAULT_SCHEDULE_CRON } } };
}

/** Client copy of the executor's implicit-needs rule for edge rendering. */
export function effectiveNeedsOf(def: PipelineDef, index: number): string[] {
  const step = def.steps[index];
  if (step.needs !== undefined) return step.needs;
  return index > 0 ? [def.steps[index - 1].id] : [];
}
