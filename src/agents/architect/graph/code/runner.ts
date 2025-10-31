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
 * ✅ Learn node is ALWAYS executed on exit (success/error/recursion limit)
 */
export async function runCodeGraph(initial: ArchitectGraphState) {
  const app = buildCodeGraph();
  let state: ArchitectGraphState = initial;
  
  try {
    state = await (app as any).invoke(initial as any, {
      recursionLimit: 25,  // ✅ Faster failure detection
    }) as ArchitectGraphState;
  } catch (error: any) {
    // ✅ CRITICAL: Recursion limit or other errors
    console.log(`\n⚠️  Execution interrupted: ${error.message}\n`);
    
    // Get the last state from error if available
    if (error.state) {
      state = error.state;
    }
    
    // ✅ Force learn node execution for cleanup & learning
    console.log('🧠 Running learn node for cleanup and state saving...\n');
    const { learn } = await import('./nodes/index');
    state = await learn(state);
    
    // Re-throw if not recursion limit
    if (!error.message.includes('Recursion limit')) {
      throw error;
    }
    
    console.log(`\n⏸️  Session paused due to recursion limit`);
    console.log(`📊 Progress saved:`);
    console.log(`   ✅ ${state.completedTasks?.length || 0} tasks completed`);
    console.log(`   ⏳ ${state.taskQueue?.size() || 0} tasks remaining`);
    console.log(`\n💡 Run the same command again to resume from checkpoint\n`);
  }

  // Return results (all saving was done in learn node)
  return { 
    branch: state.branch!, 
    reportFile: `Generated ${state.filesWritten || 0} files on branch ${state.branch || 'none'}`,
    filesChanged: state.filesWritten || 0
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
