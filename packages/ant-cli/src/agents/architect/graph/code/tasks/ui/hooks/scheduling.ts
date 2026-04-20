/**
 * ui/hooks/scheduling.ts — TaskSchedulingHook
 *
 * Replaces the type-specific branch in `parallel/TaskOrchestrator.ts`
 * L672 / L739:
 *
 *     if (hasPreUiWork && task.type === 'ui') break;
 *
 * Once T6 flips the orchestrator to query hooks, the branch becomes:
 *
 *     const sched = hooksForTaskType(task.type)?.scheduling;
 *     if (hasPreUiWork && sched?.preUiBarrier) break;
 *
 * The barrier fires whenever any foundation work (feature / setup) is
 * still running — UI tasks need the layout / data scaffolding in place
 * before they can render.
 */

export const preUiBarrier = true;
