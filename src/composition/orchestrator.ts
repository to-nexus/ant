import { reviewerAgent } from "../agents/reviewer";
import { architectAgent } from "../agents/architect/index";
import { plannerAgent } from "../agents/planner";
import { docAgent } from "../agents/doc";
import { ChromaMemoryAdapter } from "../periphery/adapters/memory/ChromaMemoryAdapter";
import { GenericLLMClient } from "../periphery/adapters/llm/GenericLLMClient";
import { FilePromptAdapter } from "../periphery/adapters/prompt/FilePromptAdapter";
import { SimpleGitAdapter } from "../periphery/adapters/git/SimpleGitAdapter";
import { FileConfigAdapter } from "../periphery/adapters/config/FileConfigAdapter";

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
}) {
  const { type, input, project, inputFile } = params;

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
      const config = new FileConfigAdapter();
      return await architectAgent(input, project || "default", 'design', inputFile, { memory, llm, config });
    }
    
    case "arch-code": {
      const memory = new ChromaMemoryAdapter();
      const llm = new GenericLLMClient('architect');
      const promptPort = new FilePromptAdapter();
      const config = new FileConfigAdapter();
      const configData = await config.load(project || "default");
      const git = new SimpleGitAdapter(project || "default", configData);
      return await architectAgent(input, project || "default", 'code', inputFile, { memory, llm, promptPort, git, config });
    }
    
    case "arch-learn": {
      const memory = new ChromaMemoryAdapter();
      const llm = new GenericLLMClient('architect');
      const config = new FileConfigAdapter();
      return await architectAgent(input, project || "default", 'learn', inputFile, { memory, llm, config });
    }
    
    case "plan": {
      const [issues, commits] = input.split("===COMMITS===");
      const llm = new GenericLLMClient('planner');
      return await plannerAgent(issues, commits, { llm });
    }
    
    case "doc": {
      const llm = new GenericLLMClient('doc');
      return await docAgent(input, { llm });
    }
    
    default:
      throw new Error(`Unknown agent type: ${type}`);
  }
}

