import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './presentation/App';
import './index.css';
import './i18n';

if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Last-line-of-defence error boundary for the entire application tree.
 *
 * Role (Async UI Policy — see docs/architecture/ui-async-policy.md):
 *   - RootErrorBoundary handles UNCAUGHT render-phase crashes that escape
 *     every downstream boundary. The fallback is a full-screen reload card
 *     because the app state is assumed unrecoverable at this point.
 *   - Resource-level failures (HTTP 4xx/5xx, slice `status: 'error'`, etc.)
 *     MUST NOT bubble here — they surface through the local
 *     <AsyncBoundary> that owns the resource and render a surface-aware
 *     error fallback with a Retry affordance.
 *
 * Do not add resource-specific retry logic to this component; that belongs
 * to the slice action (e.g. `fetchProjectConfig` / `fetchProjects`) and the
 * boundary that subscribes to it.
 */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught render error:', error);
    console.error('[ErrorBoundary] Component stack:', info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '100vh', fontFamily: 'system-ui, sans-serif', padding: '2rem', textAlign: 'center',
          background: '#0a0a0a', color: '#e5e5e5',
        }}>
          <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>Something went wrong</div>
          <div style={{ color: '#a3a3a3', marginBottom: '0.5rem', maxWidth: '480px' }}>
            An unexpected error crashed the UI. This has been logged to the console.
          </div>
          <code style={{
            display: 'block', padding: '0.75rem 1rem', borderRadius: '6px',
            background: '#1a1a1a', color: '#f87171', fontSize: '0.8rem',
            maxWidth: '480px', wordBreak: 'break-word', marginBottom: '1.5rem',
          }}>
            {this.state.error?.message || 'Unknown error'}
          </code>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '0.6rem 1.5rem', borderRadius: '6px', border: 'none', cursor: 'pointer',
              background: '#3b82f6', color: '#fff', fontSize: '0.9rem', fontWeight: 500,
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(rootElement).render(
  <RootErrorBoundary>
    <BrowserRouter basename="/app">
      <App />
    </BrowserRouter>
  </RootErrorBoundary>
);
