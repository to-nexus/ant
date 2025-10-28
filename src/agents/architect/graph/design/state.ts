import { ProjectContext } from "../../types";
import { LLMClient } from "../../../../core/ports";
import { PromptEngine } from "../../../../core/prompt/engine";

export interface DesignGraphState {
  context: ProjectContext;
  spec: string;
  deps?: {
    llm?: LLMClient;
    promptEngine?: PromptEngine;
  };

  previousDesign: string;
  directive: string;

  planText: string;
  designMarkdown: string;
  
  // Results after saving (populated by learn node)
  designFilePath?: string;
  learnings?: string;
}
