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
import type { ResolvedActionContext } from '@ant/shared';

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
}
