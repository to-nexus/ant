import { ProjectContext } from "../../types";
import { TriageableState, TriageResult, WorkspaceState } from "../../../common/nodes/triage/types";
import { TokenUsage } from "../common/llmHelpers";

export interface LearnCommand {
  action: 'index_branch' | 'index_codebase' | 'learn_files' | 'learn_text';
  branch?: string;
  files?: string[];
  text?: string;
  mode?: 'smart' | 'full';
}

export interface LearnGraphState extends TriageableState {
  context: ProjectContext;
  
  // Dependencies
  deps?: {
    memory?: any;
    chunk?: any;
    git?: any;
    fileSystem?: import('../../../../core/ports').FileSystemPort;
    llm?: any;
    workflowUpdate?: any;  // ✅ For triage
  };

  command?: LearnCommand;
  targets: string[]; // file/dir paths parsed from spec (optional)
  texts: string[];   // collected texts (files or raw)

  reportFilePath?: string;
  
  // ✅ Triage System
  triageResult?: TriageResult;
  workspaceState?: WorkspaceState;
  overrideDirective?: string;
  skipTriage?: boolean;
  currentJob?: string;
  currentAgent?: string;
  _httpJobId?: string;
  
  // ✅ Token tracking
  tokenUsage?: TokenUsage;
}
