import { TaskQueue, TASK_PRIORITIES } from "../../state";
import { CodeTask } from "../../../../types/task";
import { extractErrorDetails, createErrorViolation } from "../shared/errorHandler";

export interface ParsedProfile {
  environment: string;
  environmentReasoning: string;
  language: string;
  framework?: string | null;
}

export interface ParsedDecomposeResponse {
  tasks: CodeTask[];
  referenceRequests?: Array<{project: string; branch?: string; reason?: string}>;
  profile?: ParsedProfile;
  selectedSpec?: string | null;
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
    
    // ✅ Extract profile from <profile> tag (environment + language + framework)
    let profile: ParsedProfile | undefined;
    const profileMatch = rawResponse.match(/<profile>\s*([\s\S]*?)\s*<\/profile>/);
    
    if (profileMatch) {
      try {
        const parsedProfile = JSON.parse(profileMatch[1]);
        profile = {
          environment: parsedProfile.environment || 'unknown',
          environmentReasoning: parsedProfile.environmentReasoning || '',
          language: parsedProfile.language || 'typescript',
          framework: parsedProfile.framework || null,
        };
      } catch (error) {
        console.warn('⚠️  [Decompose] Failed to parse <profile> tag content:', error);
        // Default profile when parsing fails
        profile = {
          environment: 'unknown',
          environmentReasoning: 'Failed to parse profile',
          language: 'typescript',
          framework: null,
        };
      }
    } else {
      console.warn('⚠️  [Decompose] No <profile> tag found, using defaults');
      profile = {
        environment: 'unknown',
        environmentReasoning: 'No profile tag in response',
        language: 'typescript',
        framework: null,
      };
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
    
    // ✅ Extract selectedSpec from <selectedSpec> tag (OPTIONAL)
    let selectedSpec: string | null = null;
    const selectedSpecMatch = rawResponse.match(/<selectedSpec>\s*([\s\S]*?)\s*<\/selectedSpec>/);
    if (selectedSpecMatch) {
      const specValue = selectedSpecMatch[1].trim();
      if (specValue && specValue !== 'null' && specValue !== 'none') {
        selectedSpec = specValue;
        console.log(`📋 [Decompose] Selected spec: ${selectedSpec}`);
      }
    }

    return {
      tasks,
      referenceRequests,
      profile,
      selectedSpec,
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
 * ⚠️ CRITICAL: Final Verification task rules
 * - Required if there are feature tasks (features don't get individual validation)
 * - Optional if ALL tasks are error tasks (errors already get runtime validation)
 */
export function createTaskQueue(tasks: CodeTask[]): {
  taskQueue: TaskQueue<CodeTask>;
  featureTasks: Map<string, CodeTask>;
} {
  const taskQueue = new TaskQueue<CodeTask>();
  const featureTasks = new Map<string, CodeTask>();
  
  // ✅ Validate Final Verification task conditionally
  const hasFinalTask = tasks.some(task => task.priority === TASK_PRIORITIES.FINAL_VERIFICATION);
  const hasFeatureTasks = tasks.some(task => 
    task.type === 'feature' && task.priority !== TASK_PRIORITIES.FINAL_VERIFICATION
  );
  const allTasksAreErrors = tasks.length > 0 && tasks.every(task => 
    task.type === 'error' || task.type === 'verification' || task.priority === TASK_PRIORITIES.FINAL_VERIFICATION
  );
  
  // Final task is required only if there are feature tasks
  if (!hasFinalTask && hasFeatureTasks) {
    throw new Error(
      '❌ [Decompose] LLM failed to create Final Verification task (priority 1000)!\n' +
      '\n' +
      'Feature tasks detected but no final verification task.\n' +
      'Final task is required when there are feature tasks (they skip individual validation).\n' +
      '\n' +
      'This is a CRITICAL prompt violation. Check decompose prompt compliance.'
    );
  }
  
  // Log decision
  if (!hasFinalTask && allTasksAreErrors) {
    console.log(`✅ [createTaskQueue] Final task skipped (all tasks are error tasks with individual validation)`);
  } else if (hasFinalTask) {
    console.log(`✅ [createTaskQueue] Final Verification task validated (created by LLM)`);
  }
  
  tasks.forEach(task => {
    // Determine exclusive flag:
    // - Explicit from LLM takes precedence
    // - Fallback: setup, error, and final (priority 1000) are always exclusive
    const isExplicitExclusive = typeof (task as any).exclusive === 'boolean' ? (task as any).exclusive : undefined;
    const isTypeExclusive = task.type === 'setup' || task.type === 'error' || task.type === 'verification' || task.priority === TASK_PRIORITIES.FINAL_VERIFICATION;
    const exclusive = isExplicitExclusive ?? isTypeExclusive;
    
    // parallelGroup only applies when not exclusive
    const parallelGroup = !exclusive && typeof (task as any).parallelGroup === 'string' 
      ? (task as any).parallelGroup 
      : undefined;
    
    // Determine task type: final verification tasks are always 'verification'
    const resolvedType = task.priority === TASK_PRIORITIES.FINAL_VERIFICATION
      ? 'verification' as const
      : (task.type || 'feature');

    // Ensure task has required fields
    const normalizedTask: CodeTask = {
      id: task.id || `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: task.name,
      type: resolvedType,
      priority: task.priority || TASK_PRIORITIES.FEATURE_NORMAL,
      description: task.description,
      errors: task.errors,
      category: task.category,
      // UI injection flags
      ui: typeof (task as any).ui === 'boolean' ? (task as any).ui : undefined,
      uiSections: Array.isArray((task as any).uiSections) ? (task as any).uiSections : undefined,
      // Package-based design doc injection (fe, fe-*, be, be-*)
      packages: Array.isArray((task as any).packages) ? (task as any).packages : undefined,
      // Parallel execution hints
      exclusive: exclusive || undefined,
      parallelGroup,
    };
    
    taskQueue.push(normalizedTask);
    
    if (normalizedTask.type === 'feature') {
      featureTasks.set(normalizedTask.id, normalizedTask);
    }
  });
  
  return { taskQueue, featureTasks };
}

/**
 * Log task breakdown summary
 */
export function logTaskSummary(
  tasks: CodeTask[],
  referenceRequests?: Array<{project: string; branch?: string; reason?: string}>
): void {
  console.log(`\n✅ Task breakdown complete:`);
  
  // ✅ Count actual task types
  const tasksByType = {
    setup: tasks.filter(t => t.type === 'setup').length,
    feature: tasks.filter(t => t.type === 'feature' && t.priority !== TASK_PRIORITIES.FINAL_VERIFICATION).length,
    error: tasks.filter(t => t.type === 'error').length,
    verification: tasks.filter(t => t.type === 'verification' || t.priority === TASK_PRIORITIES.FINAL_VERIFICATION).length,
  };
  
  console.log(`   Total tasks: ${tasks.length}`);
  console.log(`   Setup: ${tasksByType.setup}`);
  console.log(`   Feature: ${tasksByType.feature}`);
  console.log(`   Error: ${tasksByType.error}`);
  console.log(`   Verification: ${tasksByType.verification}`);
  
  // Parallel execution summary
  const exclusiveTasks = tasks.filter(t => t.exclusive);
  const parallelGroups = new Set(tasks.filter(t => t.parallelGroup).map(t => t.parallelGroup));
  if (exclusiveTasks.length > 0 || parallelGroups.size > 0) {
    console.log(`   🔀 Parallel hints:`);
    console.log(`      Exclusive: ${exclusiveTasks.length} tasks (${exclusiveTasks.map(t => t.id).join(', ')})`);
    console.log(`      Parallel groups: ${parallelGroups.size > 0 ? [...parallelGroups].join(', ') : 'none'}`);
  }
  
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

