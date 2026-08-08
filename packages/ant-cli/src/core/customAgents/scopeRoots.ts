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
