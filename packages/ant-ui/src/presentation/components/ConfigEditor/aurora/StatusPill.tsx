
import type { ReactNode } from 'react';

export type StatusPillState =
  | 'configured'
  | 'not-configured'
  | 'connected'
  | 'not-connected'
  | 'detected'
  | 'error'
  | 'warning'
  | 'info'
  | 'aurora'
  | 'checking';

export interface StatusPillProps {
  state: StatusPillState;
  label?: string;
  icon?: ReactNode;
}

interface PillCfg {
  bg: string;
  fg: string;
  border: string;
  dot: string;
  defaultLabel: string;
}

const PILL_MAP: Record<Exclude<StatusPillState, 'checking'>, PillCfg> = {
  configured: {
    bg: 'oklch(94% 0.06 155 / 0.5)',
    fg: 'oklch(40% 0.14 155)',
    border: 'oklch(82% 0.10 155)',
    dot: 'oklch(60% 0.18 155)',
    defaultLabel: '설정됨',
  },
  'not-configured': {
    bg: 'var(--bg-surface-2)',
    fg: 'var(--text-3)',
    border: 'var(--border-2)',
    dot: 'var(--text-4)',
    defaultLabel: '미설정',
  },
  connected: {
    bg: 'oklch(94% 0.06 155 / 0.5)',
    fg: 'oklch(40% 0.14 155)',
    border: 'oklch(82% 0.10 155)',
    dot: 'oklch(60% 0.18 155)',
    defaultLabel: '연결됨',
  },
  'not-connected': {
    bg: 'var(--bg-surface-2)',
    fg: 'var(--text-3)',
    border: 'var(--border-2)',
    dot: 'var(--text-4)',
    defaultLabel: '연결 안 됨',
  },
  detected: {
    bg: 'oklch(96% 0.06 60 / 0.55)',
    fg: 'oklch(45% 0.16 50)',
    border: 'oklch(85% 0.12 60)',
    dot: 'oklch(68% 0.18 55)',
    defaultLabel: '감지됨',
  },
  error: {
    bg: 'var(--status-error-bg)',
    fg: 'var(--status-error-fg)',
    border: 'oklch(85% 0.10 25)',
    dot: 'var(--status-error-fg)',
    defaultLabel: '오류',
  },
  warning: {
    bg: 'oklch(96% 0.06 80 / 0.55)',
    fg: 'oklch(48% 0.14 75)',
    border: 'oklch(85% 0.10 80)',
    dot: 'oklch(70% 0.16 75)',
    defaultLabel: '경고',
  },
  info: {
    bg: 'oklch(94% 0.04 240 / 0.55)',
    fg: 'oklch(42% 0.14 250)',
    border: 'oklch(84% 0.08 240)',
    dot: 'oklch(60% 0.16 250)',
    defaultLabel: '정보',
  },
  aurora: {
    bg: 'oklch(94% 0.06 290 / 0.55)',
    fg: 'var(--violet-700)',
    border: 'var(--violet-300)',
    dot: 'oklch(64% 0.20 290)',
    defaultLabel: 'Aurora',
  },
};

export function StatusPill({ state, label, icon }: StatusPillProps) {
  if (state === 'checking') {
    return (
      <span
        style={{
          fontSize: 10,
          fontStyle: 'italic',
          color: 'var(--text-3)',
          letterSpacing: '0.02em',
        }}
      >
        {label ?? '확인 중…'}
      </span>
    );
  }

  const cfg = PILL_MAP[state];

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 10,
        fontWeight: 700,
        padding: '3px 8px',
        background: cfg.bg,
        color: cfg.fg,
        border: `1px solid ${cfg.border}`,
        borderRadius: 'var(--r-pill)',
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
      }}
    >
      {icon}
      <span
        aria-hidden
        style={{
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: cfg.dot,
          flexShrink: 0,
        }}
      />
      {label ?? cfg.defaultLabel}
    </span>
  );
}
