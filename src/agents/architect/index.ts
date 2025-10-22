import { ProjectContext, AgentMode, ArchitectResult } from "./types";
import { handleLearnMode } from "./handlers/learn";
import { handleDesignMode } from "./handlers/design";
import { handleCodeMode } from "./handlers/code";
import { extractFeatureFolder } from "./utils";
import { loadProjectGitConfig } from "../../tools/git";
import { queryMemory } from "../../memory/chroma";

export async function architectAgent(
  spec: string, 
  project: string,
  mode: AgentMode = 'design',
  inputFile?: string
): Promise<ArchitectResult> {
  // Initialize context
  const context: ProjectContext = {
    project,
    featureFolder: extractFeatureFolder(inputFile, project),
    workingDir: process.cwd(),
    config: await loadProjectGitConfig(project),
    memory: await queryMemory("architecture principles", project)
  };

  // Call appropriate handler based on mode
  switch (mode) {
    case 'learn':
      return await handleLearnMode(context);
    case 'design':
      return await handleDesignMode(context, spec);
    case 'code':
      return await handleCodeMode(context, spec);
    default:
      throw new Error(`Unknown mode: ${mode}`);
  }
}
