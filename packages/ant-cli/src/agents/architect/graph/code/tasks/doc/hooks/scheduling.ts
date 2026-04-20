/**
 * doc/hooks/scheduling.ts — TaskSchedulingHook
 *
 * Replaces the type-specific branch in `parallel/TaskOrchestrator.ts`
 * L667 / L738:
 *
 *     if (hasPreDocWork && task.type === 'doc') break;
 *
 * Doc tasks describe the code that was written, so they must wait for
 * feature + setup + test-code work to finish before they can document
 * the final shape.
 */

export const preDocBarrier = true;
