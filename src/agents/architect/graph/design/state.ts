import { ProjectContext } from "../../types";
import { LLMClient } from "../../../../core/ports";
import { ArchitectPromptor } from "../../prompt/ArchitectPromptor";

export interface DesignGraphState {
  context: ProjectContext;
  spec: string;
  deps?: {
    llm?: LLMClient;
    promptor?: ArchitectPromptor;
  };

  previousDesign: string;
  directive: string;

  planText: string;
  designMarkdown: string;
  designFilePath?: string;
}
