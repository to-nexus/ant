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
  let isRecursionLimit = false;
  
  try {
    state = await (app as any).invoke(initial as any, {
      recursionLimit: 25,
    }) as ArchitectGraphState;
  } catch (error: any) {
    // ✅ CRITICAL: Recursion limit or other errors
    console.log(`\n⚠️  Execution interrupted: ${error.message}\n`);
    
    // ✅ Try to restore state from last checkpoint
    if (error.state) {
      state = error.state;
    } else if (initial.deps?.session && error.message.includes('Recursion limit')) {
      // LangGraph recursion limit doesn't provide state in error
      // So we restore from the last saved checkpoint
      console.log('📥 Restoring state from last checkpoint...');
      try {
        const session = await initial.deps.session.load(
          initial.context.project,
          initial.context.featureFolder || 'default'
        );
        
        if (session.state && session.state.taskQueue) {
          console.log(`   ✅ Restored ${session.state.taskQueue.length} tasks from checkpoint`);
          // Reconstruct TaskQueue from saved array
          const { TaskQueue } = await import('./state');
          const taskQueue = new TaskQueue();
          session.state.taskQueue.forEach((task: any) => taskQueue.push(task));
          
          state = {
            ...initial,
            taskQueue,
            completedTasks: session.state.completedTasks || [],
            retries: session.state.retries || 0,
            maxRetries: session.state.maxRetries || 3,
            previousAttempts: session.state.previousAttempts || [],
            enforcementHistory: session.state.enforcementHistory || [],
            lastViolations: session.state.lastViolations || [],
            previousFileCount: session.state.previousFileCount,
            resolvedCategories: (session.state.resolvedCategories || []) as any,
          };
        }
      } catch (restoreError) {
        console.warn('⚠️  Failed to restore from checkpoint:', restoreError);
      }
    }
    
    // ✅ Force learn node execution for cleanup & learning
    console.log('🧠 Running learn node for cleanup and state saving...\n');
    const { learn } = await import('./nodes/index');
    state = await learn(state);
    
    // Re-throw if not recursion limit
    if (!error.message.includes('Recursion limit')) {
      throw error;
    }
    
    isRecursionLimit = true;
    console.log(`\n⏸️  Session paused due to recursion limit`);
    console.log(`📊 Progress saved:`);
    console.log(`   ✅ ${state.completedTasks?.length || 0} tasks completed`);
    console.log(`   ⏳ ${state.taskQueue?.size() || 0} tasks remaining`);
    console.log(`\n💡 Run the same command again to resume from checkpoint\n`);
  }

  // Return results (all saving was done in learn node)
  const filesGenerated = state.filesWritten || 0;
  const tasksRemaining = state.taskQueue?.size() || 0;
  
  let reportMessage = `Generated ${filesGenerated} files on branch ${state.branch || 'none'}`;
  if (isRecursionLimit && tasksRemaining > 0) {
    reportMessage += ` (paused: ${tasksRemaining} tasks remaining due to recursion limit)`;
  }
  
  return { 
    branch: state.branch!, 
    reportFile: reportMessage,
    filesChanged: filesGenerated,
    pausedDueToLimit: isRecursionLimit,
    tasksRemaining: tasksRemaining
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
