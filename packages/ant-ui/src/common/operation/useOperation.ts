/**
 * useOperation — React binding for {@link OperationDispatcher}.
 *
 * Manages a stable dispatcher instance + rendered state. Unlike the old
 * pattern of local `useState<boolean> isProcessing`, the returned object
 * surfaces full FSM info (status, error, result) so consumers can render
 * rich state (retry buttons, elapsed time, etc.) without duplicating logic.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  OperationDispatcher,
  OperationStateSnapshot,
  OperationDispatcherOptions,
} from './OperationDispatcher';

export interface UseOperationReturn<TOut> {
  state: OperationStateSnapshot<TOut>;
  isRunning: boolean;
  isFailed: boolean;
  error: OperationStateSnapshot<TOut> extends { status: 'failed'; error: infer E } ? E : any;
  dispatch: () => Promise<OperationStateSnapshot<TOut>>;
  reset: () => void;
}

export function useOperation<TOut>(
  options: OperationDispatcherOptions<TOut>,
): UseOperationReturn<TOut> {
  const [state, setState] = useState<OperationStateSnapshot<TOut>>({ status: 'idle' });

  // Store the options in a ref so a changing `run` (common when it
  // captures local closures) doesn't reset the dispatcher each render.
  const optsRef = useRef(options);
  optsRef.current = options;

  const dispatcher = useMemo(() => {
    return new OperationDispatcher<TOut>({
      run: () => optsRef.current.run(),
      get timeoutMs() {
        return optsRef.current.timeoutMs;
      },
      reentrant: options.reentrant,
      onStateChange: (next) => setState(next),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dispatch = useCallback(() => dispatcher.dispatch(), [dispatcher]);
  const reset = useCallback(() => dispatcher.reset(), [dispatcher]);

  return {
    state,
    isRunning: state.status === 'running',
    isFailed: state.status === 'failed',
    error: state.status === 'failed' ? state.error : null,
    dispatch,
    reset,
  } as UseOperationReturn<TOut>;
}
