import React from 'react';

export interface AsyncErrorBoundaryProps {
  children: React.ReactNode;
  fallback: (error: Error, reset: () => void) => React.ReactNode;
  /**
   * When this value changes, the boundary clears its captured error.
   * AsyncBoundary passes the resource status here so a transition from
   * `error` back to `loading` / `ready` automatically recovers the subtree
   * — otherwise the boundary would stay stuck on the error fallback even
   * after the underlying resource recovered.
   */
  resetKey?: unknown;
}

interface AsyncErrorBoundaryState {
  error: Error | null;
}

/**
 * Local error boundary used by <AsyncBoundary>. Catches render-phase errors
 * inside a resource subtree so they surface as the boundary's error fallback
 * rather than bubbling to the root <RootErrorBoundary>.
 *
 * Distinction: RootErrorBoundary (main.tsx) = application last-defense;
 * AsyncErrorBoundary = resource-level UX fallback.
 */
export class AsyncErrorBoundary extends React.Component<
  AsyncErrorBoundaryProps,
  AsyncErrorBoundaryState
> {
  state: AsyncErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AsyncErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[AsyncBoundary] render error', error, info.componentStack);
  }

  componentDidUpdate(prevProps: AsyncErrorBoundaryProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.reset();
    }
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error, this.reset);
    }
    return this.props.children;
  }
}
