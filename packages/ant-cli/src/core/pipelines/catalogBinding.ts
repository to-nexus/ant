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
  hasPipelineAdvisories,
  resolvePipelineAdvisories,
  validatePipelineCatalogBinding,
  type PipelineAdvisoryResolution,
  type PipelineCatalogAgent,
  type PipelineDef,
} from '@ant/shared';
import { discoverAgents } from '../customAgents/CustomAgentLoader';
import { deriveCustomAgentScopeRootsForTenant, type CustomAgentTenantContext } from '../customAgents/scopeRoots';

export interface PipelineJudgement {
  catalogWarnings: string[];
  advisories: PipelineAdvisoryResolution;
}

/** The caller's catalog, resolved once — pass it to every per-pipeline judgement of one request. */
export function resolvePipelineCatalog(tenant: CustomAgentTenantContext): PipelineCatalogAgent[] {
  return discoverAgents(deriveCustomAgentScopeRootsForTenant(tenant));
}

export function validatePipelineCatalogServer(def: PipelineDef, tenant: CustomAgentTenantContext): string[] {
  return validatePipelineCatalogBinding(def, resolvePipelineCatalog(tenant));
}

/** Both verdicts over an already-resolved catalog — the offline CLI's entry as well. */
export function judgePipelineForCatalog(def: PipelineDef, agents: PipelineCatalogAgent[]): PipelineJudgement {
  return {
    catalogWarnings: validatePipelineCatalogBinding(def, agents),
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
