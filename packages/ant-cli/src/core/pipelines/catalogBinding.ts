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
  fetchConnectionSource,
  hasPipelineAdvisories,
  parseCustomJobRef,
  parseRestAllowLine,
  resolvePipelineAdvisories,
  validatePipelineCatalogBinding,
  type PipelineAdvisoryResolution,
  type PipelineCatalogAgent,
  type PipelineDef,
  type RestAllowRule,
} from '@ant/shared';
import { discoverAgents } from '../customAgents/CustomAgentLoader';
import { isAllowedByRules } from '../customAgents/restApi';
import { deriveCustomAgentScopeRootsForTenant, type CustomAgentTenantContext } from '../customAgents/scopeRoots';

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

export function validatePipelineCatalogServer(def: PipelineDef, tenant: CustomAgentTenantContext): string[] {
  const agents = resolvePipelineCatalog(tenant);
  return [...validatePipelineCatalogBinding(def, agents), ...fetchAllowErrors(def, agents)];
}

/** Both verdicts over an already-resolved catalog — the offline CLI's entry as well. */
export function judgePipelineForCatalog(def: PipelineDef, agents: PipelineCatalogAgent[]): PipelineJudgement {
  return {
    catalogWarnings: [...validatePipelineCatalogBinding(def, agents), ...fetchAllowErrors(def, agents)],
    advisories: resolvePipelineAdvisories(def, agents),
  };
}

export function judgePipeline(def: PipelineDef, tenant: CustomAgentTenantContext): PipelineJudgement {
  return judgePipelineForCatalog(def, resolvePipelineCatalog(tenant));
}

/** Response fields — each key present only when it carries something (a clean definition answers neither). */
export function judgementResponseFields(j: PipelineJudgement): { catalogWarnings?: string[]; advisories?: PipelineAdvisoryResolution } {
  return {
    ...(j.catalogWarnings.length > 0 && { catalogWarnings: j.catalogWarnings }),
    ...(hasPipelineAdvisories(j.advisories) && { advisories: j.advisories }),
  };
}
