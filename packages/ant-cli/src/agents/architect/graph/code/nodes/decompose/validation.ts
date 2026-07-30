import { CodeTask } from "../../../../types/task";
import { isTaskDescriptionAuthored } from '@ant/shared';
import type { TaskType, ResolvedArtifact, ExecutionTierId } from '@ant/shared';
import { isErrorTask } from '../../tasks/error';
import { isVerificationTask } from '../../tasks/verification';
import { hooksForTaskType } from '../../tasks/_shared/registry';
import { containsMachineFailureSignal } from '../../../../../../core/utils/runtimeErrorPattern';

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

export interface MissingTaskDescriptionViolationDetail {
  taskId?: string;
  taskName: string;
}

export class MissingTaskDescriptionViolation extends Error {
  readonly detail: MissingTaskDescriptionViolationDetail;
  constructor(detail: MissingTaskDescriptionViolationDetail) {
    super(
      `Missing/blank "description" on task ` +
      `"${detail.taskId ?? '(no id)'} / ${detail.taskName}". ` +
      `Every task must carry a non-empty per-task description ` +
      `(Task Description Authorship SSOT).`,
    );
    this.name = 'MissingTaskDescriptionViolation';
    this.detail = detail;
  }
}

export function buildMissingTaskDescriptionViolationFraming(
  v: MissingTaskDescriptionViolation,
): string {
  const { taskName } = v.detail;
  return (
    '\n\n---\n\n## Retry: missing task description\n' +
    `Your previous response omitted (or left blank) the \`description\` field ` +
    `on task "${taskName}". Every \`<task>\` JSON object MUST carry a non-empty ` +
    `\`description\` stating that task's scope of work in your own words — it is ` +
    `the work statement the execution phase receives. Do NOT paste the directive ` +
    `verbatim. Re-emit the full task set with a description on every task.\n`
  );
}

/**
 * Authored-scope floor (see `BaseTask.description` JSDoc in @ant/shared).
 * Throws so the decompose retry loop surfaces a corrective framing — an empty
 * description would otherwise flow through `createTaskQueue`'s `as CodeTask`
 * cast and become the ENTIRE execute work statement when no plan is sealed.
 */
export function validateTaskDescriptions(tasks: CodeTask[]): void {
  for (const t of tasks) {
    if (!isTaskDescriptionAuthored(t)) {
      throw new MissingTaskDescriptionViolation({ taskId: t.id, taskName: t.name });
    }
  }
}

export type TierShapeViolationKind =
  | 'tier2-count'
  | 'tier2-missing-flag'
  | 'tier34-count'
  | 'tier34-missing-final'
  | 'tier34-selfverify-leak';

export interface TierShapeViolationDetail {
  kind: TierShapeViolationKind;
  executionTier: ExecutionTierId;
  taskCount: number;
  taskId?: string;
  taskName?: string;
}

export class TierShapeViolation extends Error {
  readonly detail: TierShapeViolationDetail;
  constructor(detail: TierShapeViolationDetail) {
    const subject = detail.taskName
      ? ` (task "${detail.taskId ?? '(no id)'} / ${detail.taskName}")`
      : '';
    super(
      `Tier ${detail.executionTier} task shape violation: ${detail.kind}` +
      `${subject}, taskCount=${detail.taskCount}`,
    );
    this.name = 'TierShapeViolation';
    this.detail = detail;
  }
}

export function buildTierShapeViolationFraming(v: TierShapeViolation): string {
  const { kind, executionTier, taskCount, taskName } = v.detail;
  let body: string;
  switch (kind) {
    case 'tier2-count':
      body =
        `Your previous response classified \`<executionTier>2</executionTier>\` but emitted ` +
        `${taskCount} tasks. Tier 2 (Exploratory, single unit of work) requires EXACTLY one ` +
        `\`<task>\`. If the directive genuinely needs more than one independent unit of work, ` +
        `re-classify as Tier 3 (with a mandatory verification task); otherwise re-emit exactly ` +
        `one task with \`selfVerifyOnDone: true\`.`;
      break;
    case 'tier2-missing-flag':
      body =
        `Your previous response's sole Tier 2 task "${taskName}" is missing ` +
        `\`selfVerifyOnDone: true\`. Every Tier 2 non-explain task MUST set it — the task owns ` +
        `its own install/typecheck/build/test gates. Re-emit the SAME task with the flag added.`;
      break;
    case 'tier34-count':
      body =
        `Your previous response classified \`<executionTier>${executionTier}</executionTier>\` ` +
        `but emitted only ${taskCount} task(s). Tier 3/4 requires AT LEAST 2 tasks: work task(s) ` +
        `plus a dedicated Final Verification task (\`type: "verification"\`, \`priority: 1000\`). ` +
        `A truly single-unit breakdown belongs at Tier 2 with \`selfVerifyOnDone: true\` instead. ` +
        `The single-feature shape [feature × 1 + verification × 1] = 2 tasks is legitimate.`;
      break;
    case 'tier34-missing-final':
      body =
        `Your previous response's Tier ${executionTier} breakdown is missing the Final ` +
        `Verification task (\`type: "verification"\`, \`priority: 1000\`). Every Tier 3/4 ` +
        `breakdown MUST include one — it is the SSOT for install/typecheck/build/test gates. ` +
        `Re-emit the SAME task breakdown with the verification task appended.`;
      break;
    case 'tier34-selfverify-leak':
      body =
        `Your previous response's task "${taskName}" carries \`selfVerifyOnDone: true\` at ` +
        `Tier ${executionTier}. That flag is legal ONLY on the single Tier 2 task — Tier 3/4 ` +
        `work tasks defer build/test/typecheck gates to the dedicated verification task. ` +
        `Re-emit the SAME task breakdown with the flag removed from every non-verification task.`;
      break;
  }
  return (
    '\n\n---\n\n## Retry: tier/task shape contract violation\n' +
    body +
    '\nRe-emit the FULL response (all tags in the required Output Sequence), not just the corrected task.\n'
  );
}

/**
 * Tier-shape contract validation — mirrors `createTaskQueue`'s count/shape
 * gates (responseParser.ts) as a pure check the decompose retry loop can run
 * BEFORE committing, so an LLM shape drift gets a corrective framing retry
 * instead of crashing the job. `createTaskQueue`'s own throws remain as the
 * post-loop backstop.
 *
 * Skips when `executionTier <= 1` (direct path ignores tasks) and when
 * `tasks.length === 0` (the empty-queue case is owned by the specClarify /
 * empty-tasks guard in decompose STEP 4.7 — do not double-judge here).
 */
export function validateTierTaskShape(
  tasks: CodeTask[],
  executionTier: ExecutionTierId,
): void {
  if (executionTier <= 1 || tasks.length === 0) return;

  if (executionTier === 2) {
    if (tasks.length !== 1) {
      throw new TierShapeViolation({
        kind: 'tier2-count',
        executionTier,
        taskCount: tasks.length,
      });
    }
    const sole = tasks[0];
    const isExplain = (sole.type as string) === 'explain';
    const flag = (sole as { selfVerifyOnDone?: boolean }).selfVerifyOnDone;
    if (!isExplain && flag !== true) {
      throw new TierShapeViolation({
        kind: 'tier2-missing-flag',
        executionTier,
        taskCount: tasks.length,
        taskId: sole.id,
        taskName: sole.name,
      });
    }
    return;
  }

  // executionTier >= 3
  if (tasks.length < 2) {
    throw new TierShapeViolation({
      kind: 'tier34-count',
      executionTier,
      taskCount: tasks.length,
    });
  }
  if (!tasks.some(t => isVerificationTask(t))) {
    throw new TierShapeViolation({
      kind: 'tier34-missing-final',
      executionTier,
      taskCount: tasks.length,
    });
  }
  const leaked = tasks.find(
    t => (t as { selfVerifyOnDone?: boolean }).selfVerifyOnDone === true && !isVerificationTask(t),
  );
  if (leaked) {
    throw new TierShapeViolation({
      kind: 'tier34-selfverify-leak',
      executionTier,
      taskCount: tasks.length,
      taskId: leaked.id,
      taskName: leaked.name,
    });
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
  
  // ✅ Check 1: verbatim machine failure signal in directive.
  // SSOT: `core/utils/runtimeErrorPattern.containsMachineFailureSignal` —
  // deliberately stricter than `containsRuntimeErrorPattern`: failure
  // *vocabulary* alone ("this is an error, fix it") must not warn, matching
  // the decompose Task Type Rules ("error" requires a machine signal).
  const hasErrorMessage = containsMachineFailureSignal(directive);

  // ✅ Check 2: If a machine signal exists but no error-type tasks → potential issue
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
  hasExistingCode?: boolean,
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

  // Presence-driven over-decomposition guard (successor to the retired
  // refactor-mode task-count warning): many tasks with no setup task on an
  // existing codebase usually means a modification was over-decomposed.
  // A legitimate fresh rebuild carries a setup task and is exempt.
  if (hasExistingCode && tasks.length > 5 && !tasks.some(t => t.type === 'setup')) {
    console.warn(`
⚠️  [Decompose Validation] ${tasks.length} tasks with no setup task on an existing codebase

   Modifications to existing code usually decompose into a handful of tasks.
   → Review if all tasks are necessary
    `);
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
  
  // ✅ Explain mode: Excessive task count warning
  if (mode === 'explain' && tasks.length > 5) {
    console.warn(`
⚠️  [Decompose Validation] Excessive tasks in ${mode} mode

   Expected: 1-3 tasks for focused changes
   Generated: ${tasks.length} tasks

   → Review if all tasks are necessary
    `);
  }

  // ✅ Check first task for over-broad scope in explain mode
  if (mode === 'explain' && tasks.length > 0) {
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

