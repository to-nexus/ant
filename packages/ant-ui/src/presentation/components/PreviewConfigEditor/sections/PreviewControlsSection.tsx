
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AlertCircle, ArrowRight, Box, X } from 'lucide-react';
import { Spinner } from '@/presentation/components/common/async';
import type { PreviewStatus } from '@/infrastructure/http/api';
import {
  SectionCard,
  IdentityOrb,
  SignalRing,
} from '@/presentation/components/ConfigEditor/aurora';
import type { SignalRingState } from '@/presentation/components/ConfigEditor/aurora';

interface PhaseAccent {
  color: string;
  label: string;
  ring: SignalRingState;
  grad: string;
  icon: string;
}

function c3vPhaseAccent(
  phase: string,
  t: TFunction,
): PhaseAccent {
  switch (phase) {
    case 'running':
      return {
        color: 'oklch(45% 0.16 155)',
        label: t('preview.running', '실행 중'),
        ring: 'running',
        grad: 'linear-gradient(135deg, oklch(60% 0.18 155), oklch(58% 0.18 175))',
        icon: 'Check',
      };
    case 'starting':
      return {
        color: 'var(--violet-700)',
        label: t('preview.starting', '시작 중'),
        ring: 'starting',
        grad: 'var(--gradient-violet-pink)',
        icon: 'Play',
      };
    case 'installing':
      return {
        color: 'oklch(50% 0.20 290)',
        label: t('preview.installing', '의존성 설치 중'),
        ring: 'starting',
        grad: 'var(--gradient-violet-pink)',
        icon: 'Sparkles',
      };
    case 'stopping':
      return {
        color: 'oklch(50% 0.18 50)',
        label: t('preview.stopping', '정지 중'),
        ring: 'starting',
        grad: 'var(--gradient-pink-orange)',
        icon: 'Play',
      };
    case 'error':
      return {
        color: 'var(--status-error-fg)',
        label: t('preview.startFailed', '시작 실패'),
        ring: 'error',
        grad: 'linear-gradient(135deg, oklch(60% 0.20 25), oklch(56% 0.22 15))',
        icon: 'AlertCircle',
      };
    default:
      return {
        color: 'var(--text-3)',
        label: t('preview.notRunning', '실행 안 됨'),
        ring: 'idle',
        grad: 'linear-gradient(135deg, var(--bg-surface-3), var(--bg-surface-2))',
        icon: 'Play',
      };
  }
}

function c3vBigBtn({
  bg,
  fg,
  glow,
  border,
  disabled,
}: {
  bg: string;
  fg: string;
  glow?: string;
  border?: string;
  disabled?: boolean;
}): React.CSSProperties {
  return {
    height: 38,
    padding: '0 16px',
    borderRadius: 'var(--r-md)',
    fontSize: 13,
    fontWeight: 700,
    border: border ?? 'none',
    background: bg,
    color: fg,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    transition: 'transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease',
    boxShadow: glow ?? 'none',
    letterSpacing: '-0.005em',
  };
}

export function PreviewControlsSection({
  phase,
  isRunning,
  isReady,
  previewStatus,
  isPreviewLoading,
  isJobRunning,
  dismissedSet,
  onStart,
  onStop,
  onRestart,
  onOpenPreview,
  onDismissError,
}: {
  phase: string;
  isRunning: boolean;
  isReady: boolean;
  previewStatus: PreviewStatus | undefined;
  isPreviewLoading: boolean;
  isJobRunning: boolean;
  dismissedSet: Set<string>;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onOpenPreview: (targetUrl?: string) => void;
  onDismissError: (key: string) => void;
}) {
  const { t } = useTranslation('explorer');
  const accent = c3vPhaseAccent(phase, t);

  const startupReason = previewStatus?.setupReason || previewStatus?.setupReasoning;
  const startupError = phase === 'error' ? startupReason : undefined;
  const showStartupError =
    !!startupError && !dismissedSet.has(`startup:${startupError}`);

  const openableFrontends = useMemo(
    () =>
      (previewStatus?.packages || []).filter(
        (p) => p.type === 'frontend' && !!p.url,
      ),
    [previewStatus?.packages],
  );
  const singleOpenUrl =
    openableFrontends.length === 1
      ? openableFrontends[0]?.url ?? previewStatus?.url ?? null
      : previewStatus?.url ?? null;
  const showSingleOpen =
    isRunning && isReady && openableFrontends.length <= 1 && !!singleOpenUrl;
  const showMultiOpen =
    isRunning && isReady && openableFrontends.length > 1;

  // Disabled tooltips
  const startDisabledTitle = isJobRunning
    ? t('preview.jobRunning', 'A job is running')
    : isPreviewLoading
      ? t('preview.cannotStart', 'Cannot start preview')
      : undefined;

  return (
    <SectionCard
      icon="Play"
      title={t('preview.controls', '라이브 컨트롤')}
      description={t(
        'preview.controlsDesc',
        '프리뷰 서버 상태와 패키지별 접속 URL을 한곳에서 관리합니다.',
      )}
      accent="aurora"
      padded={false}
    >
      {/* Hero row: orb + status + actions */}
      <div
        style={{
          position: 'relative',
          padding: '18px 20px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          flexWrap: 'wrap',
        }}
      >
        {/* Halo behind the orb */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: 12,
            top: 14,
            width: 80,
            height: 80,
            background: accent.grad,
            borderRadius: '50%',
            filter: 'blur(30px)',
            opacity: 0.35,
            pointerEvents: 'none',
            zIndex: 0,
          }}
        />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <IdentityOrb
            size={64}
            icon={accent.icon}
            gradient={accent.grad}
            pulse={
              phase === 'running' || phase === 'starting' || phase === 'installing'
            }
          />
        </div>

        <div
          style={{
            position: 'relative',
            zIndex: 1,
            flex: 1,
            minWidth: 200,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                fontWeight: 800,
                fontSize: 16,
                color: accent.color,
                letterSpacing: '-0.01em',
              }}
            >
              {accent.label}
            </span>
            {phase === 'running' && <SignalRing state="running" size={8} />}
          </div>
          <p
            style={{
              margin: 0,
              fontSize: 12,
              color: 'var(--text-3)',
              lineHeight: 1.5,
            }}
          >
            {isJobRunning
              ? t('preview.jobRunning', 'A job is running')
              : phase === 'running' && isReady
                ? t(
                    'preview.controlsReady',
                    '서버가 준비되었습니다. 아래에서 패키지를 열 수 있습니다.',
                  )
                : phase === 'starting' || phase === 'installing'
                  ? t(
                      'preview.controlsBooting',
                      '서버를 부팅하고 있습니다…',
                    )
                  : phase === 'error'
                    ? t(
                        'preview.controlsErrorHint',
                        '오류 메시지를 확인하고 다시 시작해 주세요.',
                      )
                    : t(
                        'preview.controlsIdleHint',
                        '시작 버튼으로 프리뷰 서버를 켭니다.',
                      )}
          </p>
        </div>

        {/* Actions */}
        <div
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
          }}
        >
          {!isRunning ? (
            <button
              type="button"
              onClick={onStart}
              disabled={isJobRunning || isPreviewLoading}
              title={startDisabledTitle}
              style={
                isJobRunning || isPreviewLoading
                  ? c3vBigBtn({
                      bg: 'var(--bg-surface-2)',
                      fg: 'var(--text-4)',
                      border: '1px solid var(--border-2)',
                      disabled: true,
                    })
                  : c3vBigBtn({
                      bg: 'linear-gradient(135deg, oklch(60% 0.16 155), oklch(58% 0.18 175))',
                      fg: 'white',
                      glow: '0 6px 18px -6px oklch(55% 0.18 165 / 0.55)',
                    })
              }
            >
              {isPreviewLoading ? (
                <Spinner size="sm" tone="inherit" />
              ) : (
                <span aria-hidden style={{ display: 'inline-flex' }}>
                  ▶
                </span>
              )}
              {t('preview.start', 'Start')}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onStop}
                style={c3vBigBtn({
                  bg: 'linear-gradient(135deg, oklch(60% 0.20 25), oklch(58% 0.22 15))',
                  fg: 'white',
                  glow: '0 6px 18px -6px oklch(55% 0.20 25 / 0.55)',
                })}
              >
                <span aria-hidden style={{ display: 'inline-flex' }}>
                  ■
                </span>
                {t('preview.stop', 'Stop')}
              </button>
              <button
                type="button"
                onClick={onRestart}
                style={c3vBigBtn({
                  bg: 'var(--bg-surface)',
                  fg: 'var(--text-2)',
                  border: '1px solid var(--border-2)',
                })}
              >
                {t('preview.restart', 'Restart')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Error banner */}
      {showStartupError && (
        <div
          style={{
            margin: '0 20px 16px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '10px 12px',
            background: 'var(--status-error-bg)',
            border: '1px solid oklch(82% 0.12 25)',
            borderRadius: 'var(--r-md)',
            color: 'var(--status-error-fg)',
          }}
        >
          <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          <p
            style={{
              margin: 0,
              flex: 1,
              minWidth: 0,
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {startupError}
          </p>
          <button
            type="button"
            onClick={() => onDismissError(`startup:${startupError}`)}
            title={t('preview.dismiss', 'Dismiss')}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--status-error-fg)',
              cursor: 'pointer',
              opacity: 0.7,
              padding: 2,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Single Open chip */}
      {showSingleOpen && (
        <div
          style={{
            borderTop: '1px solid var(--border-1)',
            padding: '12px 20px 14px',
          }}
        >
          <UrlChip
            label={t('preview.open', 'Open')}
            url={singleOpenUrl as string}
            onOpen={() => onOpenPreview(singleOpenUrl as string)}
            big
          />
        </div>
      )}

      {/* Multi-package chip grid */}
      {showMultiOpen && (
        <div
          style={{
            borderTop: '1px solid var(--border-1)',
            padding: '12px 20px 14px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 10,
          }}
        >
          {openableFrontends.map((pkg) => (
            <UrlChip
              key={pkg.slug || pkg.name}
              label={pkg.name}
              url={pkg.url as string}
              onOpen={() => onOpenPreview(pkg.url as string)}
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function UrlChip({
  label,
  url,
  onOpen,
  big = false,
}: {
  label: string;
  url: string;
  onOpen: () => void;
  big?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: big ? '12px 14px' : '10px 12px',
        background: 'var(--bg-surface)',
        border: '1.5px solid var(--violet-300)',
        borderRadius: 'var(--r-md)',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        boxShadow: '0 2px 6px -3px oklch(55% 0.18 290 / 0.18)',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 26,
          height: 26,
          borderRadius: 'var(--r-sm)',
          background: 'var(--gradient-aurora)',
          color: 'white',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Box size={12} strokeWidth={2.5} />
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--text-1)',
            letterSpacing: '-0.005em',
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10.5,
            color: 'var(--text-3)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={url}
        >
          {url}
        </span>
      </span>
      <ArrowRight size={14} strokeWidth={2} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
    </button>
  );
}
