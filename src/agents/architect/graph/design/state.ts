import { ProjectContext } from "../../types";

export interface DesignGraphState {
  context: ProjectContext;
  spec: string;

  previousDesign: string;
  directive: string;
  directiveAnalysis?: string;

  designMarkdown: string;
  designFilePath?: string;
}
