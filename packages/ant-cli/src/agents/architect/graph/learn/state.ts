import { ProjectContext } from "../../types";
import { TriageableState } from "../../../common/nodes/triage/types";
import type { ResolvedActionContext } from '@ant/shared';

export interface LearnCommand {
  action: 'index_branch' | 'index_codebase' | 'learn_files' | 'learn_text';
  branch?: string;
  files?: string[];
  text?: string;
  mode?: 'smart' | 'full';
}

export interface LearnGraphState extends TriageableState {
  context: ProjectContext;
  
  // Dependencies (extends TriageableState.deps)
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
