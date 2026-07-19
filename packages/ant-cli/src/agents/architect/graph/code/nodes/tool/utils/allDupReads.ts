/**
 * `_lastToolBatchAllDupReads` predicate (pure, testable in isolation).
 *
 * A tool batch is provably zero-information when EVERY call in it was a
 * successful `read_file` whose body the duplicate-read elision replaced with
 * a stub — i.e. content byte-identical to an earlier read of the same
 * (path, range). Any novel read, non-read tool, or errored call makes the
 * batch informative and returns `false`.
 *
 * Feeds the no-progress circuit breaker (rocky-beating-coral RCA): the
 * execute node increments `_noProgressStreak` on turns whose preceding batch
 * was all-duplicate. See `state.ts` `NO_PROGRESS_HARD_CAP`.
 */
export function isAllDupReadBatch(
  executionEvents: Array<{ toolName: string; result: { error?: string } }>,
  elidedCount: number,
): boolean {
  return (
    executionEvents.length > 0 &&
    executionEvents.every(e => e.toolName === 'read_file' && !e.result.error) &&
    elidedCount === executionEvents.length
  );
}
