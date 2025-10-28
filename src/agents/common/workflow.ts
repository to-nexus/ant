import { AgentTask, ProjectContext } from "../../core/types";
import { MemoryPort } from "../../core/ports";
import { retrieveMemoryForAgent } from "./retrieve";

/**
 * Common Agent Dependencies
 * All agents receive these dependencies from the orchestrator
 */
export interface AgentDeps {
  memory?: MemoryPort;
  [key: string]: any;
}

/**
 * Agent Result
 * Common return type for all agents
 */
export interface AgentResult {
  success: boolean;
  task: AgentTask;
  message: string;
  data?: any;
  reportFile?: string;
}

/**
 * Agent Workflow Configuration
 * Defines how to execute a specific agent
 */
export interface AgentWorkflowConfig<TInput, TState, TOutput> {
  agentType: AgentTask;
  project: string;
  feature?: string;
  input: TInput;
  deps: AgentDeps;
  
  /**
   * Create initial graph state from input and context
   */
  createInitialState: (input: TInput, context: ProjectContext) => TState;
  
  /**
   * Run the agent's graph
   */
  runGraph: (state: TState) => Promise<TOutput>;
}

/**
 * Execute Agent Workflow
 * 
 * Common workflow for all agents:
 * 1. Retrieve vector memory
 * 2. Create ProjectContext
 * 3. Create initial state
 * 4. Run graph
 * 5. Return result
 * 
 * This ensures consistency across all agents while allowing
 * each agent to have its own graph implementation.
 * 
 * @example
 * ```typescript
 * const result = await executeAgentWorkflow({
 *   agentType: 'review',
 *   project: 'my-app',
 *   input: prDiff,
 *   deps: { memory, llm },
 *   createInitialState: (input, context) => ({
 *     context,
 *     prDiff: input,
 *     deps
 *   }),
 *   runGraph: async (state) => {
 *     // Run reviewer graph
 *     return await runReviewerGraph(state);
 *   }
 * });
 * ```
 */
export async function executeAgentWorkflow<TInput, TState, TOutput>(
  config: AgentWorkflowConfig<TInput, TState, TOutput>
): Promise<TOutput> {
  const {
    agentType,
    project,
    feature,
    input,
    deps,
    createInitialState,
    runGraph
  } = config;
  
  // 1. Retrieve vector memory
  console.log(`🔍 Retrieving memory for ${agentType}...`);
  const memory = await retrieveMemoryForAgent(
    agentType,
    project,
    feature,
    deps
  );
  
  // 2. Create ProjectContext
  const context: ProjectContext = {
    project,
    featureFolder: feature,
    workingDir: process.cwd(),
    memory
  };
  
  // 3. Create initial state
  const initialState = createInitialState(input, context);
  
  // 4. Run graph
  console.log(`🔄 Running ${agentType} graph...`);
  const result = await runGraph(initialState);
  
  return result;
}

/**
 * Simple Agent Executor (for agents without graph)
 * 
 * This is a simplified version for agents that don't need
 * a full graph structure yet. They can still benefit from
 * the common workflow (memory retrieval, context creation).
 * 
 * @example
 * ```typescript
 * const result = await executeSimpleAgent({
 *   agentType: 'review',
 *   project: 'my-app',
 *   input: prDiff,
 *   deps: { memory, llm },
 *   execute: async (input, context, deps) => {
 *     const prompt = buildPrompt(input, context.memory);
 *     return await deps.llm.invoke(prompt);
 *   }
 * });
 * ```
 */
export async function executeSimpleAgent<TInput, TOutput>(
  config: {
    agentType: AgentTask;
    project: string;
    feature?: string;
    input: TInput;
    deps: AgentDeps;
    execute: (input: TInput, context: ProjectContext, deps: AgentDeps) => Promise<TOutput>;
  }
): Promise<TOutput> {
  const { agentType, project, feature, input, deps, execute } = config;
  
  // 1. Retrieve vector memory
  console.log(`🔍 Retrieving memory for ${agentType}...`);
  const memory = await retrieveMemoryForAgent(
    agentType,
    project,
    feature,
    deps
  );
  
  // 2. Create ProjectContext
  const context: ProjectContext = {
    project,
    featureFolder: feature,
    workingDir: process.cwd(),
    memory
  };
  
  // 3. Execute
  console.log(`⚡ Executing ${agentType}...`);
  const result = await execute(input, context, deps);
  
  return result;
}

