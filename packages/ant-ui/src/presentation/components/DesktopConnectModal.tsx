
/**
 * DesktopConnectModal (Aurora)
 *
 * Composes the `useDesktopBridge` lifecycle (desktopStatus × launchPhase)
 * into a single unified surface. Renders a 72px gradient orb, a 4-step
 * connection ladder, and a help block when offline / failed. Ported from
 * visual/ui/handoff/project/d1-modals.jsx.
 *
 * Public surface preserved: `launchPhase` + `onRetry` + `onCancel`. The
 * `desktopStatus` prop is optional — when omitted the modal falls back to
 * store-derived bridge state so existing callers continue to work without
 * modification.
 */

import { useTranslation } from 'react-i18next';
import { Modal, type ModalAccent } from './common/Modal';
import { Icon } from './aurora/Icon';
import {
  type DesktopStatus,
  type LaunchPhase,
} from '@/application/hooks/ui/useDesktopBridge';
import { useStore } from '@/domain/store';
import { DESKTOP_DOWNLOAD_URL } from '@/presentation/constants/desktop';

interface DesktopConnectModalProps {
  launchPhase: LaunchPhase;
  onRetry: () => void;
  onCancel: () => void;
  /** Optional explicit status override (otherwise derived from store). */
  desktopStatus?: DesktopStatus;
}

/* -----------------------------------------------------------------------
 * Button helpers (mirror d1-modals.jsx btnAuroraStyle / btnGhostStyle)
 * --------------------------------------------------------------------- */

function ghostButtonStyle(): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 38,
    padding: '0 16px',
    background: 'oklch(from var(--bg-surface) l c h / 0.7)',
    color: 'var(--text-2)',
    border: '1px solid var(--border-2)',
    borderRadius: 12,
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: '-0.01em',
    fontFamily: 'inherit',
    cursor: 'pointer',
  };
}

function auroraButtonStyle(disabled = false): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 38,
    padding: '0 18px',
    background: 'var(--gradient-aurora)',
    backgroundSize: '200% 200%',
    color: 'var(--text-on-brand)',
    border: 'none',
    borderRadius: 12,
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: '-0.01em',
    fontFamily: 'inherit',
    boxShadow: 'var(--shadow-glow-aurora)',
    cursor: disabled ? 'wait' : 'pointer',
    opacity: disabled ? 0.65 : 1,
    animation: 'gradient-shift 5s ease-in-out infinite',
    transition: 'transform var(--dur-base) var(--ease-spring)',
  };
}

/* -----------------------------------------------------------------------
 * Unified phase derivation
 * --------------------------------------------------------------------- */

type Phase =
  | 'offline'
  | 'detected'
  | 'connecting'
  | 'success'
  | 'failed'
  | 'connected';

function derivePhase(
  launchPhase: LaunchPhase,
  desktopStatus: DesktopStatus,
): Phase {
  if (launchPhase === 'success') return 'success';
  if (launchPhase === 'failed') return 'failed';
  if (launchPhase === 'connecting') return 'connecting';
  return desktopStatus;
}

interface HeroSpec {
  title: string;
  sub: string;
  accent: ModalAccent;
  icon: string;
}

interface PillSpec {
  dot: string;
  fg: string;
  label: string;
  glow: boolean;
}

/* -----------------------------------------------------------------------
 * Step ladder
 * --------------------------------------------------------------------- */

type StepState = 'pending' | 'active' | 'done';

function stepStatesForPhase(phase: Phase): StepState[] {
  if (phase === 'success' || phase === 'connected')
    return ['done', 'done', 'done', 'done'];
  if (phase === 'connecting') return ['done', 'active', 'pending', 'pending'];
  if (phase === 'failed') return ['done', 'done', 'pending', 'pending'];
  return ['pending', 'pending', 'pending', 'pending'];
}

function PhaseStep({ label, state }: { label: string; state: StepState }) {
  const tones: Record<StepState, { bg: string; fg: string; dot: string }> = {
    pending: {
      bg: 'var(--bg-surface-2)',
      fg: 'var(--text-4)',
      dot: 'var(--text-4)',
    },
    active: {
      bg: 'oklch(from var(--violet-100) l c h / 0.6)',
      fg: 'var(--violet-700)',
      dot: 'var(--violet-500)',
    },
    done: {
      bg: 'oklch(from var(--status-done-bg) l c h / 0.6)',
      fg: 'var(--status-done-fg)',
      dot: 'var(--emerald-500)',
    },
  };
  const tone = tones[state];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        borderRadius: 10,
        background: tone.bg,
        transition: 'transform var(--dur-base) var(--ease-smooth), opacity var(--dur-base) var(--ease-smooth), box-shadow var(--dur-base) var(--ease-smooth)',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: 14,
          height: 14,
          flexShrink: 0,
        }}
      >
        {state === 'done' ? (
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: 'var(--emerald-500)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
            }}
          >
            <Icon name="check" size={9} stroke={3} />
          </div>
        ) : state === 'active' ? (
          <>
            <div
              aria-hidden
              style={{
                position: 'absolute',
                inset: -3,
                borderRadius: '50%',
                background: 'var(--violet-300)',
                opacity: 0.45,
                animation: 'pulse-soft 1.4s ease-in-out infinite',
              }}
            />
            <div
              style={{
                position: 'relative',
                width: 14,
                height: 14,
                borderRadius: '50%',
                background: 'var(--violet-500)',
              }}
            />
          </>
        ) : (
          <div
            style={{
              width: 8,
              height: 8,
              margin: 3,
              borderRadius: '50%',
              background: tone.dot,
            }}
          />
        )}
      </div>
      <span
        style={{
          fontSize: 12.5,
          color: tone.fg,
          fontWeight: state === 'active' ? 600 : 500,
        }}
      >
        {label}
      </span>
    </div>
  );
}

/* -----------------------------------------------------------------------
 * Desktop orb (72px gradient circle with phase-driven halo)
 * --------------------------------------------------------------------- */

function DesktopOrb({ phase, icon }: { phase: Phase; icon: string }) {
  const halo =
    phase === 'success' || phase === 'connected'
      ? 'linear-gradient(135deg, var(--emerald-500), var(--teal-500))'
      : phase === 'failed'
        ? 'linear-gradient(135deg, var(--red-500), var(--pink-500))'
        : phase === 'connecting'
          ? 'var(--gradient-aurora)'
          : 'var(--gradient-violet-pink)';

  const animateGlow = phase === 'connecting' || phase === 'success';

  return (
    <div
      style={{
        position: 'relative',
        flexShrink: 0,
        width: 72,
        height: 72,
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: -12,
          borderRadius: '50%',
          background: halo,
          opacity: 0.45,
          filter: 'blur(20px)',
          animation: animateGlow
            ? 'pulse-soft 2.4s ease-in-out infinite'
            : 'none',
        }}
      />
      {phase === 'connecting' && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: -4,
            borderRadius: '50%',
            background:
              'conic-gradient(from 0deg, transparent, oklch(64% 0.20 290 / 0.65), oklch(66% 0.22 350 / 0.65), oklch(72% 0.18 50 / 0.65), transparent)',
            animation: 'spin 1.6s linear infinite',
            mask: 'radial-gradient(circle, transparent 60%, black 64%)',
            WebkitMask:
              'radial-gradient(circle, transparent 60%, black 64%)',
          }}
        />
      )}
      <div
        style={{
          position: 'relative',
          width: 72,
          height: 72,
          borderRadius: '50%',
          background: halo,
          backgroundSize: '200% 200%',
          color: 'white',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow:
            '0 10px 28px oklch(50% 0.22 290 / 0.30), inset 0 1px 0 oklch(100% 0 0 / 0.4)',
        }}
      >
        <Icon name={icon} size={32} stroke={1.8} />
      </div>
    </div>
  );
}

/* -----------------------------------------------------------------------
 * Main component
 * --------------------------------------------------------------------- */

export function DesktopConnectModal({
  launchPhase,
  onRetry,
  onCancel,
  desktopStatus: desktopStatusProp,
}: DesktopConnectModalProps) {
  const { t } = useTranslation('nav');

  // Store-derived desktopStatus fallback for callers that don't pass the
  // prop. Mirrors the derivation in `useDesktopBridge` itself.
  const bridgeConnected = useStore((s) => s.bridgeConnected);
  const bridgeDetected = useStore((s) => s.bridgeDetected);
  const derivedStatus: DesktopStatus =
    bridgeConnected === true
      ? 'connected'
      : bridgeDetected
        ? 'detected'
        : 'offline';
  const desktopStatus = desktopStatusProp ?? derivedStatus;

  const phase = derivePhase(launchPhase, desktopStatus);
  const isOpen = launchPhase !== 'idle';

  // Hero copy by phase. Existing i18n keys are reused where available;
  // unknown keys fall back to a sensible literal (i18next returns the key
  // string for missing keys by default).
  const heroByPhase: Record<Phase, HeroSpec> = {
    offline: {
      title: t('desktop.offline'),
      sub: t('desktop.downloadDesc'),
      accent: 'violet',
      icon: 'monitor',
    },
    detected: {
      title: t('desktop.detected'),
      sub: t('desktop.connectingDesc'),
      accent: 'violet',
      icon: 'monitor',
    },
    connecting: {
      title: t('desktop.connecting'),
      sub: t('desktop.connectingDesc'),
      accent: 'aurora',
      icon: 'bolt',
    },
    success: {
      title: t('desktop.connected'),
      sub: t('desktop.connectingDesc'),
      accent: 'emerald',
      icon: 'check-circle',
    },
    failed: {
      title: t('desktop.downloadTitle'),
      sub: t('desktop.downloadDesc'),
      accent: 'red',
      icon: 'shield-alert',
    },
    connected: {
      title: t('desktop.connected'),
      sub: t('desktop.connectingDesc'),
      accent: 'emerald',
      icon: 'check-circle',
    },
  };
  const hero = heroByPhase[phase];

  // Status pill copy + colors
  const pillByPhase: Record<Phase, PillSpec> = {
    offline: {
      dot: 'var(--text-4)',
      fg: 'var(--text-3)',
      label: t('desktop.offline'),
      glow: false,
    },
    detected: {
      dot: 'var(--orange-500)',
      fg: 'var(--orange-600)',
      label: t('desktop.detected'),
      glow: true,
    },
    connecting: {
      dot: 'var(--violet-500)',
      fg: 'var(--violet-600)',
      label: t('desktop.connecting'),
      glow: true,
    },
    failed: {
      dot: 'var(--red-500)',
      fg: 'var(--red-500)',
      label: t('desktop.downloadTitle'),
      glow: false,
    },
    success: {
      dot: 'var(--emerald-500)',
      fg: 'oklch(45% 0.14 155)',
      label: t('desktop.connected'),
      glow: true,
    },
    connected: {
      dot: 'var(--emerald-500)',
      fg: 'oklch(45% 0.14 155)',
      label: t('desktop.connected'),
      glow: true,
    },
  };
  const pill = pillByPhase[phase];

  // 4-step ladder labels — reuse existing key when possible, fallback to
  // verbatim handoff Korean copy.
  const stepLabels: [string, string, string, string] = [
    'Desktop 앱 실행 요청',
    'Bridge 핸드셰이크',
    '인증 토큰 교환',
    '준비 완료',
  ];
  const states = stepStatesForPhase(phase);

  // Footer per phase
  const isTerminal = phase === 'success' || phase === 'connected';
  const footer = isTerminal ? (
    <button onClick={onCancel} style={auroraButtonStyle()}>
      {t('desktop.connected')}
    </button>
  ) : phase === 'connecting' ? (
    <>
      <button onClick={onCancel} style={ghostButtonStyle()}>
        {t('desktop.cancel')}
      </button>
      <button disabled style={auroraButtonStyle(true)}>
        <Icon name="bolt" size={14} />
        {t('desktop.connecting')}
      </button>
    </>
  ) : phase === 'failed' ? (
    <>
      <button onClick={onCancel} style={ghostButtonStyle()}>
        {t('desktop.cancel')}
      </button>
      <button onClick={onRetry} style={auroraButtonStyle()}>
        <Icon name="redo" size={14} />
        {t('desktop.retry')}
      </button>
    </>
  ) : (
    /* offline / detected */
    <>
      <button onClick={onCancel} style={ghostButtonStyle()}>
        {t('desktop.cancel')}
      </button>
      <button onClick={onRetry} style={auroraButtonStyle()}>
        <Icon name="bolt" size={14} />
        {t('desktop.downloadButton')}
      </button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title="Ant Desktop"
      size="md"
      accent={hero.accent}
      eyebrow="ANT DESKTOP"
      onBackdropClick={isTerminal ? onCancel : () => {}}
      footer={footer}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* Hero */}
        <div
          style={{
            display: 'flex',
            gap: 18,
            alignItems: 'flex-start',
          }}
        >
          <DesktopOrb phase={phase} icon={hero.icon} />
          <div style={{ flex: 1, paddingTop: 6, minWidth: 0 }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '4px 10px',
                borderRadius: 999,
                background: 'oklch(from var(--bg-surface-2) l c h / 0.8)',
                border: '1px solid var(--border-1)',
                marginBottom: 10,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: pill.dot,
                  boxShadow: pill.glow ? `0 0 8px ${pill.dot}` : 'none',
                  animation: pill.glow
                    ? 'pulse-soft 1.6s ease-in-out infinite'
                    : 'none',
                }}
              />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: pill.fg,
                  letterSpacing: 0.2,
                }}
              >
                {pill.label}
              </span>
            </div>
            <h3
              className="text-display"
              style={{
                margin: '0 0 6px',
                fontSize: 18,
                fontWeight: 700,
                color: 'var(--text-1)',
                lineHeight: 1.25,
              }}
            >
              {hero.title}
            </h3>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: 'var(--text-3)',
                lineHeight: 1.55,
              }}
            >
              {hero.sub}
            </p>
          </div>
        </div>

        {/* 4-step ladder */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 6,
          }}
        >
          {stepLabels.map((label, i) => (
            <PhaseStep key={label} label={label} state={states[i]} />
          ))}
        </div>

        {/* Help block (offline / failed) */}
        {(phase === 'offline' || phase === 'failed') && (
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 12,
              background: 'oklch(from var(--bg-surface-2) l c h / 0.6)',
              border: '1px dashed var(--border-2)',
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start',
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background:
                  phase === 'failed'
                    ? 'oklch(94% 0.04 25)'
                    : 'oklch(94% 0.04 290)',
                color:
                  phase === 'failed'
                    ? 'var(--red-500)'
                    : 'var(--violet-600)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Icon
                name={phase === 'failed' ? 'alert' : 'download'}
                size={14}
              />
            </div>
            <div
              style={{
                flex: 1,
                fontSize: 12,
                color: 'var(--text-2)',
                lineHeight: 1.55,
              }}
            >
              {phase === 'failed' ? (
                <>
                  <strong style={{ color: 'var(--text-1)' }}>해결 방법:</strong>{' '}
                  Desktop이 시스템 트레이에 떠 있는지 확인하고, 방화벽이{' '}
                  <code
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      padding: '1px 6px',
                      borderRadius: 5,
                      background: 'oklch(from var(--bg-surface) l c h / 0.8)',
                      border: '1px solid var(--border-1)',
                    }}
                  >
                    127.0.0.1:54321
                  </code>{' '}
                  포트를 차단하지 않는지 확인하세요.
                </>
              ) : (
                <>
                  <strong style={{ color: 'var(--text-1)' }}>
                    아직 설치 안 하셨나요?
                  </strong>{' '}
                  <a
                    href={DESKTOP_DOWNLOAD_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: 'var(--violet-600)',
                      textDecoration: 'underline',
                      textUnderlineOffset: 2,
                      fontWeight: 600,
                    }}
                  >
                    {t('desktop.downloadButton')} ↗
                  </a>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
