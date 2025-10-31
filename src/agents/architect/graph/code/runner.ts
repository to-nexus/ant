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
 * 
 * ✅ RecursionLimit: Set to 25 for faster failure detection
 * If limit is reached, execution state is saved and can be resumed on next run
 */
export async function runCodeGraph(initial: ArchitectGraphState) {
  const app = buildCodeGraph();
  const state = await (app as any).invoke(initial as any, {
    recursionLimit: 25,  // ✅ Faster failure detection
  }) as ArchitectGraphState;

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
  const gitPort = initial.deps?.git || initial.gitPort;

  if (!llm || !promptEngine) {
    throw new Error("LLM and PromptEngine are required for batch processing");
  }
  
  if (!gitPort) {
    throw new Error("GitPort is required for batch processing");
  }

  const runner = new BatchCodeRunner(llm, promptEngine, gitPort);

  return await runner.run(
    directive,
    initial.context,
    {
      git: gitPort,
      vectorDB: initial.deps?.memory
    },
    options
  );
}
