import { ProjectContext, AgentMode, ArchitectResult } from "./types";
import { handleLearnMode } from "./handlers/learn";
import { handleDesignMode } from "./handlers/design";
import { handleCodeMode } from "./handlers/code";
import { extractFeatureFolder } from "./utils";
import { loadProjectGitConfig } from "../../tools/git";
import { getContextMemory } from "./context";

export async function architectAgent(
  spec: string, 
  project: string,
  mode: AgentMode = 'design',
  inputFile?: string
): Promise<ArchitectResult> {
  // Initialize context
  const featureFolder = extractFeatureFolder(inputFile, project);
  
  // 1. 기본 컨텍스트 준비
  const context: ProjectContext = {
    project,
    featureFolder,
    workingDir: process.cwd(),
    config: await loadProjectGitConfig(project),
    memory: await getContextMemory(mode, project, featureFolder)
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
