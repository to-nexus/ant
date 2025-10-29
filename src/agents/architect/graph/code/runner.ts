import { ArchitectGraphState } from "./state";
import { buildCodeGraph } from "./graph";
import { BatchCodeRunner, BatchRunResult } from "./BatchCodeRunner";
import { LLMClient } from "../../../../core/ports";
import { PromptEngine } from "../../../../core/prompt/engine";

/**
 * Code Graph Runner
 * 
 * Responsibility: Execute the graph and return results
 * All side effects (file saving, memory storage) are handled inside the graph
 */
export async function runCodeGraph(initial: ArchitectGraphState) {
  const app = buildCodeGraph();
  const state = await (app as any).invoke(initial as any) as ArchitectGraphState;

  // Return results (all saving was done in learn node)
  return { 
    branch: state.branch!, 
    reportFile: `Generated ${state.filesWritten} files on branch ${state.branch}`,
    filesChanged: state.filesWritten!
  };
}

/**
 * Batch Code Runner
 * 
 * For large-scale refactoring with per-batch validation
 * Processes codebase in chunks, validating each batch independently
 */
export async function runBatchCodeGraph(
  directive: string,
  initial: ArchitectGraphState,
  options: {
    batchSize?: number;
    maxBatches?: number;
    stopOnError?: boolean;
    maxRetries?: number;
  } = {}
): Promise<BatchRunResult> {
  const llm = initial.deps?.llm as LLMClient;
  const promptEngine = initial.deps?.promptEngine as PromptEngine;

  if (!llm || !promptEngine) {
    throw new Error("LLM and PromptEngine are required for batch processing");
  }

  const runner = new BatchCodeRunner(llm, promptEngine);

  return await runner.run(
    directive,
    initial.context,
    {
      git: initial.deps?.git,
      vectorDB: initial.deps?.memory
    },
    options
  );
}
