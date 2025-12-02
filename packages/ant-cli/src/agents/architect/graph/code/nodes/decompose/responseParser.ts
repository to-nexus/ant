import { Task, TaskQueue, TASK_PRIORITIES } from "../../state";
import { extractErrorDetails, createErrorViolation } from "../shared/errorHandler";

export interface ParsedDecomposeResponse {
  tasks: Task[];
  referenceRequests?: Array<{project: string; branch?: string; reason?: string}>;
}

/**
 * Parse LLM response and extract tasks
 * 
 * Expected format: <tasks>[...]</tasks>
 */
export function parseLLMResponse(rawResponse: string): ParsedDecomposeResponse {
  try {
    // ✅ Extract JSON array from <tasks> XML tag
    const tasksMatch = rawResponse.match(/<tasks>\s*([\s\S]*?)\s*<\/tasks>/);
    
    if (!tasksMatch) {
      // Fallback: Try to find JSON block (for backward compatibility)
      console.warn('⚠️  [Decompose] No <tasks> tag found, trying fallback JSON extraction');
      const jsonMatch = rawResponse.match(/```json\s*([\s\S]*?)\s*```/) || rawResponse.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : rawResponse;
      const parsed = JSON.parse(jsonStr);
      
      if (!parsed.tasks || !Array.isArray(parsed.tasks)) {
        throw new Error('Invalid response: tasks array missing');
      }
      
      return {
        tasks: parsed.tasks,
        referenceRequests: parsed.referenceProjects || parsed.referenceRequests
      };
    }
    
    // Parse JSON array from <tasks> tag
    const tasks = JSON.parse(tasksMatch[1]);
    
    if (!Array.isArray(tasks)) {
      throw new Error('Invalid response: tasks must be an array');
    }
    
    // ✅ Extract references from <references> tag
    let referenceRequests: Array<{project: string; branch?: string; reason?: string}> | undefined;
    const referencesMatch = rawResponse.match(/<references>\s*([\s\S]*?)\s*<\/references>/);
    
    if (referencesMatch) {
      try {
        referenceRequests = JSON.parse(referencesMatch[1]);
      } catch (error) {
        console.warn('⚠️  [Decompose] Failed to parse <references> tag:', error);
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
 */
export function createTaskQueue(tasks: Task[]): {
  taskQueue: TaskQueue;
  featureTasks: Map<string, Task>;
} {
  const taskQueue = new TaskQueue();
  const featureTasks = new Map<string, Task>();
  
  // Add Final Verification task
  const finalTask: Task = {
    id: `final-verification-${Date.now()}`,
    name: 'Final Verification',
    type: 'feature',
    priority: TASK_PRIORITIES.FINAL_VERIFICATION,
    description: 'Run final build verification and ensure all features work correctly'
  };
  
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
  
  // Add final verification at the end
  taskQueue.push(finalTask);
  
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
  console.log(`   Total tasks: ${tasks.length + 1} (including Final Verification)`);
  
  const tasksByType = {
    setup: tasks.filter(t => t.type === 'setup').length,
    feature: tasks.filter(t => t.type === 'feature').length,
    error: tasks.filter(t => t.type === 'error').length
  };
  
  console.log(`   Setup: ${tasksByType.setup}`);
  console.log(`   Feature: ${tasksByType.feature}`);
  console.log(`   Error: ${tasksByType.error}`);
  console.log(`   Final: 1`);
  
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

