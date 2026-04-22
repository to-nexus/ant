/**
 * Reference Code Context Types
 *
 * The main-project code context used to live here as `ProjectCodeContext`
 * — removed along with the state channel. Plan-local code context now
 * lives inline in `nodes/plan/combineCodeContext.ts` as `PlanCodeContext`.
 */

import { GitDiffSummary } from '../../codebase/GitDiffSummary';

/**
 * Reference project code context (opt-in via `state.referenceRequests`).
 * Rendered into the plan prompt; not consumed by execute.
 */
export interface ReferenceCodeContext {
  filePaths: string[];
  files: Array<{
    path: string;
    content: string;
  }>;
  gitDiff?: GitDiffSummary;
  stats: {
    filesLoaded: number;
    estimatedTokens: number;
  };
  project: string;
  branch?: string;
}
