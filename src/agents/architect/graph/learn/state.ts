import { ProjectContext } from "../../types";

export interface LearnGraphState {
  context: ProjectContext;
  spec: string; // raw directive or free text

  targets: string[]; // file/dir paths parsed from spec (optional)
  texts: string[];   // collected texts (files or raw)

  reportFilePath?: string;
}
