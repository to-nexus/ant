/**
 * Learn Graph State
 * 
 * LearnAnnotation = SSOT for LangGraph graph registration.
 * LearnGraphState = mutable interface for node/runner code.
 */

import { Annotation } from '@langchain/langgraph';
import { TriageableFields } from '../../../common/graph/annotationHelpers';
import type { TriageableState } from '../../../common/graph/nodes/triage/types';
import type { ProjectContext } from '../../types';
import type { ResolvedActionContext, ExecutionTierId } from '@ant/shared';

export interface LearnCommand {
  action: 'index_branch' | 'index_codebase' | 'learn_files' | 'learn_text';
  branch?: string;
  files?: string[];
  text?: string;
  mode?: 'smart' | 'full';
}

export const LearnAnnotation = Annotation.Root({
  ...TriageableFields,
  command: Annotation<any>,
  targets: Annotation<any>,
  texts: Annotation<any>,
  reportFilePath: Annotation<any>,
  resolvedAction: Annotation<any>,
  executionTier: Annotation<any>,
  // Current user turn id — hydrated by triage (feature.jsonl). Must be a
  // declared channel or it drops at the next node transition; consumed by
  // the E2-5 full-job ask fallback (rich-tail exclusion + distill).
  turnId: Annotation<any>,
} as const);

export interface LearnGraphState extends TriageableState {
  context: ProjectContext;
  deps?: {
    memory?: any;
    chunk?: any;
    git?: any;
    fileSystem?: import('../../../../core/ports').FileSystemPort;
    llm?: any;
    workflowUpdate?: any;
  };
  command?: LearnCommand;
  targets: string[];
  texts: string[];
  reportFilePath?: string;
  resolvedAction?: ResolvedActionContext;
  /** Current user turn id — hydrated by triage from feature.jsonl. */
  turnId?: string;
  /**
   * 5-tier execution strategy. Learn is a read-only indexing job — always
   * Tier 0 Reflex. The runner injects this value at graph start; no LLM
   * judgment is involved.
   */
  executionTier?: ExecutionTierId;
}
