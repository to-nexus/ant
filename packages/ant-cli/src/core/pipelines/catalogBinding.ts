/**
 * Catalog-binding check against the CALLER's agent catalog — the server leg of
 * the shared `validatePipelineCatalogBinding`. Enable judges the enabler's
 * catalog, activate re-judges the activator's (the one dispatch resolves
 * against); the save funnel returns the same findings as non-blocking
 * `catalogWarnings` so an authoring job (pipeline-builder) can self-correct.
 */

import {
  collectPipelineCatalogAdvisories,
  collectPipelineDefAdvisories,
  validatePipelineCatalogBinding,
  type PipelineCatalogAgent,
  type PipelineDef,
} from '@ant/shared';
import { discoverAgents } from '../customAgents/CustomAgentLoader';
import { deriveCustomAgentScopeRootsForTenant, type CustomAgentTenantContext } from '../customAgents/scopeRoots';

export function validatePipelineCatalogServer(def: PipelineDef, tenant: CustomAgentTenantContext): string[] {
  return validatePipelineCatalogBinding(def, discoverAgents(deriveCustomAgentScopeRootsForTenant(tenant)));
}

/**
 * Save-funnel warnings: catalog findings (hard-fail enable later) +
 * def-structural and catalog advisories (never hard — pin-needs coherence
 * rides the save response only, the enable gate must not consume it).
 */
export function collectPipelineSaveWarnings(def: PipelineDef, tenant: CustomAgentTenantContext): string[] {
  return collectPipelineSaveWarningsForCatalog(def, discoverAgents(deriveCustomAgentScopeRootsForTenant(tenant)));
}

/**
 * The same three collectors over an already-resolved catalog — what the
 * offline `definition validate-pipeline` CLI runs against folders on disk, so
 * a draft authored outside the server hears exactly the save funnel's words.
 */
export function collectPipelineSaveWarningsForCatalog(def: PipelineDef, agents: PipelineCatalogAgent[]): string[] {
  return [
    ...validatePipelineCatalogBinding(def, agents),
    ...collectPipelineDefAdvisories(def),
    ...collectPipelineCatalogAdvisories(def, agents),
  ];
}
