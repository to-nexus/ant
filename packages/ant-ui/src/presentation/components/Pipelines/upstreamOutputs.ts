/**
 * Upstream stop-hook output suggestions for a step's context pins.
 *
 * An intent's `hooks.stop` artifact globs are its STATIC output contract —
 * the runtime bounces the agent until a matching file is really written, and
 * `needs` ordering guarantees the upstream step finished before this step
 * fires. So the globs of every upstream step's pinned intent are exactly the
 * artifacts this step may pin, resolvable account-scoped (no project tree
 * needed — the accountAgents discovery payload carries full intent defs).
 * Steps without a pinned intent contribute nothing: the job self-selects at
 * runtime, so its outputs are unknowable at authoring time.
 */

import { isApprovalStep, parseCustomJobRef, type PipelineDef } from '@ant/shared';
import { effectiveNeedsOf } from './draft';

export interface UpstreamOutputSuggestion {
  glob: string;
  sourceStepId: string;
  intentId: string;
}

interface AgentCatalogEntry {
  id: string;
  jobs: Array<{
    id: string;
    intents?: Array<{ id: string; hooks?: { stop: Array<{ artifact: string } | { action: string }> } }>;
  }>;
}

export const UPSTREAM_SUGGESTIONS_CAP = 12;

export function upstreamOutputSuggestions(
  def: PipelineDef,
  stepId: string,
  agents: AgentCatalogEntry[],
  cap = UPSTREAM_SUGGESTIONS_CAP,
): UpstreamOutputSuggestion[] {
  const index = def.steps.findIndex((s) => s.id === stepId);
  if (index < 0) return [];

  // Transitive needs closure (implicit-linear defs resolve to the prior step).
  const indexOf = new Map(def.steps.map((s, i) => [s.id, i]));
  const upstream = new Set<string>();
  const queue = [...effectiveNeedsOf(def, index)];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (upstream.has(id)) continue;
    const i = indexOf.get(id);
    if (i === undefined) continue;
    upstream.add(id);
    queue.push(...effectiveNeedsOf(def, i));
  }

  const out: UpstreamOutputSuggestion[] = [];
  const seenGlobs = new Set<string>();
  for (const step of def.steps) {
    if (!upstream.has(step.id) || isApprovalStep(step) || !step.intent) continue;
    const ref = parseCustomJobRef(step.customJobRef);
    if (!ref) continue;
    const intent = agents
      .find((a) => a.id === ref.agentId)
      ?.jobs.find((j) => j.id === ref.jobId)
      ?.intents?.find((i) => i.id === step.intent);
    for (const hook of intent?.hooks?.stop ?? []) {
      if (out.length >= cap) return out;
      if (!('artifact' in hook) || seenGlobs.has(hook.artifact)) continue;
      seenGlobs.add(hook.artifact);
      out.push({ glob: hook.artifact, sourceStepId: step.id, intentId: step.intent });
    }
  }
  return out;
}
