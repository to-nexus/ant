import { reviewerAgent } from "../agents/reviewer";
import { architectAgent } from "../agents/architect/index";
import { plannerAgent } from "../agents/planner";
import { docAgent } from "../agents/doc";
import { ChromaMemoryAdapter } from "../periphery/adapters/memory/ChromaMemoryAdapter";
import { createLLMClient } from "../periphery/adapters/llm/LLMClientFactory";
import { FilePromptAdapter } from "../periphery/adapters/prompt/FilePromptAdapter";
import { FileProfileAdapter } from "../periphery/adapters/profile/FileProfileAdapter";
import { CodebaseAnalyzer } from "../periphery/adapters/analyzer/CodebaseAnalyzer";
import { SimpleGitAdapter } from "../periphery/adapters/git/SimpleGitAdapter";
import { FileConfigAdapter } from "../periphery/adapters/config/FileConfigAdapter";
import { FileSessionAdapter } from "../periphery/adapters/session/FileSessionAdapter";
import { ChunkAdapter } from "../periphery/adapters/chunk/ChunkingAdapter";
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
  task?: "design" | "code" | "learn" | "review" | "plan" | "doc";
  input: string;
  project?: string;
  inputFile?: string;
  mode?: 'generate' | 'refactor' | 'explain';
  enableEvaluation?: boolean;
  taskId?: string;  // ✅ For real-time Kanban tracking
  featurePath?: string;  // ✅ Full feature path for Cloud mode
  projectPath?: string;  // ✅ Full project path for Cloud mode
  workspaceResolver?: import('../infrastructure/workspace/WorkspaceResolver').WorkspaceResolver;  // ✅ NEW: Inject resolver
  userContext?: import('../core/types/user').UserContext;  // ✅ NEW: User context for Cloud mode
}) {
  const { agent, task, input, project, inputFile, mode, enableEvaluation, taskId, featurePath, projectPath, workspaceResolver, userContext } = params;

  switch (agent) {
    case "architect": {
      if (!task || !['design', 'code', 'learn'].includes(task)) {
        throw new Error(`Architect agent requires task: 'design', 'code', or 'learn'`);
      }

      // Common dependencies for architect
      const memory = new ChromaMemoryAdapter();
      const config = new FileConfigAdapter();
      
      // Load project config for git/repo and LLM settings
      let configData = await config.load(project || "default");
      // Inject projectPath into configData for cloud mode
      if (configData.repoType === "cloud" && projectPath) {
        configData.projectPath = projectPath;
      }
      
      // LLM configuration priority: workspace config > environment variables
      // Environment variables: ARCHITECT_MODEL_PROVIDER, ARCHITECT_MODEL_NAME, AI_MODEL_PROVIDER, AI_MODEL_NAME
      const llm = createLLMClient('architect', {
        llmProvider: configData.llmProvider,
        llmModel: configData.llmModel
      });

      if (task === 'learn') {
        // Learn task: minimal dependencies
        return await architectAgent(input, project || "default", 'learn', inputFile, { memory, llm, config, userContext });
      }

      // Design and Code tasks: full dependencies
      const promptPort = new FilePromptAdapter();
      const profilePort = new FileProfileAdapter();
      const chunk = new ChunkAdapter();
      
      // ✅ Require featurePath and projectPath - no fallback
      if (!featurePath || !projectPath) {
        throw new Error('featurePath and projectPath are required for design/code tasks');
      }
      
      // ✅ Extract featureName from featurePath
      const featureName = featurePath.split(path.sep).filter(Boolean).pop() || 'unknown';

      if (task === 'design') {
        const analyzer = new CodebaseAnalyzer();
        const git = new SimpleGitAdapter(project || "default", configData, projectPath);  // ✅ Pass projectPath
        
        // ✅ Get ExpressServerAdapter instance for real-time updates
        let kanbanUpdate: TaskQueueUpdatePort | undefined = undefined;
        let fileTreeUpdate: FileTreeUpdatePort | undefined = undefined;
        let workflowUpdate: WorkflowStateUpdatePort | undefined = undefined;
        
        try {
          const { ExpressServerAdapter } = await import('../periphery/adapters/http/ExpressServerAdapter');
          const instance = ExpressServerAdapter.getInstance();
          
          if (instance) {
            // 부모 프로세스 (서버 실행 중): 직접 참조 사용
            kanbanUpdate = instance;
            fileTreeUpdate = instance;
            workflowUpdate = instance;
            console.log('✅ Real-time updates enabled (Direct - Kanban + File Tree + Workflow) [Design]');
          } else if (process.env.ANT_SERVER_PORT) {
            // 자식 프로세스: HTTP 클라이언트 사용
            const { WorkflowHttpClient, KanbanHttpClient } = await import('../periphery/adapters/http/clients');
            kanbanUpdate = new KanbanHttpClient(process.env.ANT_SERVER_PORT);
            workflowUpdate = new WorkflowHttpClient(process.env.ANT_SERVER_PORT);
            console.log('✅ Real-time updates enabled (HTTP - Kanban + Workflow) [Design]');
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
          { memory, llm, promptPort, profilePort, config, chunk, session, git, analyzer, kanbanUpdate, fileTreeUpdate, workflowUpdate, workspaceResolver, userContext },
          undefined,  // codeMode
          undefined,  // enableEvaluation
          taskId      // ✅ Pass taskId for real-time Kanban
        );
      }

      if (task === 'code') {
        const analyzer = new CodebaseAnalyzer();
        const git = new SimpleGitAdapter(project || "default", configData, projectPath);  // ✅ Pass projectPath
        const command = new NodeCommandAdapter();
        
        // ✅ Get ExpressServerAdapter instance for real-time updates
        let kanbanUpdate: TaskQueueUpdatePort | undefined = undefined;
        let fileTreeUpdate: FileTreeUpdatePort | undefined = undefined;
        let workflowUpdate: WorkflowStateUpdatePort | undefined = undefined;
        
        try {
          const { ExpressServerAdapter } = await import('../periphery/adapters/http/ExpressServerAdapter');
          const instance = ExpressServerAdapter.getInstance();
          
          if (instance) {
            // 부모 프로세스 (서버 실행 중): 직접 참조 사용
            kanbanUpdate = instance;
            fileTreeUpdate = instance;
            workflowUpdate = instance;
            console.log('✅ Real-time updates enabled (Direct - Kanban + File Tree + Workflow)');
          } else if (process.env.ANT_SERVER_PORT) {
            // 자식 프로세스: HTTP 클라이언트 사용
            const { WorkflowHttpClient, KanbanHttpClient } = await import('../periphery/adapters/http/clients');
            kanbanUpdate = new KanbanHttpClient(process.env.ANT_SERVER_PORT);
            workflowUpdate = new WorkflowHttpClient(process.env.ANT_SERVER_PORT);
            console.log('✅ Real-time updates enabled (HTTP - Kanban + Workflow)');
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
          { memory, llm, promptPort, profilePort, analyzer, git, config, chunk, session, command, kanbanUpdate, fileTreeUpdate, workflowUpdate, workspaceResolver, userContext },
          mode,              // Can be undefined (auto-infer) or explicit
          enableEvaluation,  // Pass evaluation flag
          taskId             // ✅ Pass taskId for real-time updates
        );
      }

      throw new Error(`Unknown architect task: ${task}`);
    }

    case "reviewer": {
      const memory = new ChromaMemoryAdapter();
      const config = new FileConfigAdapter();
      const configData = await config.load(project || "default");
      const llm = createLLMClient('reviewer', {
        llmProvider: configData.llmProvider,
        llmModel: configData.llmModel
      });
      return await reviewerAgent(input, project || "default", { memory, llm });
    }

    case "planner": {
      const [issues, commits] = input.split("===COMMITS===");
      const memory = new ChromaMemoryAdapter();
      const config = new FileConfigAdapter();
      const configData = await config.load(project || "default");
      const llm = createLLMClient('planner', {
        llmProvider: configData.llmProvider,
        llmModel: configData.llmModel
      });
      return await plannerAgent({ issues, commits }, project || "default", { memory, llm });
    }

    case "doc": {
      const memory = new ChromaMemoryAdapter();
      const config = new FileConfigAdapter();
      const configData = await config.load(project || "default");
      const llm = createLLMClient('doc', {
        llmProvider: configData.llmProvider,
        llmModel: configData.llmModel
      });
      return await docAgent(input, project || "default", { memory, llm });
    }


    default:
      throw new Error(`Unknown agent: ${agent}`);
  }
}

