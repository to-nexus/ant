/**
 * Shared task classification helpers.
 *
 * `isDiagnosticTask` preserves the legacy semantic where verification-style
 * plan logic (diagnostic retry context, batch split, etc.) applied to both
 * `verification` and `error` task types. Callers that previously asked
 * "is this a verification-or-error task?" should use this helper instead
 * of open-coding the disjunction.
 *
 * Strict per-type classification (e.g. `isVerificationTask`,
 * `isErrorTask`) lives in each task's `model/is.ts` module (T3 / T5b.1).
 */
export type TaskLike = { type?: string } | null | undefined;

export function isDiagnosticTask(task: TaskLike): boolean {
  const type = task?.type;
  return type === 'verification' || type === 'error';
}
