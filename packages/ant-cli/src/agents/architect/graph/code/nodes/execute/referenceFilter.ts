/**
 * Reference Context Filtering
 * 
 * Extracted from original execute/index.ts:
 * - filterReferencesForTask: Filter reference contexts by task relevance
 */

import { ReferenceContext } from "../../../../../../core/codebase/types";

/**
 * Filter reference contexts for current task
 * Only include references that are relevant to this specific task
 */
export function filterReferencesForTask(
  allReferences: ReferenceContext[] | undefined,
  refsByTask: Map<string, Array<{project: string; branch?: string}>> | undefined,
  taskId: string
): ReferenceContext[] | undefined {
  if (!allReferences || !refsByTask) {
    return allReferences;  // No filtering needed
  }
  
  const taskRefs = refsByTask.get(taskId);
  if (!taskRefs || taskRefs.length === 0) {
    return undefined;  // This task doesn't need any references
  }
  
  // Filter references to only include those needed by this task
  const filtered = allReferences.filter(ref => {
    return taskRefs.some(taskRef => 
      taskRef.project === ref.project && 
      (!taskRef.branch || taskRef.branch === ref.branch)
    );
  });
  
  if (filtered.length > 0) {
    console.log(`   📚 Filtered ${filtered.length}/${allReferences.length} reference(s) for task ${taskId}`);
  }
  
  return filtered.length > 0 ? filtered : undefined;
}
