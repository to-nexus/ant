import { ProjectContext } from "../../types";
import { LLMClient } from "../../../../core/ports";

export interface DesignGraphState {
  context: ProjectContext;
  spec: string;
  deps?: {
    llm?: LLMClient;
  };

  previousDesign: string;
  directive: string;
  directiveAnalysis?: string;

  designMarkdown: string;
  designFilePath?: string;
}
