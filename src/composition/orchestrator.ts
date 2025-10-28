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
import * as path from "path";

/**
 * Orchestrator: Composition Root
 * 
 * Responsibilities:
 * 1. Instantiate adapters (periphery implementations)
 * 2. Inject dependencies into agents
 * 3. Route commands to appropriate agents
 * 
 * This is the only place where concrete implementations are wired together.
 */
export async function orchestrator(params: {
  type: "review" | "arch-design" | "arch-code" | "arch-learn" | "plan" | "doc";
  input: string;
  project?: string;
  inputFile?: string;
  codeMode?: 'generate' | 'edit' | 'refactor' | 'explain';
}) {
  const { type, input, project, inputFile, codeMode } = params;

  switch (type) {
    case "review": {
      const memory = new ChromaMemoryAdapter();
      const llm = new GenericLLMClient('reviewer');
      const config = new FileConfigAdapter();
      return await reviewerAgent(input, project || "default", { memory, llm });
    }
    
    case "arch-design": {
      const memory = new ChromaMemoryAdapter();
      const llm = new GenericLLMClient('architect');
      const promptPort = new FilePromptAdapter();
      const profilePort = new FileProfileAdapter();
      const config = new FileConfigAdapter();
      const chunk = new ChunkAdapter();
      const workspaceRoot = path.join(process.cwd(), "workspace");
      const session = new FileSessionAdapter(workspaceRoot);
      return await architectAgent(input, project || "default", 'design', inputFile, { memory, llm, promptPort, profilePort, config, chunk, session });
    }
    
    case "arch-code": {
      const memory = new ChromaMemoryAdapter();
      const llm = new GenericLLMClient('architect');
      const promptPort = new FilePromptAdapter();
      const profilePort = new FileProfileAdapter();
      const analyzer = new CodebaseAnalyzer();
      const config = new FileConfigAdapter();
      const chunk = new ChunkAdapter();
      const configData = await config.load(project || "default");
      const git = new SimpleGitAdapter(project || "default", configData);
      const workspaceRoot = path.join(process.cwd(), "workspace");
      const session = new FileSessionAdapter(workspaceRoot);
      
      const codeMode = undefined; // Will be inferred in graph nodes
      
      return await architectAgent(input, project || "default", 'code', inputFile, { memory, llm, promptPort, profilePort, analyzer, git, config, chunk, session }, codeMode);
    }
    
    case "arch-learn": {
      const memory = new ChromaMemoryAdapter();
      const llm = new GenericLLMClient('architect');
      const config = new FileConfigAdapter();
      return await architectAgent(input, project || "default", 'learn', inputFile, { memory, llm, config });
    }
    
    case "plan": {
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
      throw new Error(`Unknown agent type: ${type}`);
  }
}

