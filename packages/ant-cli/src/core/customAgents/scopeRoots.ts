/**
 * Custom-agent scope root derivation (D8).
 *
 * Definitions are account/org-owned, never project-owned. The loader and
 * discovery only ever see an ordered root list, so adding a scope is "one
 * more root", not a mechanism change. Roots are ordered by priority —
 * user > org > builtin — and the workspace layout
 * (`workspaces/{org}/{user}/{project}`) makes the user root simply the
 * parent directory of the project. `builtin` is the read-only sample tree
 * shipped inside the CLI image; any writable scope shadows it wholesale.
 */

import * as path from 'path';
import { INDIVIDUAL_ORG_ID, type OrganizationKind } from '@ant/shared';
import { WorkspacePathResolver } from '../config/WorkspacePathResolver.js';
import type { CustomAgentScopeRoot } from './CustomAgentLoader.js';

export const CUSTOM_AGENTS_DIRNAME = '.ant/agents';

/** Env var naming an org-scope definitions dir (self-host; Phase 3 for cloud sync). */
export const ORG_AGENTS_DIR_ENV = 'ANT_CUSTOM_AGENTS_DIR';

/**
 * Account-first derivation: the user dir IS the scope anchor. Project-scoped
 * callers delegate here with `dirname(projectPath)`; account-scoped callers
 * (agent settings screen — no project selected) pass
 * `getWorkspacePath(userContext)` directly.
 */
export function deriveCustomAgentScopeRootsFromUserDir(userDir: string): CustomAgentScopeRoot[] {
  const roots: CustomAgentScopeRoot[] = [
    { scope: 'user', root: path.join(userDir, CUSTOM_AGENTS_DIRNAME), readonly: false },
  ];
  const orgRoot = process.env[ORG_AGENTS_DIR_ENV];
  if (orgRoot) {
    roots.push({ scope: 'org', root: orgRoot, readonly: true });
  }
  roots.push({ scope: 'builtin', root: WorkspacePathResolver.getBuiltinAgentsPath(), readonly: true });
  return roots;
}

export function deriveCustomAgentScopeRoots(projectPath: string): CustomAgentScopeRoot[] {
  // workspaces/{org}/{user}/{project} → the user dir is the project's parent.
  return deriveCustomAgentScopeRootsFromUserDir(path.dirname(projectPath));
}

/** Tenant identity a scope-root derivation dispatches on (kind, never server mode). */
export interface CustomAgentTenantContext {
  /** Physical workspaces root (`ANT_WORKSPACE_BASE_PATH` resolution). */
  workspacesPath: string;
  userId: string;
  organizationId: string;
  organizationKind: OrganizationKind;
}

/**
 * Tenant-aware derivation SSOT (org-owned agents). Dispatches on the org
 * KIND — never on server mode:
 *
 * - `local` / `individual` — byte-identical to the historical user-dir
 *   derivation (the active org IS the anchor org).
 * - `team` — personal agents stay anchored under the INDIVIDUAL org
 *   (`{ws}/individual/{user}`) so switching the active org never empties the
 *   list; the pre-org-agents team-active user root rides along as a readonly
 *   `legacy` fallback; the per-org shared root (`{ws}/{orgId}/.ant/agents`)
 *   is `aclGoverned` (per-agent write authority via `agent-acl.json`).
 *
 * The `ANT_CUSTOM_AGENTS_DIR` env root stays BELOW the per-org root: it is a
 * single global directory with no org separation (documented multi-tenant
 * exposure — self-host escape hatch only).
 */
export function deriveCustomAgentScopeRootsForTenant(ctx: CustomAgentTenantContext): CustomAgentScopeRoot[] {
  if (ctx.organizationKind !== 'team') {
    return deriveCustomAgentScopeRootsFromUserDir(
      path.join(ctx.workspacesPath, ctx.organizationId, ctx.userId),
    );
  }
  const roots: CustomAgentScopeRoot[] = [
    {
      scope: 'user',
      root: path.join(ctx.workspacesPath, INDIVIDUAL_ORG_ID, ctx.userId, CUSTOM_AGENTS_DIRNAME),
      readonly: false,
    },
    {
      scope: 'user',
      root: path.join(ctx.workspacesPath, ctx.organizationId, ctx.userId, CUSTOM_AGENTS_DIRNAME),
      readonly: true,
      legacy: true,
    },
    {
      scope: 'org',
      root: path.join(ctx.workspacesPath, ctx.organizationId, CUSTOM_AGENTS_DIRNAME),
      readonly: false,
      aclGoverned: true,
    },
  ];
  const envOrgRoot = process.env[ORG_AGENTS_DIR_ENV];
  if (envOrgRoot) {
    roots.push({ scope: 'org', root: envOrgRoot, readonly: true });
  }
  roots.push({ scope: 'builtin', root: WorkspacePathResolver.getBuiltinAgentsPath(), readonly: true });
  return roots;
}
