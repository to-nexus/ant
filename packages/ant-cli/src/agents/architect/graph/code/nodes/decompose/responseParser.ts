import { Task, TaskQueue, TASK_PRIORITIES } from "../../state";
import { extractErrorDetails, createErrorViolation } from "../shared/errorHandler";

export interface ParsedDecomposeResponse {
  tasks: Task[];
  referenceRequests?: Array<{project: string; branch?: string; reason?: string}>;
}

/**
 * Parse LLM response and extract tasks
 * 
 * Expected format: 
 * <tasks>[...]</tasks>
 * <references>[...]</references>  (optional, can be empty array)
 * 
 * STRICT MODE: No fallback parsing. LLM MUST follow the XML tag format.
 */
export function parseLLMResponse(rawResponse: string): ParsedDecomposeResponse {
  try {
    // ✅ Extract JSON array from <tasks> XML tag (REQUIRED)
    const tasksMatch = rawResponse.match(/<tasks>\s*([\s\S]*?)\s*<\/tasks>/);
    
    if (!tasksMatch) {
      throw new Error('Invalid response: <tasks> tag is required. LLM must follow the prompt format strictly.');
    }
    
    // Parse JSON array from <tasks> tag
    const tasks = JSON.parse(tasksMatch[1]);
    
    if (!Array.isArray(tasks)) {
      throw new Error('Invalid response: tasks must be an array');
    }
    
    // ✅ Extract references from <references> tag (OPTIONAL but must use tag format if present)
    let referenceRequests: Array<{project: string; branch?: string; reason?: string}> | undefined;
    const referencesMatch = rawResponse.match(/<references>\s*([\s\S]*?)\s*<\/references>/);
    
    if (referencesMatch) {
      try {
        const parsed = JSON.parse(referencesMatch[1]);
        // ✅ Accept empty array (no references)
        if (Array.isArray(parsed)) {
          referenceRequests = parsed.length > 0 ? parsed : undefined;
        } else {
          console.warn('⚠️  [Decompose] <references> tag content is not an array, ignoring');
        }
      } catch (error) {
        console.warn('⚠️  [Decompose] Failed to parse <references> tag content:', error);
      }
    }
    
    return {
      tasks,
      referenceRequests
    };
    
  } catch (error) {
    console.error('❌ [Decompose] Failed to parse LLM response:', error);
    console.error('Raw response:', rawResponse.substring(0, 500));
    throw error;
  }
}

/**
 * Create task queue from parsed tasks
 * 
 * ⚠️ CRITICAL: LLM MUST create Final Verification task (priority 1000)
 * No fallback - if missing, throw error to enforce prompt compliance
 */
export function createTaskQueue(tasks: Task[]): {
  taskQueue: TaskQueue;
  featureTasks: Map<string, Task>;
} {
  const taskQueue = new TaskQueue();
  const featureTasks = new Map<string, Task>();
  
  // ✅ Validate that LLM created Final Verification task
  const hasFinalTask = tasks.some(task => task.priority === TASK_PRIORITIES.FINAL_VERIFICATION);
  
  if (!hasFinalTask) {
    throw new Error(
      '❌ [Decompose] LLM failed to create Final Verification task (priority 1000)!\n' +
      'This is a CRITICAL prompt violation. LLM must ALWAYS include final verification task.\n' +
      'Check decompose prompt compliance.'
    );
  }
  
  tasks.forEach(task => {
    // Ensure task has required fields
    const normalizedTask: Task = {
      id: task.id || `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: task.name,
      type: task.type || 'feature',
      priority: task.priority || TASK_PRIORITIES.FEATURE_NORMAL,
      description: task.description,
      errors: task.errors,
      category: task.category
    };
    
    taskQueue.push(normalizedTask);
    
    if (normalizedTask.type === 'feature') {
      featureTasks.set(normalizedTask.id, normalizedTask);
    }
  });
  
  console.log(`✅ [createTaskQueue] Final Verification task validated (created by LLM)`);
  
  return { taskQueue, featureTasks };
}

/**
 * Log task breakdown summary
 */
export function logTaskSummary(
  tasks: Task[],
  referenceRequests?: Array<{project: string; branch?: string; reason?: string}>
): void {
  console.log(`\n✅ Task breakdown complete:`);
  
  // ✅ Count actual Final Verification tasks (don't assume +1!)
  const tasksByType = {
    setup: tasks.filter(t => t.type === 'setup').length,
    feature: tasks.filter(t => t.type === 'feature' && t.priority !== TASK_PRIORITIES.FINAL_VERIFICATION).length,
    error: tasks.filter(t => t.type === 'error').length,
    final: tasks.filter(t => t.priority === TASK_PRIORITIES.FINAL_VERIFICATION).length
  };
  
  console.log(`   Total tasks: ${tasks.length}`);
  console.log(`   Setup: ${tasksByType.setup}`);
  console.log(`   Feature: ${tasksByType.feature}`);
  console.log(`   Error: ${tasksByType.error}`);
  console.log(`   Final: ${tasksByType.final}`);
  
  // Log reference requests
  if (referenceRequests && referenceRequests.length > 0) {
    console.log(`\n📚 Reference projects requested:`);
    referenceRequests.forEach(ref => {
      console.log(`   - ${ref.project}${ref.branch ? ` (${ref.branch})` : ''}`);
      if (ref.reason) {
        console.log(`     Reason: ${ref.reason}`);
      }
    });
  }
  
  console.log('');
}

