import { ProjectContext, AgentTask, CodeMode, ArchitectResult } from "./types";
import { extractFeatureFolder } from "./utils";
import { retrieve } from "./memory";
import { inferCodeMode } from "./modeInference";
import { MemoryPort, LLMClient, PromptPort, GitPort, ConfigPort, CodebaseAnalyzerPort, ProfilePort } from "../../core/ports";
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
  task: AgentTask = 'design',
  inputFile?: string,
  deps?: { 
    memory?: MemoryPort; 
    llm?: LLMClient; 
    promptPort?: PromptPort; 
    profilePort?: ProfilePort;
    analyzer?: CodebaseAnalyzerPort;
    git?: GitPort; 
    config?: ConfigPort;
  },
  codeMode?: CodeMode
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
    memory: await retrieve(task, project, featureFolder, deps?.memory ? { memory: deps.memory } : undefined)
  };

  // Call appropriate handler based on task
  switch (task) {
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
        task: 'learn',
        reportFile: '',
        message: `Stored ${l.stored} learning chunk(s) to vector memory.`
      };
    case 'design':
      // Run via design graph
      if (!deps?.promptPort) {
        throw new Error("PromptPort not provided for design generation");
      }
      const designPromptor = new ArchitectPromptor(deps.promptPort, deps.profilePort);

      const dInitial: DesignGraphState = {
        context,
        spec,
        deps: {
          llm: deps?.llm,
          promptor: designPromptor
        },
        previousDesign: "",
        directive: "",
        planText: "",
        designMarkdown: ""
      };
      const d = await runDesignGraph(dInitial);
      return {
        success: true,
        task: 'design',
        reportFile: d.designFilePath,
        message: `Design document created at ${d.designFilePath}. Review and approve before generating code.`
      };
    case 'code':
      // Run via code graph
      // Initialize prompt engine components
      if (!deps?.promptPort) {
        throw new Error("PromptPort not provided for code generation");
      }
      const promptor = new ArchitectPromptor(deps.promptPort, deps.profilePort);
      
      const initial: ArchitectGraphState = {
        context,
        spec,
        deps: { 
          memory: deps?.memory, 
          llm: deps?.llm,
          promptor,
          analyzer: deps?.analyzer,
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
        codeMode: codeMode, // Will be inferred in graph nodes
        codebaseProfile: null  // Will be detected in resolve node
      };
      const result = await runCodeGraph(initial);
      return {
        success: true,
        task: 'code',
        reportFile: result.reportFile,
        filesAnalyzed: result.filesChanged,
        message: result.filesChanged > 0
          ? `${result.filesChanged} files changed. Review with 'git diff' and commit when ready.`
          : `No code changes generated. See report for plan and learnings.`
      };
    default:
      throw new Error(`Unknown task: ${task}`);
  }
}
