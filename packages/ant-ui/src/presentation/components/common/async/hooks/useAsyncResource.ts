import { useMemo } from 'react';
import { useStore } from '@/domain/store';
import type { AsyncFields, AsyncResource } from '@/domain/async';
import { selectAsync } from '@/domain/async';

/**
 * Preferred hook for consuming an AsyncFields<T> slice.
 *
 * Why this exists: Zustand compares selector output by reference. Returning
 * a fresh object from `useStore(s => selectAsync(s.foo))` on every render
 * causes unnecessary re-subscribes. This helper decomposes the four primitive
 * fields, subscribes to each individually, and memoises the composed view.
 */
export function useAsyncResource<T>(pick: (s: any) => AsyncFields<T>): AsyncResource<T> {
  const status = useStore((s) => pick(s).status);
  const data = useStore((s) => pick(s).data as T | null);
  const error = useStore((s) => pick(s).error);
  const refreshing = useStore((s) => pick(s).refreshing);
  return useMemo(
    () => selectAsync<T>({ status, data, error, refreshing }),
    [status, data, error, refreshing],
  );
}
