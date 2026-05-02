/**
 * InputSanitizer — wraps user-controlled content in boundary tags
 * to mitigate prompt injection attacks.
 *
 * User-provided fields (directive) and document contents are enclosed
 * in XML-like boundary markers so the LLM can distinguish system
 * instructions from user data.
 */

// Fields that carry user-authored content and need boundary wrapping
const USER_CONTENT_FIELDS = new Set([
  'directive',
]);

/**
 * Wrap a single user-provided string in boundary tags.
 * Empty/falsy values pass through unchanged.
 */
export function wrapUserContent(value: string, fieldName: string): string {
  if (!value) return value;
  return [
    `<user_provided_content type="${fieldName}">`,
    value,
    `</user_provided_content>`,
  ].join('\n');
}

/**
 * Apply boundary-tag wrapping to every user-controlled field inside a
 * template variable map.  Non-string values and fields that are not in
 * the USER_CONTENT_FIELDS set are returned unchanged.
 */
export function sanitizeInjectionVars(
  vars: Record<string, any>,
): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (key === 'documents' && Array.isArray(value)) {
      result[key] = value.map((doc: any) => ({
        ...doc,
        content: typeof doc.content === 'string' && doc.content.length > 0
          ? wrapUserContent(doc.content, doc.label || doc.path)
          : doc.content,
      }));
    } else if (USER_CONTENT_FIELDS.has(key) && typeof value === 'string' && value.length > 0) {
      result[key] = wrapUserContent(value, key);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Tracks task IDs that have already been processed by plan-keyword
 * within a single job to prevent duplicate LLM calls.
 */
export class KeywordDeduplicator {
  private processed = new Map<string, number>();

  /**
   * Returns true if this task ID has already been processed.
   * Automatically registers the task on first call.
   */
  isDuplicate(taskId: string): boolean {
    const count = this.processed.get(taskId) ?? 0;
    this.processed.set(taskId, count + 1);
    return count > 0;
  }

  /** Number of times a task has been seen (0 if never). */
  getCallCount(taskId: string): number {
    return this.processed.get(taskId) ?? 0;
  }

  reset(): void {
    this.processed.clear();
  }

  /** Clear the dedup record for a single task (used on batch-split re-queue
   *  so the parent task's keyword RAG re-fires on its next plan entry). */
  delete(taskId: string): void {
    this.processed.delete(taskId);
  }
}
