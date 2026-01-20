import { reviewerAgent } from "../agents/reviewer";
import { architectAgent } from "../agents/architect/index";
import { plannerAgent } from "../agents/planner";
import { docAgent } from "../agents/doc";
import { AdapterFactory } from "../infrastructure/adapters/AdapterFactory";
import { createLLMClient } from "../periphery/adapters/llm/LLMClientFactory";
import { FilePromptAdapter } from "../periphery/adapters/prompt/FilePromptAdapter";
import { FileProfileAdapter } from "../periphery/adapters/profile/FileProfileAdapter";
import { CodebaseAnalyzer } from "../periphery/adapters/analyzer/CodebaseAnalyzer";
import { FileConfigAdapter } from "../periphery/adapters/config/FileConfigAdapter";
import { FileSessionAdapter } from "../periphery/adapters/session/FileSessionAdapter";
import { NodeCommandAdapter } from "../periphery/adapters/command/NodeCommandAdapter";
import { TaskQueueUpdatePort, FileTreeUpdatePort } from "../core/ports";
import { WorkflowStateUpdatePort } from "../core/ports/workflow";
import { getChatAPIClient } from "../core/adapters/ChatAPIClient";
import * as path from "path";

/**
 * Orchestrator: Composition Root
 * 
 * Responsibilities:
 * 1. Instantiate adapters (periphery implementations)
 * 2. Inject dependencies into agents
 * 3. Route commands: agent → task → mode (hierarchical)
 * 
 * This is the only place where concrete implementations are wired together.
 */
export async function orchestrator(params: {
  agent: "architect" | "reviewer" | "planner" | "doc";
  jobType?: "design" | "code" | "learn" | "review" | "plan" | "doc";  // ✅ Type of job to execute
  input: string;
  project?: string;
  feature?: string;  // ✅ Feature name (for chat jobs without inputFile)
  inputFile?: string;
  mode?: 'generate' | 'refactor' | 'explain';
  enableEvaluation?: boolean;
  jobId?: string;  // ✅ Existing jobId for resume or tracking
  featurePath?: string;  // ✅ Full feature path
  projectPath?: string;  // ✅ Full project path
  workspaceResolver?: any;  // ✅ Workspace resolver for tenant-aware path resolution
  userContext?: any;  // ✅ User context
  overrideDirective?: string;  // ✅ Chat input as directive (highest priority)
  chatSource?: boolean;  // ✅ Flag for Chat SSE
}) {
  const { agent, jobType, input, project, feature, inputFile, mode, enableEvaluation, jobId, featurePath, projectPath, workspaceResolver, userContext, overrideDirective, chatSource } = params;

  switch (agent) {
    case "architect": {
      if (!jobType || !['design', 'code', 'learn'].includes(jobType)) {
        throw new Error(`Architect agent requires jobType: 'design', 'code', or 'learn'`);
      }

      // Common dependencies for architect
      const memory = AdapterFactory.createMemoryAdapter();
      const config = new FileConfigAdapter();
      
      // Load project config for git/repo and LLM settings
      let configData = await config.load(project || "default");
      // Inject projectPath into configData for cloud mode
      if (configData.repoType === "cloud" && projectPath) {
        configData.projectPath = projectPath;
      }
      
      // LLM configuration - pass workspaceConfig for job/node-specific model selection
      // ✅ Create LLM with job context (nodes will override with specific nodeType if needed)
      const llm = createLLMClient('architect', undefined, { jobType: jobType as 'design' | 'code' | 'learn' }, configData);

      if (jobType === 'learn') {
        // Learn task: requires Git and Chunk for indexing
        const chunk = AdapterFactory.createChunkAdapter();
        const git = projectPath ? AdapterFactory.createGitAdapterWithConfig(project || "default", configData, projectPath) : undefined;
        
        return await architectAgent(input, project || "default", 'learn', inputFile, { 
          memory, 
          llm, 
          chunk, 
          git, 
          config
        });
      }

      // Design and Code tasks: full dependencies
      const promptPort = new FilePromptAdapter();
      const profilePort = new FileProfileAdapter();
      const chunk = AdapterFactory.createChunkAdapter();
      
      // ✅ Require featurePath and projectPath - no fallback
      if (!featurePath || !projectPath) {
        throw new Error('featurePath and projectPath are required for design/code tasks');
      }
      
      // ✅ Extract featureName from featurePath
      const featureName = featurePath.split(path.sep).filter(Boolean).pop() || 'unknown';
      
      // ✅ Get FileSystemPort and GitPort (separated responsibilities)
      const codebasePath = path.join(projectPath, 'codebase');
      const fileSystem = AdapterFactory.createFileSystemAdapterWithPath(projectPath);  // ✅ Use projectPath for full workspace access
      const git = AdapterFactory.createGitAdapterWithConfig(project || "default", configData, codebasePath);

      if (jobType === 'design') {
        const analyzer = new CodebaseAnalyzer();
        
        // ✅ Get ExpressServerAdapter instance for real-time updates
        let kanbanUpdate: TaskQueueUpdatePort | undefined = undefined;
        let fileTreeUpdate: FileTreeUpdatePort | undefined = undefined;
        let workflowUpdate: WorkflowStateUpdatePort | undefined = undefined;
        
        try {
          const { ExpressServerAdapter } = await import('../periphery/adapters/http/express');
          const instance = ExpressServerAdapter.getInstance();
          
          if (instance) {
            // 부모 프로세스 (서버 실행 중): 직접 참조 사용
            kanbanUpdate = instance;
            fileTreeUpdate = instance;
            workflowUpdate = instance;
            console.log('✅ Real-time updates enabled (Direct - Kanban + File Tree + Workflow) [Design]');
          } else if (process.env.ANT_CLI_PORT) {
            // 자식 프로세스: HTTP 클라이언트 사용
            const { WorkflowHttpClient, KanbanHttpClient, FileTreeHttpClient } = await import('../periphery/adapters/http/clients');
            kanbanUpdate = new KanbanHttpClient(process.env.ANT_CLI_PORT || '4100');
            fileTreeUpdate = new FileTreeHttpClient(process.env.ANT_CLI_PORT || '4100');
            workflowUpdate = new WorkflowHttpClient(process.env.ANT_CLI_PORT || '4100');
            console.log('✅ Real-time updates enabled (HTTP - Kanban + File Tree + Workflow) [Design]');
          } else {
            console.log('ℹ️  Real-time updates disabled (no server instance or port) [Design]');
          }
        } catch (error) {
          console.log('ℹ️  Real-time updates disabled (server not running) [Design]');
        }
        
        // ✅ Create session with file tree update support
        const session = new FileSessionAdapter(featurePath, project, featureName, fileTreeUpdate);
        
        return await architectAgent(
          input, 
          project || "default", 
          'design', 
          inputFile, 
          { memory, llm, promptPort, profilePort, config, chunk, session, git, fileSystem, analyzer, kanbanUpdate, fileTreeUpdate, workflowUpdate, workspaceResolver, userContext, overrideDirective, chatSource, feature },
          undefined,  // codeMode
          undefined,  // enableEvaluation
          jobId       // ✅ Pass jobId for real-time Kanban and resume
        );
      }

      if (jobType === 'code') {
        const analyzer = new CodebaseAnalyzer();
        const command = new NodeCommandAdapter();
        
        // ✅ Get ExpressServerAdapter instance for real-time updates
        let kanbanUpdate: TaskQueueUpdatePort | undefined = undefined;
        let fileTreeUpdate: FileTreeUpdatePort | undefined = undefined;
        let workflowUpdate: WorkflowStateUpdatePort | undefined = undefined;
        
        try {
          const { ExpressServerAdapter } = await import('../periphery/adapters/http/express');
          const instance = ExpressServerAdapter.getInstance();
          
          if (instance) {
            // 부모 프로세스 (서버 실행 중): 직접 참조 사용
            kanbanUpdate = instance;
            fileTreeUpdate = instance;
            workflowUpdate = instance;
            console.log('✅ Real-time updates enabled (Direct - Kanban + File Tree + Workflow)');
          } else if (process.env.ANT_CLI_PORT) {
            // 자식 프로세스: HTTP 클라이언트 사용
            const { WorkflowHttpClient, KanbanHttpClient, FileTreeHttpClient } = await import('../periphery/adapters/http/clients');
            kanbanUpdate = new KanbanHttpClient(process.env.ANT_CLI_PORT || '4100');
            fileTreeUpdate = new FileTreeHttpClient(process.env.ANT_CLI_PORT || '4100');
            workflowUpdate = new WorkflowHttpClient(process.env.ANT_CLI_PORT || '4100');
            console.log('✅ Real-time updates enabled (HTTP - Kanban + File Tree + Workflow)');
          } else {
            console.log('ℹ️  Real-time updates disabled (no server instance or port)');
          }
        } catch (error) {
          console.log('ℹ️  Real-time updates disabled (server not running)');
        }
        
        // ✅ Create session with file tree update support
        const session = new FileSessionAdapter(featurePath, project, featureName, fileTreeUpdate);
        
        // Mode will be inferred or auto-determined in architect agent
        return await architectAgent(
          input, 
          project || "default", 
          'code', 
          inputFile, 
          { memory, llm, promptPort, profilePort, analyzer, git, fileSystem, config, chunk, session, command, kanbanUpdate, fileTreeUpdate, workflowUpdate, workspaceResolver, userContext, overrideDirective, chatSource, feature },
          mode,              // Can be undefined (auto-infer) or explicit
          enableEvaluation,  // Pass evaluation flag
          jobId              // ✅ Pass jobId for real-time updates and resume
        );
      }

      throw new Error(`Unknown architect jobType: ${jobType}`);
    }

    case "reviewer": {
      const memory = AdapterFactory.createMemoryAdapter();
      const config = new FileConfigAdapter();
      const configData = await config.load(project || "default");
      const llm = createLLMClient('reviewer', undefined, undefined, configData);
      return await reviewerAgent(input, project || "default", { memory, llm });
    }

    case "planner": {
      const [issues, commits] = input.split("===COMMITS===");
      const memory = AdapterFactory.createMemoryAdapter();
      const config = new FileConfigAdapter();
      const configData = await config.load(project || "default");
      const llm = createLLMClient('planner', undefined, undefined, configData);
      return await plannerAgent({ issues, commits }, project || "default", { memory, llm });
    }

    case "doc": {
      const memory = AdapterFactory.createMemoryAdapter();
      const config = new FileConfigAdapter();
      const configData = await config.load(project || "default");
      const llm = createLLMClient('doc', undefined, undefined, configData);
      return await docAgent(input, project || "default", { memory, llm });
    }


    default:
      throw new Error(`Unknown agent: ${agent}`);
  }
}

