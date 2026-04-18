/**
 * Async UI Policy — shared async state model.
 *
 * See docs/architecture/ui-async-policy.md for the full rationale.
 * In short: every slice that represents a remote resource stores a flat
 * `AsyncFields<T>`, and selectors compose a discriminated `AsyncResource<T>`
 * view for <AsyncBoundary>. Loading vs. empty vs. error must never share
 * the same surface rendering.
 */
export type AsyncStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export interface AsyncFields<T> {
  status: AsyncStatus;
  data: T | null;
  error: Error | null;
  refreshing: boolean;
}

export type AsyncResource<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: T; refreshing: boolean }
  | { status: 'empty'; refreshing: boolean }
  | { status: 'error'; error: Error };

export const initialAsyncFields = <T>(): AsyncFields<T> => ({
  status: 'idle',
  data: null,
  error: null,
  refreshing: false,
});
