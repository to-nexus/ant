
import { useState, type MouseEvent, type ReactNode } from 'react';
import { Settings, X } from 'lucide-react';

export type ProjectDotAccent = 'violet' | 'pink' | 'orange' | 'cool';

const DOT_COLOR: Record<ProjectDotAccent, string> = {
  violet: 'var(--violet-500)',
  pink: 'var(--pink-500)',
  orange: 'var(--orange-500)',
  cool: 'var(--teal-500)',
};

interface ProjectRowProps {
  name: string;
  isActive: boolean;
  /** PROJECT_DOTS accent (deterministic per-project — see ProjectSection). */
  accent: ProjectDotAccent;
  /** Disabled state (e.g. policy.canChangeProject === false). */
  disabled?: boolean;
  disabledReason?: string;
  /** Called when an inactive row is intentionally switched-to. */
  onSwitch: () => void;
  /** Active row: ✕ clears selection. */
  onClear?: () => void;
  /** Active row: settings button (project config). */
  onSettings?: () => void;
  /** Optional right-side adornment (e.g. small status text). */
  rightSlot?: ReactNode;
}

/**
 * Aurora project row.
 *
 * Behaviour:
 *  • Inactive row: hover OR keyboard-focus reveals a 「전환」 mini
 *    button on the right. Clicking either the body OR the mini button
 *    fires `onSwitch` — the row body click is the explicit switch
 *    intent (spec §5.4: switching cost must be acknowledged, so the
 *    transition is gated by an explicit affordance rather than implicit
 *    hover behaviour).
 *  • Active row: shows ✕ clear + ⚙ settings on the right; no 「전환」.
 *  • Project domain表示 is intentionally NOT rendered (spec §5.4).
 *
 * Visual: 4px accent dot (PROJECT_DOTS token), mono name, 28px height.
 */
export function ProjectRow({
  name,
  isActive,
  accent,
  disabled,
  disabledReason,
  onSwitch,
  onClear,
  onSettings,
  rightSlot,
}: ProjectRowProps) {
  const [hover, setHover] = useState(false);

  const handleBodyClick = (e: MouseEvent) => {
    if (disabled) return;
    if (isActive) return;
    // Explicit switch — surface the cost via the 「전환」 affordance,
    // but accept body clicks for fluency.
    e.stopPropagation();
    onSwitch();
  };

  const showSwitchHint = !isActive && (hover) && !disabled;

  return (
    <div
      role="listitem"
      aria-current={isActive ? 'true' : undefined}
      aria-disabled={disabled || undefined}
      title={disabled ? disabledReason : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      onClick={handleBodyClick}
      tabIndex={isActive || disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (disabled || isActive) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSwitch();
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 28,
        padding: '0 8px',
        borderRadius: 6,
        cursor: disabled ? 'not-allowed' : isActive ? 'default' : 'pointer',
        background: isActive
          ? 'color-mix(in srgb, var(--violet-500) 12%, transparent)'
          : hover
            ? 'var(--bg-hover)'
            : 'transparent',
        border: isActive
          ? '1px solid color-mix(in srgb, var(--violet-500) 35%, transparent)'
          : '1px solid transparent',
        opacity: disabled ? 0.5 : 1,
        transition: 'background 120ms ease, border-color 120ms ease',
      }}
    >
      {/* 4px accent dot */}
      <span
        aria-hidden
        style={{
          width: 4,
          height: 4,
          borderRadius: 999,
          background: DOT_COLOR[accent],
          flexShrink: 0,
          boxShadow: isActive
            ? `0 0 6px 1px color-mix(in srgb, ${DOT_COLOR[accent]} 60%, transparent)`
            : 'none',
        }}
      />

      {/* Project name (mono) */}
      <span
        className="font-mono truncate"
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 12,
          fontWeight: isActive ? 600 : 500,
          color: isActive ? 'var(--text-1)' : 'var(--text-2)',
        }}
      >
        {name}
      </span>

      {rightSlot}

      {/* Right adornments */}
      {!isActive && showSwitchHint && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSwitch();
          }}
          style={{
            height: 22,
            padding: '0 8px',
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 600,
            color: '#fff',
            background: 'var(--gradient-aurora)',
            boxShadow: 'var(--shadow-glow-aurora)',
            border: 'none',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          전환
        </button>
      )}

      {isActive && (
        <>
          {onSettings && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSettings();
              }}
              aria-label="Project settings"
              title="Project settings"
              style={{
                height: 22,
                width: 22,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 6,
                color: 'var(--text-2)',
                background: 'transparent',
                border: '1px solid var(--border-1)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <Settings size={12} />
            </button>
          )}
          {onClear && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              aria-label="Clear selection"
              title="Clear selection"
              style={{
                height: 22,
                width: 22,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 6,
                color: 'var(--text-3)',
                background: 'transparent',
                border: '1px solid var(--border-1)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <X size={12} />
            </button>
          )}
        </>
      )}
    </div>
  );
}
