import { StateGraph } from "@langchain/langgraph";
import { DesignGraphState } from "./state";
import { resolve } from "./nodes/resolve";
import { decompose } from "./nodes/decompose/index";
import { plan } from "./nodes/plan";
import { docGen } from "./nodes/docGen";  // ✅ XML streaming to buffer
import { writeFiles } from "./nodes/writeFiles";  // ✅ Save buffer to disk
import { learn } from "./nodes/learn";

/**
 * Check task status and handle completion
 * Routes to plan (next task) or learn (all done)
 * 
 * This MUST be a node (not a router) because it mutates state.
 * Consistent with code job's checkTaskStatus node.
 */
async function checkTaskStatus(state: DesignGraphState): Promise<Partial<DesignGraphState>> {
  // ✅ Workflow instrumentation: Enter node
  // ✅ CRITICAL: await to ensure workflow SSE is sent before continuing
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority
    } : undefined;
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'checkTaskStatus', taskInfo);
  }
  
  // ✅ Current task completed successfully (design has no validation failures)
  if (state.currentTask) {
    // Mark as completed with timing
    const { TaskTimingHelper } = await import('../code/state');
    const completedTask = TaskTimingHelper.completeTask(state.currentTask);
    
    if (completedTask.timing?.elapsedTime) {
      const formattedTime = TaskTimingHelper.formatElapsedTime(completedTask.timing.elapsedTime);
      console.log(`✅ Task "${completedTask.name}" completed in ${formattedTime}!`);
    } else {
      console.log(`✅ Task "${completedTask.name}" completed!`);
    }
    
    // ✅ CRITICAL: Create NEW arrays (immutable update pattern for LangGraph)
    const completedTasks = [...(state.completedTasks || []), completedTask.id];
    const completedTasksDetails = [...(state.completedTasksDetails || []), completedTask];
    
    console.log(`[checkTaskStatus] 💾 Task completion details saved:`, {
      taskId: completedTask.id,
      taskName: completedTask.name,
      totalCompleted: completedTasksDetails.length
    });
    
    // ✅ CRITICAL: Save checkpoint after completing a task
    if (state.deps?.session && state.context.featureFolder) {
      try {
        await state.deps.session.updateArtifacts(
          state.context.project,
          state.context.featureFolder,
          'design',
          {
            state: {
              taskQueue: state.taskQueue?.getAll() || [],
              completedTasks,
              completedTasksDetails,
              currentTask: undefined,
              planText: state.planText,
              files: state.files || [],  // ✅ Save generated files
              filesToDelete: state.filesToDelete || [],
              jobId: (state as any).jobId,
              jobTiming: (state as any).jobTiming,
              overrideDirective: state.overrideDirective,  // ✅ Save chat-initiated directive
              chatSource: state.chatSource  // ✅ Save chat source flag
            }
          }
        );
        console.log(`[checkTaskStatus] ✅ Checkpoint saved (${completedTasksDetails.length} tasks completed)\n`);
      } catch (error) {
        console.warn(`[checkTaskStatus] ⚠️  Failed to save checkpoint:`, error);
      }
    }
    
    // ✅ CRITICAL: Update Kanban to next task AFTER checkTaskStatus SSE sent
    // This ensures frontend sees checkTaskStatus animation before Kanban switches
    if (state._httpJobId && state.taskQueue && state.deps?.kanbanUpdate) {
      const allTasks = state.taskQueue.getAll();
      const nextTask = state.taskQueue.peek(); // ✅ Use peek() for correct next task
      
      // ✅ CRITICAL: Remove nextTask from queue display (it's now in progress)
      const remainingQueue = nextTask ? allTasks.filter(t => t.id !== nextTask.id) : allTasks;
      
      console.log(`\n🔥 [checkTaskStatus] Updating Kanban → next task`);
      console.log(`   Completed: ${completedTask.name}`);
      console.log(`   Next: ${nextTask?.name || 'none (learn)'}`);
      console.log(`   Remaining in queue: ${remainingQueue.length}`);
      console.log(`   Total completed: ${completedTasksDetails.length}\n`);
      
      state.deps.kanbanUpdate.updateTaskQueue(
        state._httpJobId,
        nextTask || null,
        remainingQueue,  // ✅ Exclude nextTask from queue
        completedTasksDetails
      );
    }
    
    // Return updated state
    return {
      completedTasks,
      completedTasksDetails,
      currentTask: undefined
    };
  }
  
  // No current task (shouldn't happen, but handle gracefully)
  return { currentTask: undefined };
}

export function buildDesignGraph() {
  const graph = new StateGraph<DesignGraphState>({
    channels: {
      // Context & Input
      context: null as any,
      spec: null as any,
      
      // Dependencies (MUST be in channels to be passed between nodes!)
      deps: null as any,
      
      // Mode
      designMode: null as any,
      
      // Artifacts (from TaskArtifacts)
      prd: null as any,
      directive: null as any,
      design: null as any,
      code: null as any,
      codeHead: null as any,
      profile: null as any,
      
      // ✅ NEW: Task Queue (like code graph)
      taskQueue: null as any,
      currentTask: null as any,
      completedTasks: null as any,
      completedTasksDetails: null as any,
      
      // ✅ Job tracking (for timing and continuity)
      jobId: null as any,
      jobTiming: null as any,
      
      // Execution
      planText: null as any,
      files: null as any,  // ✅ CRITICAL: Must be in channels
      filesToDelete: null as any,  // ✅ CRITICAL: Must be in channels
      learnings: null as any,
      
      // ✅ NEW: Tool Calling Support
      llmResponse: null as any,
      conversationHistory: null as any,
      
      // ✅ For tracking in UI
      _httpJobId: null as any,
      
      // ✅ Chat integration
      overrideDirective: null as any,  // ✅ Chat input as directive (highest priority)
      chatSource: null as any,  // ✅ Flag for Chat SSE
    } as any,
  } as any);

  graph.addNode("resolve" as const, resolve as any);
  graph.addNode("decompose" as const, decompose as any);
  graph.addNode("plan" as const, plan as any);
  graph.addNode("docGen" as const, docGen as any);  // ✅ XML streaming (no tool calling!)
  graph.addNode("writeFiles" as const, writeFiles as any);  // ✅ Save buffer to disk
  graph.addNode("checkTaskStatus" as const, checkTaskStatus as any);
  graph.addNode("learn" as const, learn as any);

  // ✅ Simplified flow: resolve → decompose → [plan → docGen → writeFiles → check] → learn
  // Design job uses PURE XML streaming (<file>, <append>, <edit> tags)
  // docGen: XML streaming to buffer
  // writeFiles: Save buffer to actual files
  (graph as any).addEdge("__start__", "resolve");
  (graph as any).addEdge("resolve", "decompose");
  (graph as any).addEdge("decompose", "plan");
  (graph as any).addEdge("plan", "docGen");
  (graph as any).addEdge("docGen", "writeFiles");
  (graph as any).addEdge("writeFiles", "checkTaskStatus");
  
  // ✅ Conditional routing: more tasks → plan, all done → learn
  graph.addConditionalEdges(
    "checkTaskStatus" as any,
    ((s: DesignGraphState) => {
      if (s.taskQueue && !s.taskQueue.isEmpty()) {
        return "plan";  // ← Next task
      } else {
        return "learn";  // ← All done
      }
    }) as any,
    { plan: "plan", learn: "learn" } as any
  );
  
  // ✅ CRITICAL: learn 노드 이후 END로 이동
  (graph as any).addEdge("learn", "__end__");

  return graph.compile();
}
