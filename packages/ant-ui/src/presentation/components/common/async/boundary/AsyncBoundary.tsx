import type { ReactNode } from 'react';
import type { AsyncResource } from '@/domain/async';
import { useAsyncDisplay } from '../hooks';
import { AsyncErrorBoundary } from './ErrorBoundary';
import { PRESETS, type Surface } from './presets';
import { LoadingFallback, EmptyFallback, ErrorFallback } from './fallbacks';

export interface AsyncBoundaryProps<T> {
  /** Visual surface this boundary lives on. Controls timing + loading shape. */
  surface: Surface;
  /** Composed resource view (see useAsyncResource). */
  resource: AsyncResource<T>;
  /** Called by the default error fallback's Retry button. */
  retry?: () => void;
  /** Optional overrides for each state. */
  loading?: ReactNode;
  empty?: ReactNode;
  error?: (error: Error, retry?: () => void) => ReactNode;
  /** Rendered when resource.status === 'ready'. */
  children: (data: T, meta: { refreshing: boolean }) => ReactNode;
}

/**
 * The single entry point for resource-driven UI. Callers pass a
 * `surface` to pick a coherent visual preset (timing + loading shape),
 * plus a `resource` composed by `useAsyncResource`.
 *
 * Timing policy lives in useAsyncDisplay + presets; this component just
 * wires them together with an error boundary.
 */
export function AsyncBoundary<T>({
  surface,
  resource,
  retry,
  loading,
  empty,
  error,
  children,
}: AsyncBoundaryProps<T>) {
  const preset = PRESETS[surface];
  const display = useAsyncDisplay(resource.status, preset);

  const renderError = (e: Error, r?: () => void): ReactNode =>
    error ? error(e, r) : <ErrorFallback error={e} retry={r} compact={surface === 'inline'} />;

  return (
    <AsyncErrorBoundary
      resetKey={resource.status}
      fallback={(e) => renderError(e, retry)}
    >
      {renderBody()}
    </AsyncErrorBoundary>
  );

  function renderBody(): ReactNode {
    switch (resource.status) {
      case 'idle':
      case 'loading':
        if (!display.showLoading) return null;
        return loading ?? <LoadingFallback shape={preset.loadingShape} longWait={display.longWait} />;
      case 'empty':
        return empty ?? <EmptyFallback />;
      case 'error':
        return renderError(resource.error, retry);
      case 'ready':
        return children(resource.data, { refreshing: resource.refreshing });
    }
  }
}
