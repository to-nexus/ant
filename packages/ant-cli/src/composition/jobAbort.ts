/**
 * Job Abort Registry
 *
 * Process-scoped AbortController for the single job a job-runner child runs.
 * Mirrors gracefulShutdown.ts's module-level registry pattern: the controller
 * is a non-serializable runtime handle, NOT checkpoint state, so it lives here
 * rather than on a LangGraph channel. One child = one job = one controller.
 *
 * Tripping the controller (abortJob) interrupts the in-flight LLM stream
 * (the signal is threaded into the Anthropic SDK request options) and flips
 * the cooperative `_isStopRequested` checkpoints (via isJobAborted) so no new
 * work is requested even by adapters that ignore the signal.
 *
 * @see job-runner.ts        — STOP subscription / poll → abortJob() + self-SIGTERM
 * @see AnthropicLLMClient.ts — threads getJobAbortSignal() into messages.create
 * @see TaskWorker.ts         — _isStopRequested OR isJobAborted()
 */

let controller: AbortController | null = null;

function ensure(): AbortController {
  if (!controller) controller = new AbortController();
  return controller;
}

/** AbortSignal for the active job. Threaded into LLM stream request options. */
export function getJobAbortSignal(): AbortSignal {
  return ensure().signal;
}

/** Trip the abort. Idempotent — repeated calls are no-ops. */
export function abortJob(): void {
  const c = ensure();
  if (!c.signal.aborted) c.abort();
}

/** True once the job has been aborted by a user stop. */
export function isJobAborted(): boolean {
  return controller?.signal.aborted === true;
}
