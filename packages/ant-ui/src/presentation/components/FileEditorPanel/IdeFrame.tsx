
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore, type Store } from '@/domain/store';
import { selectIdeSession } from '@/domain/store/selectors/ideSelectors';
import type { IdeSessionState } from '@/domain/store/types';
import { Button } from '@/presentation/components/aurora';
import { IdeStepRail } from '@/presentation/components/common/ide/IdeStepRail';
import type { IdeStepId } from '@/presentation/components/common/ide/IdeStepRail';
import type { IdeLifecycleState } from './types';

export interface IdeFrameProps {
  projectId: string | undefined;
  featureName: string | undefined;
  ideBaseUrl: string | undefined;
  ideWorkspacePath: string | undefined;
  ideReloadTimestamp: number;
}

/**
 * Collapse `IdeSessionState.kind` (rich 7-case discriminated union) into
 * the spec-mandated 5-case `IdeLifecycleState` (spec §5.8).
 */
function lifecycleStateFromSession(session: IdeSessionState): IdeLifecycleState {
  switch (session.kind) {
    case 'idle':
      return 'idle';
    case 'starting':
    case 'frameLoading':
    case 'reconnecting':
      return 'connecting';
    case 'connected':
      return 'running';
    case 'failed':
      return 'error';
    case 'disconnected':
      return 'disconnected';
  }
}

function stepIdFromSession(session: IdeSessionState): IdeStepId | null {
  if (session.kind === 'starting') return session.phase ?? null;
  if (session.kind === 'frameLoading') return 'frame-load';
  return null;
}

/**
 * IdeFrame — Aurora-skinned IDE chrome (base layer).
 *
 * Explicitly branches on the 5-case IdeLifecycleState per spec §5.8.
 * `IdeConnectionPanel` is mounted as a sibling overlay by the caller
 * (App.tsx) — this component only renders the base layer JSX.
 *
 * EXECUTION-CONTEXT: browser-runtime (iframe, fetch, useStore.getState).
 */
export function IdeFrame({
  projectId,
  featureName,
  ideBaseUrl,
  ideWorkspacePath,
  ideReloadTimestamp,
}: IdeFrameProps) {
  const { t } = useTranslation('async');
  const session = useStore(selectIdeSession);
  const startIdeSession = useStore((s: Store) => s.startIdeSession);

  const lifecycle = useMemo<IdeLifecycleState>(
    () => lifecycleStateFromSession(session),
    [session],
  );

  const handleStart = () => {
    if (!projectId) return;
    void startIdeSession(projectId, featureName);
  };

  // Mount the live iframe as soon as the session has a usable baseUrl,
  // even while the lifecycle is still 'connecting' (kind === 'frameLoading'
  // or 'reconnecting'). Without this, the iframe never mounts during
  // frameLoading, so its `onLoad` never fires, so `iframeLoaded()` is
  // never called, so the session is stuck in 'frameLoading' forever.
  // The sibling overlay (IdeConnectionPanel, overlayMode='frameLoading')
  // continues to render the StepRail 'frame-load' label on top of the
  // iframe until onLoad transitions the session to 'connected'.
  const shouldMountIframe =
    !!ideBaseUrl &&
    (session.kind === 'connected' ||
      session.kind === 'frameLoading' ||
      session.kind === 'reconnecting');

  switch (lifecycle) {
    case 'idle':
      return (
        <IdleState
          onStart={handleStart}
          startDisabled={!projectId}
          label={t('ide.startCta', { defaultValue: 'Connect to IDE' })}
        />
      );
    case 'connecting':
      if (shouldMountIframe) {
        return (
          <RunningState
            ideBaseUrl={ideBaseUrl!}
            ideWorkspacePath={ideWorkspacePath}
            ideReloadTimestamp={ideReloadTimestamp}
            projectId={projectId}
            featureName={featureName}
          />
        );
      }
      return <ConnectingState currentStep={stepIdFromSession(session)} />;
    case 'running':
      // The 'connected' branch wraps the live iframe. Without baseUrl we
      // fall back to the connecting visual so the chrome never flashes
      // an empty state.
      if (!ideBaseUrl) return <ConnectingState currentStep={null} />;
      return (
        <RunningState
          ideBaseUrl={ideBaseUrl}
          ideWorkspacePath={ideWorkspacePath}
          ideReloadTimestamp={ideReloadTimestamp}
          projectId={projectId}
          featureName={featureName}
        />
      );
    case 'error':
      return (
        <ErrorState
          message={session.kind === 'failed' ? session.error : ''}
          onRetry={handleStart}
          retryLabel={t('ide.retry', { defaultValue: 'Retry' })}
          retryDisabled={!projectId}
        />
      );
    case 'disconnected':
      return (
        <DisconnectedState
          onReconnect={handleStart}
          label={t('ide.reconnect', { defaultValue: '다시 연결' })}
          reconnectDisabled={!projectId}
        />
      );
  }
}

// ── Sub-states ────────────────────────────────────────────────────────

const CENTER_LAYER: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--bg-canvas)',
};

interface IdleStateProps {
  onStart: () => void;
  startDisabled: boolean;
  label: string;
}

function IdleState({ onStart, startDisabled, label }: IdleStateProps) {
  return (
    <div style={CENTER_LAYER}>
      <div className="flex flex-col items-center gap-5">
        <div
          aria-hidden
          style={{
            width: 76,
            height: 76,
            borderRadius: 'var(--r-2xl)',
            background: 'var(--gradient-aurora)',
            backgroundSize: '200% 200%',
            boxShadow: 'var(--shadow-glow-aurora)',
            animation: 'gradient-shift 5s ease-in-out infinite',
          }}
        />
        <Button size="lg" onClick={onStart} disabled={startDisabled} glow>
          {label}
        </Button>
      </div>
    </div>
  );
}

interface ConnectingStateProps {
  currentStep: IdeStepId | null;
}

function ConnectingState({ currentStep }: ConnectingStateProps) {
  return (
    <div style={CENTER_LAYER}>
      <div className="flex flex-col items-center gap-6 max-w-md w-full px-6">
        <div
          aria-hidden
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: 'var(--gradient-aurora)',
            backgroundSize: '200% 200%',
            boxShadow: 'var(--shadow-glow-aurora)',
            animation:
              'gradient-shift 3.5s ease-in-out infinite, float-y 3.6s ease-in-out infinite',
          }}
        />
        <div className="w-full">
          <IdeStepRail currentStep={currentStep} />
        </div>
      </div>
    </div>
  );
}

interface RunningStateProps {
  ideBaseUrl: string;
  ideWorkspacePath: string | undefined;
  ideReloadTimestamp: number;
  projectId: string | undefined;
  featureName: string | undefined;
}

function RunningState({
  ideBaseUrl,
  ideWorkspacePath,
  ideReloadTimestamp,
  projectId,
  featureName,
}: RunningStateProps) {
  const handleLoad = async () => {
    try {
      const res = await fetch(`${ideBaseUrl}/`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      });
      if (res.status >= 200 && res.status < 400) {
        useStore.getState().iframeLoaded();
      } else if (projectId) {
        useStore.getState().iframeLoadFailed?.('Proxy returned an error status');
        void useStore.getState().startIdeSession(projectId, featureName);
      }
    } catch {
      // network error — let the health monitor's probe pick it up.
    }
  };

  return (
    <div
      className="relative w-full h-full"
      style={{
        background: 'var(--bg-canvas)',
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: -2,
          background: 'var(--gradient-aurora)',
          opacity: 0.25,
          filter: 'blur(14px)',
          zIndex: -1,
          borderRadius: 'var(--r-lg)',
          pointerEvents: 'none',
        }}
      />
      <div
        className="w-full h-full overflow-hidden"
        style={{
          border: '1.5px solid var(--border-2)',
          borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--shadow-sm)',
          background: 'var(--bg-canvas)',
        }}
      >
        <iframe
          key={`ide-${featureName || 'base'}-${ideReloadTimestamp}`}
          src={`${ideBaseUrl}/?folder=${encodeURIComponent(
            ideWorkspacePath || '/workspace',
          )}&tk=${ideReloadTimestamp}`}
          className="w-full h-full"
          style={{ border: 'none' }}
          title="ANT Code Editor"
          onLoad={handleLoad}
        />
      </div>
    </div>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry: () => void;
  retryLabel: string;
  retryDisabled: boolean;
}

function ErrorState({ message, onRetry, retryLabel, retryDisabled }: ErrorStateProps) {
  return (
    <div style={CENTER_LAYER}>
      <div
        className="flex flex-col items-center gap-4 max-w-md w-full px-6 py-6"
        style={{
          background: 'var(--status-error-bg)',
          border: '1px solid var(--status-error-fg)',
          borderRadius: 'var(--r-lg)',
        }}
      >
        <div
          aria-hidden
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: 'var(--status-error-fg)',
            opacity: 0.85,
          }}
        />
        {message && (
          <p
            className="text-sm text-center"
            style={{ color: 'var(--status-error-fg)' }}
          >
            {message}
          </p>
        )}
        <Button size="md" variant="outline" onClick={onRetry} disabled={retryDisabled}>
          {retryLabel}
        </Button>
      </div>
    </div>
  );
}

interface DisconnectedStateProps {
  onReconnect: () => void;
  label: string;
  reconnectDisabled: boolean;
}

function DisconnectedState({
  onReconnect,
  label,
  reconnectDisabled,
}: DisconnectedStateProps) {
  return (
    <div style={CENTER_LAYER}>
      <div className="flex flex-col items-center gap-5">
        <div
          aria-hidden
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: 'var(--bg-surface-2)',
            border: '2px solid var(--border-2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-3)',
            fontSize: 24,
            fontWeight: 700,
          }}
        >
          ⊘
        </div>
        <Button size="md" onClick={onReconnect} disabled={reconnectDisabled}>
          {label}
        </Button>
      </div>
    </div>
  );
}
