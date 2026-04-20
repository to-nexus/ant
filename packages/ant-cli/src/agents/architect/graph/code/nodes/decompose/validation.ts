import { CodeTask } from "../../../../types/task";
import type { TaskType, ResolvedArtifact } from '@ant/shared';
import { getDesignDocByPackageFromPool } from '../../../../../../core/prompt/builder/ArtifactPipeline';
import { isErrorTask } from '../../tasks/error';

/**
 * Post-validation: Check if LLM correctly classified error vs feature
 * 
 * This is a sanity check AFTER LLM decomposition, not pre-classification.
 * LLM should make the decision based on directive content.
 */
export function detectPotentialMisclassification(
  directive: string | undefined,
  tasks: CodeTask[]
): { hasMisclassification: boolean; reason?: string } {
  if (!directive) {
    return { hasMisclassification: false };
  }
  
  // ✅ Check 1: Explicit error messages in directive
  const hasErrorMessage = 
    /error:\s*/i.test(directive) ||
    /exception/i.test(directive) ||
    /\s+at\s+.*\(.*:\d+:\d+\)/.test(directive) ||  // Stack trace
    /exit code:\s*[1-9]/i.test(directive) ||
    /failed to compile/i.test(directive) ||
    /build failed/i.test(directive);
  
  // ✅ Check 2: If error message exists but no error-type tasks → potential issue
  if (hasErrorMessage) {
    const hasErrorTypeTasks = tasks.some(t => isErrorTask(t));
    if (!hasErrorTypeTasks) {
      return {
        hasMisclassification: true,
        reason: 'Directive contains error messages/stack traces but all tasks are non-error type'
      };
    }
  }
  
  return { hasMisclassification: false };
}

/**
 * Validate tasks after decompose to detect issues
 */
export function validateTasks(
  tasks: CodeTask[],
  mode: string | undefined,
  directive: string | undefined,
  artifacts?: ResolvedArtifact[],
): void {
  // Validate task type is one of the known types
  const VALID_TYPES: TaskType[] = [
    'setup', 'feature', 'design-system', 'ui',
    'test-code', 'error', 'verification', 'explain', 'doc'
  ];
  for (const t of tasks) {
    if (!VALID_TYPES.includes(t.type)) {
      throw new Error(
        `❌ [Decompose Validation] Invalid task type "${t.type}" on task.\n` +
        `Valid types: ${VALID_TYPES.join(', ')}\n` +
        `Task: ${t.id || '(no id)'} / ${t.name}\n`
      );
    }
  }

  // Warn about packages referencing non-existent design docs
  if (artifacts && artifacts.length > 0) {
    for (const t of tasks) {
      if (!t.packages) continue;
      for (const pkg of t.packages) {
        if (pkg === 'shared') continue;
        const content = getDesignDocByPackageFromPool(pkg, artifacts);
        if (!content) {
          console.warn(
            `⚠️  [Decompose Validation] Task "${t.id}" references package "${pkg}" ` +
            `but no matching design doc found — design doc will not be injected for this tag`
          );
        }
      }
    }
  }

  // Warn if a single shared foundation task has broad scope (likely spans multiple functional concerns)
  const sharedTasks = tasks.filter(t => t.priority >= 200 && t.priority < 300);
  if (sharedTasks.length === 1 && sharedTasks[0].description.length > 1200) {
    console.warn(
      `\n⚠️  [Decompose Validation] Single shared foundation task with broad scope (${sharedTasks[0].description.length} chars)\n` +
      `   If it spans multiple functional concerns (declarations + implementations + schema),\n` +
      `   consider splitting into sub-tasks (priority 200, 201, 202...)\n` +
      `   Task: ${sharedTasks[0].name}\n`
    );
  }

  // Skip remaining validation for generate mode
  if (mode === 'generate') return;
  
  // ✅ Check for potential misclassification
  const misclassification = detectPotentialMisclassification(directive, tasks);
  if (misclassification.hasMisclassification) {
    console.warn(`
⚠️  [Decompose Validation] POTENTIAL MISCLASSIFICATION
   
   ${misclassification.reason}
   
   Directive (first 200 chars):
   ${directive?.substring(0, 200)}...
   
   Generated tasks:
   ${tasks.map(t => `  - ${t.type}: ${t.name}`).join('\n')}
   
   → LLM may have incorrectly classified error as feature tasks.
    `);
  }
  
  // ✅ Refactor/Explain mode: Excessive task count warning
  if ((mode === 'refactor' || mode === 'explain') && tasks.length > 5) {
    console.warn(`
⚠️  [Decompose Validation] Excessive tasks in ${mode} mode
   
   Expected: 1-3 tasks for focused changes
   Generated: ${tasks.length} tasks
   
   → Review if all tasks are necessary
    `);
  }
  
  // ✅ Check first task for over-broad scope in refactor mode
  if ((mode === 'refactor' || mode === 'explain') && tasks.length > 0) {
    const firstTask = tasks[0];
    if (isOverBroadTask(firstTask)) {
      console.warn(`
⚠️  [Decompose Validation] First task too broad for ${mode} mode
   
   Task: ${firstTask.name}
   Description: ${firstTask.description.substring(0, 150)}...
   
   → ${mode} mode should focus on minimal changes
      `);
    }
  }
}

/**
 * Check if task is over-broad (sounds like full implementation)
 */
function isOverBroadTask(task: CodeTask): boolean {
  const broadKeywords = [
    'implement entire', 'build complete', 'create all',
    'implement', 'create', 'build', 'setup',
    'develop', 'design', 'architect'
  ];
  
  const focusedKeywords = [
    'fix', 'update', 'modify', 'change', 'correct',
    'adjust', 'tweak', 'patch', 'repair'
  ];
  
  const taskText = `${task.name} ${task.description}`.toLowerCase();
  
  const hasBroad = broadKeywords.some(k => taskText.includes(k));
  const hasFocused = focusedKeywords.some(k => taskText.includes(k));
  
  // Over-broad if has broad keywords but no focused keywords
  return hasBroad && !hasFocused;
}

