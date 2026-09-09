/**
 * Typed queue errors.
 *
 * A same-id re-enqueue whose BullMQ lock is still being extended means a live
 * worker owns the job — a legitimate, temporary refusal, not a server fault.
 * It used to be a bare `Error`, so the resume route could only answer an
 * opaque 500 that the FE dropped on the floor: the button did nothing for the
 * ~2.5 minutes the stale lock takes to decay. The DECISION stays where it was
 * (`enqueue` + `isJobLockFresh` remain the single owner of "is a worker
 * alive"); only its shape changes, so a caller can answer 409 with a retry
 * hint instead of guessing from a message string.
 */
export class JobLockActiveError extends Error {
  readonly code = 'job-lock-active' as const;
  constructor(readonly jobId: string, readonly ttlMs: number) {
    super(`Job ${jobId} is still being processed by an active worker`);
    this.name = 'JobLockActiveError';
  }
}

export function isJobLockActiveError(err: unknown): err is JobLockActiveError {
  return err instanceof JobLockActiveError || (err as any)?.code === 'job-lock-active';
}
