import type { AsyncFields, AsyncResource } from './types';

/**
 * Pure view selector — never caches. Call with primitive-decomposed inputs
 * from a React component (see useAsyncResource) to avoid zustand ref-equality
 * issues.
 */
export function selectAsync<T>(f: AsyncFields<T>): AsyncResource<T> {
  switch (f.status) {
    case 'idle':
      return { status: 'idle' };
    case 'loading':
      return { status: 'loading' };
    case 'error':
      return { status: 'error', error: f.error ?? new Error('Unknown error') };
    case 'empty':
      return { status: 'empty', refreshing: f.refreshing };
    case 'ready':
      if (f.data == null) return { status: 'empty', refreshing: f.refreshing };
      return { status: 'ready', data: f.data, refreshing: f.refreshing };
  }
}
