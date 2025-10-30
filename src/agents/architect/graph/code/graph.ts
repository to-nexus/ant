import { StateGraph } from "@langchain/langgraph";
import { ArchitectGraphState } from "./state";
import { resolve, decompose, plan, execute, validate, dynamicValidate, enforce, evaluate, postProcess, learn } from "./nodes/index";

export function buildCodeGraph() {
  const graph = new StateGraph<ArchitectGraphState>({
    channels: {
      // Context & Input
      context: null as any,
      spec: null as any,
      
      // Dependencies
      deps: null as any,
      gitPort: null as any,
      
      // Mode
      codeMode: null as any,
      
      // Artifacts (from TaskArtifacts)
      prd: null as any,
      directive: null as any,
      design: null as any,
      code: null as any,
      codeHead: null as any,
      profile: null as any,
      
      // Execution
      planText: null as any,
      codePrompt: null as any,
      rawResponse: null as any,
      responseSection: null as any,
      files: null as any,
      filesToDelete: null as any,
      modifications: null as any,
      
      // Integrations & Validation
      requiredIntegrations: null as any,
      violations: null as any,
      retries: null as any,
      maxRetries: null as any,
      dynamicValidationResult: null as any,
      enforcementReason: null as any,  // ✅ For enforce → plan communication
      
      // Progress tracking
      lastViolations: null as any,
      previousFileCount: null as any,
      
      // Attempt history
      previousAttempts: null as any,
      
      // Enforcement feedback history
      enforcementHistory: null as any,
      
      // Task Queue System
      taskQueue: null as any,
      currentTask: null as any,
      featureTasks: null as any,
      completedTasks: null as any,
      resolvedCategories: null as any,
      
      // Evaluation & Learning
      evaluationReport: null as any,
      learnings: null as any,
      
      // Results
      branch: null as any,
      filesWritten: null as any,
      reportFile: null as any,
    } as any,
  } as any);
  
  graph.addNode("resolve", resolve as any);
  graph.addNode("decompose", decompose as any);  // NEW: Meta-level task decomposition
  graph.addNode("plan", plan as any);
  graph.addNode("execute", execute as any);
  graph.addNode("validate", validate as any);
  graph.addNode("dynamicValidate", dynamicValidate as any);
  graph.addNode("enforce", enforce as any);
  graph.addNode("evaluate", evaluate as any);
  graph.addNode("postProcess", postProcess as any);
  graph.addNode("learn", learn as any);

  graph.addEdge("__start__" as any, "resolve" as any);
  graph.addEdge("resolve" as any, "decompose" as any);  // resolve → decompose
  graph.addEdge("decompose" as any, "plan" as any);     // decompose → plan (first task)
  graph.addEdge("plan" as any, "execute" as any);
  
  graph.addEdge("execute" as any, "validate" as any);

  // Static validation first
  graph.addConditionalEdges(
    "validate" as any,
    ((s: ArchitectGraphState) => {
      const hasViolations = (s.violations && s.violations.length > 0) || !s.files.length;
      if (hasViolations) {
        return "enforce";
      }
      return "postProcess";  // ✅ Static validation passed → Install dependencies first
    }) as any,
    { enforce: "enforce", postProcess: "postProcess" } as any
  );

  // After installing dependencies, run dynamic validation
  graph.addEdge("postProcess" as any, "dynamicValidate" as any);

  // Dynamic validation (build/lint/test) - now with dependencies installed
  graph.addConditionalEdges(
    "dynamicValidate" as any,
    ((s: ArchitectGraphState) => {
      const hasViolations = (s.violations && s.violations.length > 0);
      
      if (!hasViolations) {
        // ✅ Current task succeeded!
        
        // Mark task as completed
        if (s.currentTask) {
          console.log(`✅ Task "${s.currentTask.name}" completed!`);
          
          s.completedTasks = s.completedTasks || [];
          s.completedTasks.push(s.currentTask.id);
          
          // If feature task, mark in featureTasks map
          if (s.currentTask.type === 'feature' && s.featureTasks) {
            const feature = s.featureTasks.get(s.currentTask.id);
            if (feature) {
              feature.completed = true;
            }
          }
          
          // If error task completed, remove all error tasks from queue
          if (s.currentTask.type === 'error' && s.taskQueue) {
            const errorCount = s.taskQueue.getAll().filter(t => t.type === 'error').length;
            if (errorCount > 0) {
              console.log(`🧹 Removing ${errorCount} error task(s) from queue (errors resolved)`);
              s.taskQueue.removeType('error');
            }
          }
        }
        
        // Check if there are more tasks in queue
        if (s.taskQueue && !s.taskQueue.isEmpty()) {
          console.log(`📋 Moving to next task (${s.taskQueue.size()} remaining)\n`);
          return "plan";  // ← Next task
        } else {
          console.log(`✅ All tasks completed!`);
          return "evaluate";  // ← All done
        }
      }
      
      // Has violations - check if we should continue trying
      
      // If within retry limit for current task, retry
      if (s.retries < s.maxRetries) {
        return "enforce";
      }
      
      // Exceeded retries for current task
      // Check if there are more tasks to try
      if (s.taskQueue && !s.taskQueue.isEmpty()) {
        console.log(`⚠️  Task "${s.currentTask?.name}" exhausted retries`);
        console.log(`⏭️  Skipping to next task (${s.taskQueue.size()} remaining)\n`);
        return "plan";  // ← Skip to next task
      }
      
      // No more tasks, give up
      console.log(`❌ All tasks exhausted, proceeding to evaluation`);
      return "evaluate";
    }) as any,
    { enforce: "enforce", evaluate: "evaluate", plan: "plan" } as any
  );

  // ✅ KEY CHANGE: Enforce → Plan (not Execute)
  // This allows the agent to re-analyze the problem and create a better strategy
  graph.addEdge("enforce" as any, "plan" as any);
  
  graph.addEdge("evaluate" as any, "learn" as any);
  graph.addEdge("learn" as any, "__end__" as any);
  
  return (graph as any).compile();
}
