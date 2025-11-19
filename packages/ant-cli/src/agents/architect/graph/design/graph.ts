import { StateGraph } from "@langchain/langgraph";
import { DesignGraphState } from "./state";
import { resolve } from "./nodes/resolve";
import { decompose } from "./nodes/decompose/index";
import { plan } from "./nodes/plan";
import { docGen } from "./nodes/docGen";  // ✅ NEW: Tool calling
import { tool } from "./nodes/tool";      // ✅ NEW: Tool execution
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
  graph.addNode("docGen" as const, docGen as any);  // ✅ NEW: LLM reasoning
  graph.addNode("tool" as const, tool as any);      // ✅ NEW: Tool execution (writes immediately!)
  graph.addNode("checkTaskStatus" as const, checkTaskStatus as any);
  graph.addNode("learn" as const, learn as any);

  // ✅ Flow with tool calling: resolve → decompose → [plan → docGen ⇄ tool → check] → learn
  (graph as any).addEdge("__start__", "resolve");
  (graph as any).addEdge("resolve", "decompose");
  (graph as any).addEdge("decompose", "plan");
  (graph as any).addEdge("plan", "docGen");
  
  // ✅ DocGen → Router (tool call 체크)
  graph.addConditionalEdges(
    "docGen" as any,
    ((s: DesignGraphState) => {
      const response = s.llmResponse;
      
      if (!response) {
        return "checkTaskStatus";  // No response, end
      }
      
      // Tool calls 있으면 → tool 노드
      if (response.toolCalls && response.toolCalls.length > 0) {
        console.log(`🔧 [Router] ${response.toolCalls.length} tool call(s) detected → tool node`);
        return "tool";
      }
      
      // Done이면 → checkTaskStatus (tool이 이미 파일 저장함!)
      if (response.done) {
        console.log(`✅ [Router] DocGen done → checkTaskStatus`);
        return "checkTaskStatus";
      }
      
      // 그 외 → docGen 재추론 (드물음)
      console.log(`🔄 [Router] Continue reasoning → docGen`);
      return "docGen";
    }) as any,
    { tool: "tool", checkTaskStatus: "checkTaskStatus", docGen: "docGen" } as any
  );
  
  // ✅ Tool → DocGen (도구 결과 가지고 다시 추론)
  (graph as any).addEdge("tool", "docGen");
  
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

  return graph.compile();
}
