import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore, type Store } from '@/domain/store';
import {
  selectIdeOverlayMode,
  selectIdeStartupPhase,
  selectIdeStuckSince,
  selectIdeSession,
  selectIdeConnectError,
  selectIdeElapsedMs,
} from '@/domain/store/selectors/ideSelectors';
import { Spinner } from '../async/primitives/Spinner';
import { IdeStepRail } from './IdeStepRail';
import type { IdeStepId } from './IdeStepRail';
import { IdeDisconnectActions } from './IdeDisconnectActions';
import { IdeForceResetButton } from './IdeForceResetButton';

export interface IdeConnectionPanelProps {
  projectId: string;
  featureName?: string;
}

/**
 * Single SSOT for the IDE iframe overlay. Renders one of 9 overlay modes
 * (selectIdeOverlayMode → IdeOverlayMode), passing the relevant union fields
 * down to the sub-views. The parent (CodeIdeView in App.tsx) only decides
 * `mount/unmount` based on `overlayMode !== 'hidden'`.
 */
export function IdeConnectionPanel({ projectId, featureName }: IdeConnectionPanelProps) {
  const overlayMode = useStore(selectIdeOverlayMode);
  if (overlayMode === 'hidden') return null;
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/95 backdrop-blur-sm">
      <div className="max-w-3xl w-full mx-6">
        <PanelBody projectId={projectId} featureName={featureName} />
      </div>
    </div>
  );
}

function PanelBody({ projectId, featureName }: IdeConnectionPanelProps) {
  const { t } = useTranslation('async');
  const overlayMode = useStore(selectIdeOverlayMode);
  const phase = useStore(selectIdeStartupPhase);
  const stuckSince = useStore(selectIdeStuckSince);
  const session = useStore(selectIdeSession);
  const failedError = useStore(selectIdeConnectError);

  const startIdeSession = useStore((s: Store) => s.startIdeSession);
  const requestReconnect = useStore((s: Store) => s.requestReconnect);
  const forceResetIdeSession = useStore((s: Store) => s.forceResetIdeSession);
  const closeIdeSession = useStore((s: Store) => s.closeIdeSession);

  // Drive a 1s tick so elapsed counters refresh.
  const elapsedSeconds = useTickingElapsedSeconds();

  // Step ID derived from kind + phase.
  const currentStep: IdeStepId | null = useMemo(() => {
    if (session.kind === 'starting') {
      return session.phase ?? null;
    }
    if (session.kind === 'frameLoading') return 'frame-load';
    return null;
  }, [session]);

  const isStuck = stuckSince !== undefined;
  const isFailed = overlayMode === 'failed';

  // Header copy varies by mode.
  let header: string | null = null;
  if (overlayMode === 'disconnectedHard' || overlayMode === 'disconnectedSoft' || overlayMode === 'reconnecting') {
    header = t('ide.disconnected.title');
  } else if (overlayMode === 'failed') {
    header = t('ide.failed', { message: failedError ?? '' });
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      {header && (
        <h3 className="text-base font-semibold text-[color:var(--text-1)] mb-4">{header}</h3>
      )}

      {(overlayMode === 'starting' ||
        overlayMode === 'progressing' ||
        overlayMode === 'stuck' ||
        overlayMode === 'frameLoading') && (
        <>
          <IdeStepRail
            currentStep={currentStep}
            elapsedSeconds={elapsedSeconds}
            isStuck={isStuck}
            isFailed={isFailed}
          />
          {isStuck && phase && (
            <div className="mt-4 flex items-start gap-3 rounded-md border border-rose-200 bg-rose-50 p-3">
              <p className="text-sm text-rose-700 flex-1">
                {t('ide.stuck.banner', {
                  step: t(`ide.step.${stepKeyFromPhase(phase)}`),
                  seconds: elapsedSeconds,
                })}
              </p>
              <IdeForceResetButton
                onConfirm={() => void forceResetIdeSession(projectId, featureName)}
                emphasized
              />
            </div>
          )}
        </>
      )}

      {overlayMode === 'disconnectedSoft' && (
        <div className="flex items-center gap-3 py-2">
          <Spinner size="sm" tone="muted" />
          <span className="text-sm text-[color:var(--text-3)]">
            {t('ide.disconnected.softProbing')}
          </span>
        </div>
      )}

      {overlayMode === 'reconnecting' && (
        <div className="flex items-center gap-3 py-2">
          <Spinner size="sm" tone="accent" />
          <span className="text-sm text-[color:var(--text-3)]">
            {t('ide.disconnected.reconnecting')}
          </span>
        </div>
      )}

      {(overlayMode === 'disconnectedHard' || overlayMode === 'failed') && (
        <>
          {overlayMode === 'disconnectedHard' && elapsedSeconds > 0 && (
            <p className="text-sm text-[color:var(--text-3)] mb-4">
              {t('ide.disconnected.since', { seconds: elapsedSeconds })}
            </p>
          )}
          <IdeDisconnectActions
            onReconnect={() => void requestReconnect()}
            onRestart={() => void startIdeSession(projectId, featureName)}
            onForceReset={() => void forceResetIdeSession(projectId, featureName)}
            onClose={() => void closeIdeSession(projectId, featureName)}
          />
        </>
      )}
    </div>
  );
}

/**
 * Re-render once per second so the "Xs elapsed" label updates. Only mounted
 * inside `PanelBody`, which itself is rendered only when overlayMode !== 'hidden',
 * so the timer always has a visible consumer.
 */
function useTickingElapsedSeconds(): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const elapsed = useStore((s) => selectIdeElapsedMs(s, now));
  return Math.max(0, Math.floor(elapsed / 1000));
}

function stepKeyFromPhase(phase: NonNullable<ReturnType<typeof selectIdeStartupPhase>>): string {
  switch (phase) {
    case 'pod-pending':
      return 'podPending';
    case 'image-pulling':
      return 'imagePulling';
    case 'container-ready':
      return 'containerReady';
    case 'http-ready':
      return 'httpReady';
  }
}
