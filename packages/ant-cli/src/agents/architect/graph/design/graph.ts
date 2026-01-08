import { StateGraph } from "@langchain/langgraph";
import { DesignGraphState } from "./state";
import { resolve } from "./nodes/resolve";
import { decompose } from "./nodes/decompose/index";
import { plan } from "./nodes/plan";
import { docGen } from "./nodes/docGen/index";  // ✅ XML streaming + immediate file writes
import { tool } from "./nodes/tool";  // ✅ Tool execution node (for UI Design multimodal)
import { learn } from "./nodes/learn";
import { detectEnvironment } from "./nodes/detectEnvironment";

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
  
  // ✅ Current task completed successfully
  if (state.currentTask) {
    // ✅ Get helpers
    const { TaskTimingHelper } = await import('../code/state');
    const { getTaskTokenUsage, accumulateTokenUsage } = await import('../common/llmHelpers');
    
    // ✅ Get task-level token usage
    const taskTokenUsage = getTaskTokenUsage(state as any);
    
    // ✅ Complete task with timing and token usage
    const completedTask = TaskTimingHelper.completeTask(state.currentTask, taskTokenUsage);
    
    // ✅ Accumulate task tokens into job-level tokenUsage
    if (taskTokenUsage) {
      accumulateTokenUsage(state as any, taskTokenUsage, { taskLevel: false, jobLevel: true });
    }
    
    // ✅ Log completion
    if (completedTask.timing?.elapsedTime) {
      const formattedTime = TaskTimingHelper.formatElapsedTime(completedTask.timing.elapsedTime);
      console.log(`✅ Task "${completedTask.name}" completed in ${formattedTime}!`);
      if (completedTask.tokenUsage) {
        console.log(`   Tokens: ${completedTask.tokenUsage.totalTokens} total (${completedTask.tokenUsage.inputTokens} in, ${completedTask.tokenUsage.outputTokens} out)`);
      }
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
              tokenUsage: (state as any).tokenUsage,  // ✅ Save job-level token usage
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
      currentTask: undefined,
      conversationHistory: [],  // ✅ CRITICAL: Reset conversation history between tasks
      files: [],  // ✅ CRITICAL: Reset files for next task (each task generates fresh)
      tokenUsage: (state as any).tokenUsage,  // ✅ CRITICAL: Return accumulated job-level token usage
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
      designDomain: null as any,               // ✅ Design domain (game vs service)
      designDomainReasoning: null as any,      // ✅ Reasoning for domain detection
      designEnvironment: null as any,          // ✅ Design environment (frontend vs backend vs fullstack)
      designEnvironmentReasoning: null as any, // ✅ Reasoning for environment detection
      
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
      
      // ✅ Token usage tracking (task-level and job-level)
      _currentTaskTokenUsage: null as any,  // Reset per task
      tokenUsage: null as any,              // Job-level accumulation
      
      // Execution
      planText: null as any,
      files: null as any,  // ✅ CRITICAL: Must be in channels
      filesToDelete: null as any,  // ✅ CRITICAL: Must be in channels
      lessons: null as any,
      
      // ✅ NEW: Tool Calling Support
      llmResponse: null as any,
      conversationHistory: null as any,
      
      // ✅ For tracking in UI
      _httpJobId: null as any,
      
      // ✅ Chat integration
      overrideDirective: null as any,  // ✅ Chat input as directive (highest priority)
      chatSource: null as any,  // ✅ Flag for Chat SSE
      
      // ✅ UI specification flag (for conditional prompt guidance)
      hasUiDoc: null as any,
      
      // ✅ NEW: Work type (ui-design vs system-design)
      designWorkType: null as any,
      designWorkTypeReasoning: null as any,
      
      // ✅ NEW: UI document generation context
      uiReferences: null as any,
      uiAssetsList: null as any,
    } as any,
  } as any);

  graph.addNode("resolve" as const, resolve as any);
  graph.addNode("detectEnvironment" as const, detectEnvironment as any);
  graph.addNode("decompose" as const, decompose as any);
  graph.addNode("plan" as const, plan as any);
  graph.addNode("docGen" as const, docGen as any);  // ✅ XML streaming + immediate file writes (like code job)
  graph.addNode("tool" as const, tool as any);  // ✅ Tool execution (for UI Design multimodal image loading)
  graph.addNode("checkTaskStatus" as const, checkTaskStatus as any);
  graph.addNode("learn" as const, learn as any);

  // ✅ Unified flow: resolve → detectEnvironment → decompose → [plan → docGen → check] → learn
  // Design job now writes files immediately like code job (no separate writeFiles node)
  // docGen: XML streaming + immediate writes to disk (with LAST_SECTION handling)
  (graph as any).addEdge("__start__", "resolve");
  (graph as any).addEdge("resolve", "detectEnvironment");
  (graph as any).addEdge("detectEnvironment", "decompose");
  (graph as any).addEdge("decompose", "plan");
  (graph as any).addEdge("plan", "docGen");
  
  // ✅ Conditional routing: docGen → tool (if tool call) or checkTaskStatus (if done)
  graph.addConditionalEdges(
    "docGen" as any,
    ((s: DesignGraphState) => {
      // Check if there are pending tool calls
      const toolCalls = s.llmResponse?.toolCalls;
      if (toolCalls && toolCalls.length > 0) {
        console.log(`🔧 [Graph] Tool call detected: ${toolCalls[0].name}`);
        return "tool";  // Execute tool
      }
      return "checkTaskStatus";  // Task complete
    }) as any,
    { tool: "tool", checkTaskStatus: "checkTaskStatus" } as any
  );
  
  // ✅ Tool → docGen (loop back for next LLM turn)
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
  
  // ✅ CRITICAL: learn 노드 이후 END로 이동
  (graph as any).addEdge("learn", "__end__");

  return graph.compile();
}
