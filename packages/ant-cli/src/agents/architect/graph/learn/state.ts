import { ProjectContext } from "../../types";

export interface LearnCommand {
  action: 'index_branch' | 'index_codebase' | 'learn_files' | 'learn_text';
  branch?: string;
  files?: string[];
  text?: string;
  mode?: 'smart' | 'full';
}

export interface LearnGraphState {
  context: ProjectContext;
  spec: string; // raw directive or free text
  
  // Dependencies
  deps?: {
    memory?: any;
    chunk?: any;
    git?: any;
    llm?: any;  // ✅ LLM for analysis
  };

  command?: LearnCommand;  // ✅ LLM의 정규화된 명령
  targets: string[]; // file/dir paths parsed from spec (optional)
  texts: string[];   // collected texts (files or raw)

  reportFilePath?: string;
}
