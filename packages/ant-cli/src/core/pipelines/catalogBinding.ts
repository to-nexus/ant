/**
 * The definition judged against the CALLER's agent catalog — the server leg
 * of the shared rules. Two verdicts with different force, never one array:
 *
 * - `catalogWarnings` (`validatePipelineCatalogBinding`): the enable gate
 *   hard-fails on these. Enable judges the enabler's catalog, activate
 *   re-judges the activator's (the one dispatch resolves against).
 * - `advisories` (`resolvePipelineAdvisories`): open / acknowledged / stale.
 *   Never a gate. Nothing is stored — every read recomputes against the
 *   current catalog, so a catalog change shows on the next GET or list.
 *
 * Both ride the save response so an authoring job (pipeline-builder)
 * self-corrects, and the GET / list responses so a person sees the current
 * state without re-saving (an enabled pipeline cannot be re-saved).
 */

import {
  GENERAL_INTENT,
  fetchConnectionSource,
  hasPipelineAdvisories,
  isApprovalStep,
  parseCustomJobRef,
  parseRestAllowLine,
  resolvePipelineAdvisories,
  validatePipelineCatalogBinding,
  verdictEdgeOutcomes,
  type PipelineAdvisoryResolution,
  type PipelineCatalogAgent,
  type PipelineDef,
  type RestAllowRule,
} from '@ant/shared';
import { discoverAgents } from '../customAgents/CustomAgentLoader';
import { isAllowedByRules } from '../customAgents/restApi';
import { deriveCustomAgentScopeRootsForTenant, type CustomAgentTenantContext } from '../customAgents/scopeRoots';
import type { PipelineTenantContext } from './paths';
import { derivePipelineScopeRootsForTenant } from './scopeRoots';
import { findPipelineRoot, loadPipeline } from './store';

export interface PipelineJudgement {
  catalogWarnings: string[];
  advisories: PipelineAdvisoryResolution;
}

/** The caller's catalog, resolved once — pass it to every per-pipeline judgement of one request. */
export function resolvePipelineCatalog(tenant: CustomAgentTenantContext): PipelineCatalogAgent[] {
  return discoverAgents(deriveCustomAgentScopeRootsForTenant(tenant));
}

/**
 * The fetch request against the connection's `allow` rules, judged with the
 * executor's OWN matcher (`isAllowedByRules`) so authoring feedback and the
 * poll's admission cannot disagree. Silent when the shared binding already
 * failed to resolve the connection (its rule owns that message).
 */
export function fetchAllowErrors(def: PipelineDef, agents: PipelineCatalogAgent[]): string[] {
  const fetch = def.on?.fetch;
  if (!fetch || fetchConnectionSource(fetch) === 'inline') return [];
  const ref = parseCustomJobRef(fetch.customJobRef);
  const api = ref ? agents.find((a) => a.id === ref.agentId)?.jobs.find((j) => j.id === ref.jobId)?.apis?.[fetch.api ?? ''] : undefined;
  if (!api || api.self || !api.allow) return [];
  const rules = api.allow.map((l) => parseRestAllowLine(l)).filter((r): r is RestAllowRule => typeof r !== 'string');
  if (isAllowedByRules(rules, fetch.request.method, fetch.request.path)) return [];
  return [
    `on.fetch: ${fetch.request.method} ${fetch.request.path} is not permitted by connection "${fetch.api}" (allow: ${api.allow.join(', ')}) — adjust the request, or extend "allow" in the agent definition`,
  ];
}

/** Resolves the definition an `on.upstream` edge names; null = not authored (yet). Throws on an unparsable one. */
export type UpstreamDefLoader = (pipelineId: string) => PipelineDef | null;

/** The AUTHOR's scope roots, closest-wins — what the editor and enable see; the fire path judges by the activation's pinned snapshot. */
export function upstreamLoaderFor(tenant: PipelineTenantContext): UpstreamDefLoader {
  const roots = derivePipelineScopeRootsForTenant(tenant);
  return (pipelineId) => {
    const found = findPipelineRoot(roots, pipelineId);
    return found ? loadPipeline(found.scopeRoot.root, pipelineId) : null;
  };
}

/**
 * The upstream edge against the definition it names. Only what is DEFINITELY
 * dead warns: a step the upstream lacks, a `verdict:` edge on a gate or on an
 * intent that declares no such outcome. An upstream not authored yet is
 * silent — fire time is the truth (a node the snapshot lacks never matches),
 * and the author may write the two in either order.
 */
export function upstreamBindingWarnings(def: PipelineDef, agents: PipelineCatalogAgent[], loadUpstream?: UpstreamDefLoader): string[] {
  const trigger = def.on?.upstream;
  if (!trigger || !loadUpstream) return [];
  let upstream: PipelineDef | null;
  try {
    upstream = loadUpstream(trigger.pipelineId);
  } catch {
    return [`on.upstream: pipeline "${trigger.pipelineId}" does not load — fix its definition before this edge can fire`];
  }
  if (!upstream || trigger.step === undefined) return [];
  const step = upstream.steps.find((s) => s.id === trigger.step);
  if (!step) {
    return [`on.upstream: pipeline "${trigger.pipelineId}" has no step "${trigger.step}" (steps: ${upstream.steps.map((s) => s.id).join(', ')}) — the edge can never fire`];
  }
  const when = trigger.when ?? 'success';
  if (!when.startsWith('verdict:')) return [];
  if (isApprovalStep(step)) {
    return [`on.upstream: step "${step.id}" of "${trigger.pipelineId}" is an approval gate — a gate seals no verdict, so "${when}" can never match; use when: success (approved) or failure (rejected)`];
  }
  const ref = parseCustomJobRef(step.customJobRef);
  const job = ref ? agents.find((a) => a.id === ref.agentId)?.jobs.find((j) => j.id === ref.jobId) : undefined;
  if (!job || job.intents === undefined) return []; // unknowable here — that job's own catalog rules speak
  const intent = step.intent !== undefined && step.intent !== GENERAL_INTENT ? job.intents.find((i) => i.id === step.intent) : undefined;
  const declared = intent?.outcomes ?? [];
  if (declared.length === 0) {
    return [`on.upstream: step "${step.id}" of "${trigger.pipelineId}" pins no outcome-declaring intent, so "${when}" can never match — name a step whose intent declares outcomes, or use when: success / failure`];
  }
  const missing = verdictEdgeOutcomes(when).filter((o) => !declared.includes(o));
  if (missing.length > 0) {
    return [`on.upstream: intent "${intent!.id}" of "${step.customJobRef}" declares no outcome ${missing.map((o) => `"${o}"`).join(', ')} (declared: ${declared.join(', ')}) — that arm of "${when}" can never match`];
  }
  return [];
}

export function validatePipelineCatalogServer(def: PipelineDef, tenant: CustomAgentTenantContext): string[] {
  const agents = resolvePipelineCatalog(tenant);
  return [...validatePipelineCatalogBinding(def, agents), ...fetchAllowErrors(def, agents), ...upstreamBindingWarnings(def, agents, upstreamLoaderFor(tenant))];
}

/** Both verdicts over an already-resolved catalog — the offline CLI's entry as well (no upstream loader there). */
export function judgePipelineForCatalog(def: PipelineDef, agents: PipelineCatalogAgent[], loadUpstream?: UpstreamDefLoader): PipelineJudgement {
  return {
    catalogWarnings: [...validatePipelineCatalogBinding(def, agents), ...fetchAllowErrors(def, agents), ...upstreamBindingWarnings(def, agents, loadUpstream)],
    advisories: resolvePipelineAdvisories(def, agents),
  };
}

export function judgePipeline(def: PipelineDef, tenant: CustomAgentTenantContext): PipelineJudgement {
  return judgePipelineForCatalog(def, resolvePipelineCatalog(tenant), upstreamLoaderFor(tenant));
}

/** Response fields — each key present only when it carries something (a clean definition answers neither). */
export function judgementResponseFields(j: PipelineJudgement): { catalogWarnings?: string[]; advisories?: PipelineAdvisoryResolution } {
  return {
    ...(j.catalogWarnings.length > 0 && { catalogWarnings: j.catalogWarnings }),
    ...(hasPipelineAdvisories(j.advisories) && { advisories: j.advisories }),
  };
}
