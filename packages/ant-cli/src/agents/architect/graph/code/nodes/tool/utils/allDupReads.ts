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

type RepeatErrorEvent = {
  toolName: string;
  args?: Record<string, any>;
  result: { error?: string; sideEffects?: Array<Record<string, any>> };
};

/**
 * Command-history label(s) for an event — the SSOT derivation shared by the
 * afterBatch recorder and `isAllRepeatErrorBatch`. run_command events are
 * labelled by their `commandExecuted` side-effect command string(s); every
 * other tool by `tool:<name>[:<path>]` (tight-drafting-lever convention).
 */
export function commandLabelsForEvent(event: RepeatErrorEvent): string[] {
  const commandLabels = (event.result.sideEffects || [])
    .filter(e => e.type === 'commandExecuted' && typeof e.command === 'string')
    .map(e => e.command as string);
  if (commandLabels.length > 0) return commandLabels;
  const target = typeof event.args?.path === 'string' ? `:${event.args.path}` : '';
  return [`tool:${event.toolName}${target}`];
}

/**
 * The error-flavored twin of `isAllDupReadBatch` (trim-grinding-motif RCA:
 * 371 identical `read_file` "File not found" calls — every one ERRORED, so
 * the all-dup-reads predicate stayed false and no brake counted the loop).
 *
 * A batch is provably zero-information when EVERY call errored AND every
 * call's command label already has a FAILURE entry in the pre-batch command
 * history — i.e. the model is re-issuing calls it has already watched fail.
 * The first occurrence of any failure keeps the batch informative (the model
 * just learned something new).
 */
export function isAllRepeatErrorBatch(
  executionEvents: RepeatErrorEvent[],
  priorCommandHistory: Array<{ command: string; success: boolean }> | undefined,
): boolean {
  if (executionEvents.length === 0 || !priorCommandHistory?.length) return false;
  const priorFailures = new Set(
    priorCommandHistory.filter(h => !h.success).map(h => h.command),
  );
  if (priorFailures.size === 0) return false;
  return executionEvents.every(e =>
    e.result.error && commandLabelsForEvent(e).some(label => priorFailures.has(label)),
  );
}
