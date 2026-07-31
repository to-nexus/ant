import type { KanbanData } from '@/infrastructure/http/api';

/**
 * Does an incoming kanban frame carry enough to name a job?
 *
 * A frame with no `jobId` AND no tasks in any column identifies nothing — it is
 * what the backend emits for a jobType whose session file does not exist
 * (`projectSessionStateToKanban({}, undefined, jobType, false)`). Applying its
 * *board* is correct (that jobType really has no work), but letting it write
 * `currentJobId` would erase the selected job and drop the job-ID chip.
 *
 * SSOT: the `kanbanReducer` completion branch and its `else` branch both gate
 * their `currentJobId` write on this one predicate so they cannot drift.
 */
export function frameCarriesJobIdentity(
  data: Pick<KanbanData, 'jobId' | 'todo' | 'inProgress' | 'completed'>,
): boolean {
  if (data.jobId) return true;
  return (
    (data.todo?.length ?? 0) > 0 ||
    (data.inProgress?.length ?? 0) > 0 ||
    (data.completed?.length ?? 0) > 0
  );
}
