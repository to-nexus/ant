import { ProjectContext, AgentMode, ArchitectResult } from "./types";
import { extractFeatureFolder } from "./utils";
import { loadProjectGitConfig } from "../../tools/git";
import { getContextMemory } from "./context";
import { runCodeGraph } from "./graph/code/runner";
import { ArchitectGraphState } from "./graph/state";
import { runDesignGraph } from "./graph/design/runner";
import { DesignGraphState } from "./graph/design/state";
import { runLearnGraph } from "./graph/learn/runner";
import { LearnGraphState } from "./graph/learn/state";

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
      // Generic learn: accept repo files or free-form text in spec
      const lInitial: LearnGraphState = {
        context,
        spec,
        targets: [],
        texts: []
      };
      const l = await runLearnGraph(lInitial);
      return {
        success: true,
        mode: 'learn',
        reportFile: '',
        message: `Stored ${l.stored} learning chunk(s) to vector memory.`
      };
    case 'design':
      // Run via design graph
      const dInitial: DesignGraphState = {
        context,
        spec,
        previousDesign: "",
        directive: "",
        designMarkdown: ""
      };
      const d = await runDesignGraph(dInitial);
      return {
        success: true,
        mode: 'design',
        reportFile: d.designFilePath,
        message: `Design document created at ${d.designFilePath}. Review and approve before generating code.`
      };
    case 'code':
      // Run via code graph
      const initial: ArchitectGraphState = {
        context,
        spec,
        latestDesign: "",
        directive: "",
        originalFilesBlock: "",
        planText: "",
        codePrompt: "",
        rawResponse: "",
        files: [],
        filesToDelete: [],
        requiredIntegrations: [],
        retries: 0,
        maxRetries: 1,
      };
      const result = await runCodeGraph(initial);
      return {
        success: true,
        mode: 'code',
        reportFile: result.reportFile,
        filesAnalyzed: result.filesChanged,
        message: result.filesChanged > 0
          ? `${result.filesChanged} files changed. Review with 'git diff' and commit when ready.`
          : `No code changes generated. See report for plan and learnings.`
      };
    default:
      throw new Error(`Unknown mode: ${mode}`);
  }
}
