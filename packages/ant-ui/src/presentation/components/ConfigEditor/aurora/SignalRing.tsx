
import { useEffect } from 'react';

export type SignalRingState =
  | 'running'
  | 'starting'
  | 'error'
  | 'warning'
  | 'idle'
  | 'hibernated';

export interface SignalRingProps {
  state: SignalRingState;
  size?: number;
  label?: string;
}

interface StateCfg {
  color: string;
  pulse: boolean;
}

const STATE_MAP: Record<SignalRingState, StateCfg> = {
  running: { color: 'oklch(60% 0.18 155)', pulse: true },
  starting: { color: 'oklch(64% 0.20 290)', pulse: true },
  error: { color: 'var(--status-error-fg)', pulse: false },
  warning: { color: 'oklch(70% 0.18 50)', pulse: false },
  idle: { color: 'var(--text-4)', pulse: false },
  hibernated: { color: 'var(--text-3)', pulse: false },
};

const STYLE_ELEMENT_ID = 'aurora-signal-pulse-css';
const PULSE_KEYFRAMES = `
@keyframes signal-pulse {
  0%   { box-shadow: 0 0 0 0   currentColor; opacity: 1; }
  70%  { box-shadow: 0 0 0 8px transparent;  opacity: 0.6; }
  100% { box-shadow: 0 0 0 0   transparent;  opacity: 1; }
}
`;

function ensureKeyframes() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = PULSE_KEYFRAMES;
  document.head.appendChild(style);
}

export function SignalRing({ state, size = 14, label }: SignalRingProps) {
  const cfg = STATE_MAP[state];

  useEffect(() => {
    if (cfg.pulse) ensureKeyframes();
  }, [cfg.pulse]);

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <span
        aria-hidden
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: cfg.color,
          color: cfg.color,
          animation: cfg.pulse
            ? 'signal-pulse 1.6s ease-out infinite'
            : 'none',
          flexShrink: 0,
        }}
      />
      {label && (
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: cfg.color,
            letterSpacing: '-0.005em',
          }}
        >
          {label}
        </span>
      )}
    </span>
  );
}
