/**
 * Universal AGENT-PLANE path resolution — the single owner of "what may this
 * job's tools reach".
 *
 * The universal runtime has two path questions, and they are not the same one:
 *
 * - EXPLORER plane (`resolveUniversalMergedPath`): what the codespace panel,
 *   the file-tree HTTP route and the SSE broadcaster show — artifacts ∪
 *   `sessions` ∪ `pipeline-runs`.
 * - AGENT plane (here): what `read_file` / `list_files` can resolve, and
 *   therefore what the composer may attach with `@ctx:` — artifacts ∪
 *   `pipeline-runs` ∪ `_agents` (peer definitions), NEVER `sessions`.
 *
 * Those two used to be answered by one function plus a hard-coded sandbox
 * facade that disagreed with it, which is how `pipeline-runs/…` became
 * attachable but unreadable (accept passed, the prompt band even outlined it,
 * the tool call 404'd). The attachable set is now DERIVED from this resolver,
 * so the two cannot drift again.
 */

import * as path from 'path';
import { UNIVERSAL_PIPELINE_RUNS_DIRNAME, isUniversalAgentRef, parseUniversalAgentRef } from '@ant/shared';
import { findAgentRoot } from './CustomAgentLoader';
import type { CustomAgentScopeRoot } from './CustomAgentLoader';
import {
  UNIVERSAL_ARTIFACTS_DIRNAME,
  UNIVERSAL_SESSIONS_NODE,
  getPipelineRunsRootOf,
  resolveWithinRoot,
} from './universalContainer';

/** Which root a merged-view path landed in — the prompt band labels by this. */
export type UniversalAgentPlaneRoot = 'artifacts' | 'pipeline-runs' | 'agents';

export interface UniversalAgentPlaneContext {
  /** `{project}/universal`. */
  containerPath: string;
  /** Definition scope roots, in priority order (user > org > builtin). */
  scopeRoots: CustomAgentScopeRoot[];
}

export interface UniversalAgentPlanePath {
  absPath: string;
  root: UniversalAgentPlaneRoot;
  /** Set only for `root === 'agents'`. */
  agentId?: string;
}

/**
 * Merged-view relative path → absolute path, or throw. Throwing (never
 * silently re-rooting) is the contract: a path this plane cannot serve must
 * surface as a 400 at accept, not as a file the agent later cannot open.
 */
export function resolveUniversalAgentPlanePath(
  rel: string,
  ctx: UniversalAgentPlaneContext,
): UniversalAgentPlanePath {
  const normalized = rel.replace(/\\/g, '/').replace(/^\/+/, '');

  if (normalized === UNIVERSAL_SESSIONS_NODE || normalized.startsWith(`${UNIVERSAL_SESSIONS_NODE}/`)) {
    throw new Error(`Path is outside the agent sandbox: ${rel}`);
  }

  if (isUniversalAgentRef(normalized)) {
    const parsed = parseUniversalAgentRef(normalized);
    if (!parsed) throw new Error(`Invalid agent reference: ${rel}`);
    const found = findAgentRoot(ctx.scopeRoots, parsed.agentId);
    if (!found) throw new Error(`Custom agent not found: ${parsed.agentId}`);
    return {
      absPath: resolveWithinRoot(found.agentDir, parsed.rest),
      root: 'agents',
      agentId: parsed.agentId,
    };
  }

  if (
    normalized === UNIVERSAL_PIPELINE_RUNS_DIRNAME ||
    normalized.startsWith(`${UNIVERSAL_PIPELINE_RUNS_DIRNAME}/`)
  ) {
    const remainder =
      normalized === UNIVERSAL_PIPELINE_RUNS_DIRNAME
        ? ''
        : normalized.slice(UNIVERSAL_PIPELINE_RUNS_DIRNAME.length + 1);
    return { absPath: resolveWithinRoot(getPipelineRunsRootOf(ctx.containerPath), remainder), root: 'pipeline-runs' };
  }

  return {
    absPath: resolveWithinRoot(path.join(ctx.containerPath, UNIVERSAL_ARTIFACTS_DIRNAME), normalized),
    root: 'artifacts',
  };
}
