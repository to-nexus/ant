import { reviewerAgent } from "../agents/reviewer";
import { architectAgent } from "../agents/architect/index";
import { plannerAgent } from "../agents/planner";
import { docAgent } from "../agents/doc";
import { ChromaMemoryAdapter } from "../periphery/adapters/memory/ChromaMemoryAdapter";
import { GenericLLMClient } from "../periphery/adapters/llm/GenericLLMClient";
import { FilePromptAdapter } from "../periphery/adapters/prompt/FilePromptAdapter";
import { FileProfileAdapter } from "../periphery/adapters/profile/FileProfileAdapter";
import { CodebaseAnalyzer } from "../periphery/adapters/analyzer/CodebaseAnalyzer";
import { SimpleGitAdapter } from "../periphery/adapters/git/SimpleGitAdapter";
import { FileConfigAdapter } from "../periphery/adapters/config/FileConfigAdapter";
import { FileSessionAdapter } from "../periphery/adapters/session/FileSessionAdapter";
import { ChunkAdapter } from "../periphery/adapters/chunk/ChunkingAdapter";
import { NodeCommandAdapter } from "../periphery/adapters/command/NodeCommandAdapter";
import { TaskQueueUpdatePort } from "../core/ports";
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
}) {
  const { agent, task, input, project, inputFile, mode, enableEvaluation, taskId } = params;

  switch (agent) {
    case "architect": {
      if (!task || !['design', 'code', 'learn'].includes(task)) {
        throw new Error(`Architect agent requires task: 'design', 'code', or 'learn'`);
      }

      // Common dependencies for architect
      const memory = new ChromaMemoryAdapter();
      const config = new FileConfigAdapter();
      
      // LLM is configured via environment variables (AI_MODEL_PROVIDER, AI_MODEL_NAME, etc.)
      const llm = new GenericLLMClient('architect');
      
      // Load project config for git/repo settings
      const configData = await config.load(project || "default");

      if (task === 'learn') {
        // Learn task: minimal dependencies
        return await architectAgent(input, project || "default", 'learn', inputFile, { memory, llm, config });
      }

      // Design and Code tasks: full dependencies
      const promptPort = new FilePromptAdapter();
      const profilePort = new FileProfileAdapter();
      const chunk = new ChunkAdapter();
      // workspace is at project root (../../workspace from packages/ant-cli)
      const workspaceRoot = path.join(process.cwd(), "../../workspace");
      const session = new FileSessionAdapter(workspaceRoot);

      if (task === 'design') {
        const analyzer = new CodebaseAnalyzer();
        const git = new SimpleGitAdapter(project || "default", configData);
        
        return await architectAgent(
          input, 
          project || "default", 
          'design', 
          inputFile, 
          { memory, llm, promptPort, profilePort, config, chunk, session, git, analyzer },
          undefined,  // codeMode
          undefined,  // enableEvaluation
          taskId      // ✅ Pass taskId for real-time Kanban
        );
      }

      if (task === 'code') {
        const analyzer = new CodebaseAnalyzer();
        const git = new SimpleGitAdapter(project || "default", configData);
        const command = new NodeCommandAdapter();
        
        // ✅ Get ExpressServerAdapter instance for real-time updates
        let kanbanUpdate: TaskQueueUpdatePort | undefined = undefined;
        let fileTreeUpdate: import('../core/ports').FileTreeUpdatePort | undefined = undefined;
        try {
          const { ExpressServerAdapter } = await import('../periphery/adapters/http/ExpressServerAdapter');
          const instance = ExpressServerAdapter.getInstance();
          kanbanUpdate = instance || undefined;  // Convert null to undefined
          fileTreeUpdate = instance || undefined;  // Same instance implements both ports
          if (kanbanUpdate) {
            console.log('✅ Real-time updates enabled (Kanban + File Tree)');
          }
        } catch (error) {
          console.log('ℹ️  Real-time updates disabled (server not running)');
        }
        
        // Mode will be inferred or auto-determined in architect agent
        return await architectAgent(
          input, 
          project || "default", 
          'code', 
          inputFile, 
          { memory, llm, promptPort, profilePort, analyzer, git, config, chunk, session, command, kanbanUpdate, fileTreeUpdate },
          mode,              // Can be undefined (auto-infer) or explicit
          enableEvaluation,  // Pass evaluation flag
          taskId             // ✅ Pass taskId for real-time updates
        );
      }

      throw new Error(`Unknown architect task: ${task}`);
    }

    case "reviewer": {
      const memory = new ChromaMemoryAdapter();
      const llm = new GenericLLMClient('reviewer');
      return await reviewerAgent(input, project || "default", { memory, llm });
    }

    case "planner": {
      const [issues, commits] = input.split("===COMMITS===");
      const memory = new ChromaMemoryAdapter();
      const llm = new GenericLLMClient('planner');
      return await plannerAgent({ issues, commits }, project || "default", { memory, llm });
    }

    case "doc": {
      const memory = new ChromaMemoryAdapter();
      const llm = new GenericLLMClient('doc');
      return await docAgent(input, project || "default", { memory, llm });
    }


    default:
      throw new Error(`Unknown agent: ${agent}`);
  }
}

