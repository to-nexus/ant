/**
 * RAG barrel — public surface of the plan-node RAG retrieval pipeline.
 *
 * Pipeline orchestration lives in `pipeline.ts`; the per-tier loaders
 * (`combine`, `keyword`, `semantic`, `errorFiles`) and the `--- FILE: ...`
 * block parser (`parseFileBlocks`) are exported here so external callers
 * (e.g. `runner.ts` for `resetKeywordDedup`) and intra-`plan/` callers
 * import from a single barrel.
 */

export { runPlanRAG } from './pipeline';
export type { PlanRagResult } from './pipeline';

// Tier loaders
export { combineCodeContext, generateDirectoryTree } from './combine';
export type {
  PlanCodeContext,
  CombinedCodeContextResult,
  TaskKeywords,
} from './combine';

export {
  generateTaskKeywords,
  displayKeywords,
  logKeywords,
  resetKeywordDedup,
  clearKeywordDedupForTask,
} from './keyword';

export { loadErrorFiles } from './errorFiles';
export type { LoadedFile } from './errorFiles';

export { loadSemanticFiles } from './semantic';
export type { LessonResult, SemanticSearchResult } from './semantic';

export { extractFilesFromCode } from './parseFileBlocks';
