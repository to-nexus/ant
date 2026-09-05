/**
 * Catalog-binding check against the CALLER's agent catalog — the server leg of
 * the shared `validatePipelineCatalogBinding`. Enable judges the enabler's
 * catalog, activate re-judges the activator's (the one dispatch resolves
 * against); the save funnel returns the same findings as non-blocking
 * `catalogWarnings` so an authoring job (pipeline-builder) can self-correct.
 */

import { collectPipelineDefAdvisories, validatePipelineCatalogBinding, type PipelineDef } from '@ant/shared';
import { discoverAgents } from '../customAgents/CustomAgentLoader';
import { deriveCustomAgentScopeRootsForTenant, type CustomAgentTenantContext } from '../customAgents/scopeRoots';

export function validatePipelineCatalogServer(def: PipelineDef, tenant: CustomAgentTenantContext): string[] {
  return validatePipelineCatalogBinding(def, discoverAgents(deriveCustomAgentScopeRootsForTenant(tenant)));
}

/** Save-funnel warnings: catalog findings (hard-fail enable later) + def-structural advisories (never hard). */
export function collectPipelineSaveWarnings(def: PipelineDef, tenant: CustomAgentTenantContext): string[] {
  return [...validatePipelineCatalogServer(def, tenant), ...collectPipelineDefAdvisories(def)];
}
