import { StateGraph } from "@langchain/langgraph";
import { DesignGraphState } from "./state";
import { resolve } from "./nodes/resolve";
import { decompose } from "./nodes/decompose";
import { plan } from "./nodes/plan";
import { execute } from "./nodes/execute";
import { learn } from "./nodes/learn";

/**
 * Check if there are more tasks to process
 * Routes to plan (next task) or learn (all done)
 */
async function checkTaskCompletion(state: DesignGraphState): Promise<Partial<DesignGraphState>> {
  // ✅ Workflow instrumentation: Enter node
  // ✅ CRITICAL: await to ensure workflow SSE is sent before continuing
  if (state.deps?.workflowUpdate && state._httpTaskId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority
    } : undefined;
    await state.deps.workflowUpdate.enterNode(state._httpTaskId, 'checkTaskCompletion', taskInfo);
  }
  
  // ✅ CRITICAL: Update Kanban to next task AFTER checkTaskCompletion SSE sent
  // This ensures frontend sees checkTaskCompletion animation before Kanban switches
  if (state._httpTaskId && state.taskQueue) {
    const allTasks = state.taskQueue.getAll();
    const completedTasksDetails = state.completedTasksDetails || [];
    const nextTask = state.taskQueue.peek(); // ✅ Use peek() for correct next task
    
    // ✅ CRITICAL: Remove nextTask from queue display (it's now in progress)
    const remainingQueue = nextTask ? allTasks.filter(t => t.id !== nextTask.id) : allTasks;
    
    console.log(`\n🔥 [checkTaskCompletion] Updating Kanban → next task`);
    console.log(`   Current: ${state.currentTask?.name}`);
    console.log(`   Next: ${nextTask?.name || 'none (learn)'}`);
    console.log(`   Remaining in queue: ${remainingQueue.length}`);
    
    if (state.deps?.kanbanUpdate) {
      state.deps.kanbanUpdate.updateTaskQueue(
        state._httpTaskId,
        nextTask || null,
        remainingQueue,  // ✅ Exclude nextTask from queue
        completedTasksDetails
      );
    }
  }
  
  // If there are more tasks in queue, continue to next task
  if (state.taskQueue && !state.taskQueue.isEmpty()) {
    console.log(`\n📋 ${state.taskQueue.size()} task(s) remaining, continuing...\n`);
    // ✅ CRITICAL: Clear currentTask so plan will pop next task
    return { ...state, currentTask: undefined };
  }
  
  console.log(`\n✅ All design tasks completed!\n`);
  // ✅ CRITICAL: Clear currentTask for final state
  return { ...state, currentTask: undefined };
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
      
      // Execution
      planText: null as any,
      designMarkdown: null as any,
      
      // Results
      designFilePath: null as any,
      learnings: null as any,
      
      // ✅ For tracking in UI
      _httpTaskId: null as any,
    } as any,
  } as any);

  graph.addNode("resolve" as const, resolve as any);
  graph.addNode("decompose" as const, decompose as any);
  graph.addNode("plan" as const, plan as any);
  graph.addNode("execute" as const, execute as any);
  graph.addNode("checkTaskCompletion" as const, checkTaskCompletion as any);  // ✅ NEW
  graph.addNode("learn" as const, learn as any);

  // ✅ Flow with task loop: resolve → decompose → [plan → execute → check] → learn
  (graph as any).addEdge("__start__", "resolve");
  (graph as any).addEdge("resolve", "decompose");
  (graph as any).addEdge("decompose", "plan");
  (graph as any).addEdge("plan", "execute");
  (graph as any).addEdge("execute", "checkTaskCompletion");  // ✅ Check after each task
  
  // ✅ Conditional routing: more tasks → plan, all done → learn
  graph.addConditionalEdges(
    "checkTaskCompletion" as any,
    ((s: DesignGraphState) => {
      if (s.taskQueue && !s.taskQueue.isEmpty()) {
        return "plan";  // ← Next task
      } else {
        return "learn";  // ← All done
      }
    }) as any,
    { plan: "plan", learn: "learn" } as any
  );

  return graph.compile();
}
