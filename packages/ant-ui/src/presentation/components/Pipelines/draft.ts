/**
 * Pure draft-editing helpers — every editor surface (canvas, inspector,
 * header) mutates the ONE `pipelineDraft` through these. Leaf module: no
 * store/http imports (planContinuation precedent) so the linear-insert
 * semantics stay unit-testable.
 *
 * v1 canvas contract: UI-authored definitions stay IMPLICIT-linear (steps
 * carry no `needs`; order is the chain). A hand-authored def with explicit
 * `needs` still renders as a DAG, but node insertion degrades to append-only
 * (`stepsAreLinear` gate) — reordering an explicit DAG is a v2 surface.
 */

import {
  isApprovalStep,
  type ApprovalStepDef,
  type JobStepDef,
  type PipelineDef,
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
  return { id: uniqueStepId(def, 'step'), customJobRef: '', directive: '' };
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

/** Insert after the step id (or after the trigger = index 0). Linear defs only. */
export function insertStepAfter(def: PipelineDef, afterNodeId: string, step: PipelineStepDef): PipelineDef {
  const index = afterNodeId === TRIGGER_NODE_ID ? -1 : def.steps.findIndex((s) => s.id === afterNodeId);
  const steps = [...def.steps];
  steps.splice(index + 1, 0, step);
  return { ...def, steps };
}

export function updateStep(def: PipelineDef, stepId: string, patch: Partial<PipelineStepDef>): PipelineDef {
  return {
    ...def,
    steps: def.steps.map((s) => (s.id === stepId ? ({ ...s, ...patch } as PipelineStepDef) : s)),
  };
}

export function removeStep(def: PipelineDef, stepId: string): PipelineDef {
  return { ...def, steps: def.steps.filter((s) => s.id !== stepId) };
}

export function updateSchedule(def: PipelineDef, patch: Partial<PipelineDef['on']['schedule']>): PipelineDef {
  return { ...def, on: { schedule: { ...def.on.schedule, ...patch } } };
}

/** Client copy of the executor's implicit-needs rule for edge rendering. */
export function effectiveNeedsOf(def: PipelineDef, index: number): string[] {
  const step = def.steps[index];
  if (step.needs !== undefined) return step.needs;
  return index > 0 ? [def.steps[index - 1].id] : [];
}

export function stepKindOf(step: PipelineStepDef): 'job' | 'gate' {
  return isApprovalStep(step) ? 'gate' : 'job';
}
