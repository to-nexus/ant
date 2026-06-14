import { CodeTask } from "../../../../types/task";
import type { TaskType, ResolvedArtifact } from '@ant/shared';
import { isErrorTask } from '../../tasks/error';
import { hooksForTaskType } from '../../tasks/_shared/registry';

const VALID_TASK_TYPES: readonly TaskType[] = [
  'setup', 'feature', 'design-system', 'ui',
  'test-code', 'error', 'verification', 'seam', 'explain', 'doc',
] as const;

export interface InvalidTaskTypeViolationDetail {
  observedType: string;
  taskId?: string;
  taskName: string;
  validTypes: readonly TaskType[];
}

export class InvalidTaskTypeViolation extends Error {
  readonly detail: InvalidTaskTypeViolationDetail;
  constructor(detail: InvalidTaskTypeViolationDetail) {
    super(
      `Invalid task type "${detail.observedType}" on task ` +
      `"${detail.taskId ?? '(no id)'} / ${detail.taskName}". ` +
      `Valid types: ${detail.validTypes.join(', ')}`,
    );
    this.name = 'InvalidTaskTypeViolation';
    this.detail = detail;
  }
}

export function buildInvalidTaskTypeViolationFraming(
  v: InvalidTaskTypeViolation,
): string {
  const { observedType, taskName, validTypes } = v.detail;
  return (
    '\n\n---\n\n## Retry: invalid task type\n' +
    `Your previous response emitted \`type: "${observedType}"\` on task ` +
    `"${taskName}", which is not a valid task type. ` +
    `Valid task types are: ${validTypes.map(t => `\`${t}\``).join(', ')}. ` +
    `Mode names (\`generate\`, \`refactor\`, \`explain\`) are NOT task types — ` +
    `\`refactor\` and \`generate\` exist only as modes. Re-emit the task ` +
    `with the correct \`type\` for the same work scope.\n`
  );
}

/**
 * Hard contract validation — task type must be one of the canonical enum
 * values. Throws InvalidTaskTypeViolation so the decompose retry loop can
 * surface a corrective framing back to the LLM. Called inside the retry
 * loop; soft validations (design-doc warns, broad-scope warns) live in
 * `validateTasks` and run once after the loop commits.
 */
export function validateTaskTypeEnum(tasks: CodeTask[]): void {
  for (const t of tasks) {
    if (!VALID_TASK_TYPES.includes(t.type)) {
      throw new InvalidTaskTypeViolation({
        observedType: String(t.type),
        taskId: t.id,
        taskName: t.name,
        validTypes: VALID_TASK_TYPES,
      });
    }
  }
}

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
 * Soft validations that run once after decompose commits — design-doc
 * package references, broad-scope foundation tasks, error-vs-feature
 * misclassification, and over-broad refactor/explain shapes.
 *
 * Hard type-enum validation is owned by `validateTaskTypeEnum` and runs
 * inside the decompose retry loop so the LLM gets a chance to self-correct.
 */
export function validateTasks(
  tasks: CodeTask[],
  mode: string | undefined,
  directive: string | undefined,
  artifacts?: ResolvedArtifact[],
): void {
  // Warn about include paths that match nothing in the post-RAC pool — the
  // single injection SSOT is `task.include`, so an include that matches no
  // artifact silently injects nothing for that path.
  if (artifacts && artifacts.length > 0) {
    for (const t of tasks) {
      if (!t.include?.length) continue;
      for (const inc of t.include) {
        const prefix = inc.endsWith('*') ? inc.slice(0, -1) : inc;
        const matches = artifacts.some(a => a.path === inc || a.path.startsWith(prefix));
        if (!matches) {
          console.warn(
            `⚠️  [Decompose Validation] Task "${t.id}" include "${inc}" ` +
            `matches no artifact in the RAC pool — nothing will be injected for it`
          );
        }
      }
    }
  }

  // Warn if a single shared foundation task has broad scope (likely spans multiple functional concerns).
  // Foundation identity is owned by each bundle's `classify` — the
  // decompose phase never compares raw priority bands. Three-Axis SSOT:
  // feature uses `band`, design-system is type-fixed.
  const sharedTasks = tasks.filter(t => {
    const classify = hooksForTaskType(t.type)?.scheduling?.classify;
    return !!classify?.(t).isFoundation;
  });
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

