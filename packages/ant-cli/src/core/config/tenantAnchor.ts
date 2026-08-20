/**
 * Personal-data anchor for account-scoped resources (agents, pipelines).
 * Dispatches on the org KIND — never on server mode: team orgs anchor personal
 * data under the INDIVIDUAL org (`{ws}/individual/{user}`) so switching the
 * active org never re-homes a user's definitions; local/individual kinds use
 * the active org directly. Single owner — scope-root derivations must call
 * this instead of re-encoding the fork.
 */

import * as path from 'path';
import { INDIVIDUAL_ORG_ID, type OrganizationKind } from '@ant/shared';

export interface TenantAnchorContext {
  /** Physical workspaces root (`ANT_WORKSPACE_BASE_PATH` resolution). */
  workspacesPath: string;
  userId: string;
  organizationId: string;
  organizationKind: OrganizationKind;
}

export function resolveTenantUserDir(ctx: TenantAnchorContext): string {
  return ctx.organizationKind === 'team'
    ? path.join(ctx.workspacesPath, INDIVIDUAL_ORG_ID, ctx.userId)
    : path.join(ctx.workspacesPath, ctx.organizationId, ctx.userId);
}
