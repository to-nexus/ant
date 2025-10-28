import { ProjectContext, AgentMode, ArchitectResult } from "./types";
import { extractFeatureFolder } from "./utils";
import { retrieve } from "./memory";
import { MemoryPort, LLMClient, PromptPort, GitPort, ConfigPort } from "../../core/ports";
import { runCodeGraph } from "./graph/code/runner";
import { ArchitectGraphState } from "./graph/code/state";
import { runDesignGraph } from "./graph/design/runner";
import { DesignGraphState } from "./graph/design/state";
import { runLearnGraph } from "./graph/learn/runner";
import { LearnGraphState } from "./graph/learn/state";
import { ArchitectPromptor } from "./prompt/ArchitectPromptor";

export async function architectAgent(
  spec: string, 
  project: string,
  mode: AgentMode = 'design',
  inputFile?: string,
  deps?: { memory?: MemoryPort; llm?: LLMClient; promptPort?: PromptPort; git?: GitPort; config?: ConfigPort }
): Promise<ArchitectResult> {
  // Initialize context
  const featureFolder = extractFeatureFolder(inputFile, project);
  
  // 1. 기본 컨텍스트 준비
  if (!deps?.config) {
    throw new Error("ConfigPort not provided");
  }
  const config = await deps.config.load(project);
  
  const context: ProjectContext = {
    project,
    featureFolder,
    workingDir: process.cwd(),
    config,
    memory: await retrieve(mode, project, featureFolder, deps?.memory ? { memory: deps.memory } : undefined)
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
        deps: {
          llm: deps?.llm
        },
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
      // Initialize prompt engine components
      if (!deps?.promptPort) {
        throw new Error("PromptPort not provided for code generation");
      }
      const promptor = new ArchitectPromptor(deps.promptPort);
      
      const initial: ArchitectGraphState = {
        context,
        spec,
        deps: { 
          memory: deps?.memory, 
          llm: deps?.llm,
          promptor,
          git: deps?.git
        },
        gitPort: deps?.git,
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
