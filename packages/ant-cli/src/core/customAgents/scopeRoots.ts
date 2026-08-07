/**
 * Custom-agent scope root derivation (D8).
 *
 * The loader/discovery only ever sees an ordered root list, so adding the
 * org scope later is "one more root", not a mechanism change. Roots are
 * ordered by priority — project > user > org — and the workspace layout
 * (`workspaces/{org}/{user}/{project}`) makes the user root simply the
 * parent directory of the project.
 */

import * as path from 'path';
import type { CustomAgentScopeRoot } from './CustomAgentLoader.js';

export const CUSTOM_AGENTS_DIRNAME = '.ant/agents';

/** Env var naming an org-scope definitions dir (self-host; Phase 3 for cloud sync). */
export const ORG_AGENTS_DIR_ENV = 'ANT_CUSTOM_AGENTS_DIR';

export function deriveCustomAgentScopeRoots(projectPath: string): CustomAgentScopeRoot[] {
  const roots: CustomAgentScopeRoot[] = [
    { scope: 'project', root: path.join(projectPath, CUSTOM_AGENTS_DIRNAME), readonly: false },
    // workspaces/{org}/{user}/{project} → the user dir is the project's parent.
    { scope: 'user', root: path.join(path.dirname(projectPath), CUSTOM_AGENTS_DIRNAME), readonly: false },
  ];
  const orgRoot = process.env[ORG_AGENTS_DIR_ENV];
  if (orgRoot) {
    roots.push({ scope: 'org', root: orgRoot, readonly: true });
  }
  return roots;
}
