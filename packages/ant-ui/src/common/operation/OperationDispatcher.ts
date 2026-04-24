/**
 * OperationDispatcher — cross-cutting async operation FSM.
 *
 * Replaces the "AlertModal + async onConfirm + local isProcessing state"
 * pattern that lived across ~10 call sites (see list in
 * docs/tmp/git-world-greenfield-rewrite-handoff.md §9.5).
 *
 * Usage:
 *   const op = new OperationDispatcher({
 *     run: () => api.transferStart(id),
 *     timeoutMs: 30_000,
 *   });
 *   const result = await op.dispatch();
 *
 * For React, see {@link useOperation} and {@link ConfirmAndDispatch}.
 */

export type OperationStatus = 'idle' | 'running' | 'succeeded' | 'failed';

export interface OperationError {
  message: string;
  cause?: unknown;
  /** If false, the UI should not show a Retry button. */
  retryable?: boolean;
}

export type OperationStateSnapshot<TOut> =
  | { status: 'idle' }
  | { status: 'running'; startedAt: number }
  | { status: 'succeeded'; result: TOut; completedAt: number }
  | { status: 'failed'; error: OperationError; failedAt: number };

export interface OperationDispatcherOptions<TOut> {
  run: () => Promise<TOut>;
  timeoutMs?: number;
  /** Whether to allow `dispatch()` to be re-entered while running. Default: false. */
  reentrant?: boolean;
  onStateChange?: (state: OperationStateSnapshot<TOut>) => void;
}

export class OperationDispatcher<TOut> {
  private state: OperationStateSnapshot<TOut> = { status: 'idle' };
  private inflight: Promise<OperationStateSnapshot<TOut>> | null = null;

  constructor(private readonly opts: OperationDispatcherOptions<TOut>) {}

  getState(): OperationStateSnapshot<TOut> {
    return this.state;
  }

  /**
   * Run the operation. Returns the final terminal state
   * (succeeded/failed). If `reentrant` is false (default) and an
   * operation is in-flight, the current inflight promise is returned.
   */
  async dispatch(): Promise<OperationStateSnapshot<TOut>> {
    if (this.inflight && !this.opts.reentrant) {
      return this.inflight;
    }

    this.transition({ status: 'running', startedAt: Date.now() });

    const timeoutMs = this.opts.timeoutMs;
    const runPromise = this.opts.run();
    const race: Promise<TOut> = timeoutMs
      ? Promise.race([
          runPromise,
          new Promise<TOut>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Operation timed out after ${timeoutMs}ms`)),
              timeoutMs,
            ),
          ),
        ])
      : runPromise;

    this.inflight = race
      .then((result) => {
        const next: OperationStateSnapshot<TOut> = {
          status: 'succeeded',
          result,
          completedAt: Date.now(),
        };
        this.transition(next);
        return next;
      })
      .catch((err) => {
        const next: OperationStateSnapshot<TOut> = {
          status: 'failed',
          error: {
            message: err instanceof Error ? err.message : String(err),
            cause: err,
            retryable: true,
          },
          failedAt: Date.now(),
        };
        this.transition(next);
        return next;
      })
      .finally(() => {
        this.inflight = null;
      });

    return this.inflight;
  }

  reset(): void {
    this.transition({ status: 'idle' });
  }

  private transition(next: OperationStateSnapshot<TOut>): void {
    this.state = next;
    this.opts.onStateChange?.(next);
  }
}
