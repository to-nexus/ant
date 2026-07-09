
import { useState, type MouseEvent, type ReactNode } from 'react';
import { ChevronRight, X, Layers, Gamepad2 } from 'lucide-react';
import { selectedRowStyle, selectedRowLabel } from '../../aurora/selection';
import type { Domain } from '@ant/shared';

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
  /** Project domain (service or game) — displays as icon */
  domain?: Domain;
  /** Disabled state (e.g. policy.canChangeProject === false). */
  disabled?: boolean;
  disabledReason?: string;
  /** Called when an inactive row is intentionally switched-to. */
  onSwitch: () => void;
  /** Active row: ✕ clears selection. */
  onClear?: () => void;
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
 *
 * Visual: domain icon (Layers=service / Gamepad2=game) tinted with the
 * per-project accent color, mono name, 28px height. Domain is a single
 * project-level value (WorkspaceConfig.domain) — the caller resolves it.
 */
export function ProjectRow({
  name,
  isActive,
  accent,
  domain,
  disabled,
  disabledReason,
  onSwitch,
  onClear,
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
        padding: '6px 10px',
        borderRadius: 6,
        cursor: disabled ? 'not-allowed' : isActive ? 'default' : 'pointer',
        ...selectedRowStyle('violet', isActive),
        background: isActive
          ? 'var(--select-fill-violet)'
          : hover
            ? 'var(--bg-hover)'
            : 'transparent',
        opacity: disabled ? 0.5 : 1,
        transition: 'background var(--dur-fast), border-color var(--dur-fast)',
      }}
    >
      {/* Domain icon — service (Layers) or game (Gamepad2) */}
      <span
        aria-hidden
        style={{
          width: 12,
          height: 12,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          color: DOT_COLOR[accent],
        }}
      >
        {domain === 'game' ? (
          <Gamepad2 size={12} strokeWidth={2} />
        ) : (
          <Layers size={12} strokeWidth={2} />
        )}
      </span>

      {/* Project name (mono) */}
      <span
        className="font-mono truncate"
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 12,
          ...selectedRowLabel(isActive, 'var(--text-1)'),
        }}
      >
        {name}
      </span>

      {rightSlot}

      {/* Right adornments — TinyButton chrome-less style (handoff) */}
      {!isActive && showSwitchHint && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSwitch();
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)';
            e.currentTarget.style.color = 'var(--violet-600)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--text-3)';
          }}
          title={`${name}으로 전환`}
          style={{
            height: 22,
            padding: '0 8px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            borderRadius: 6,
            fontSize: 10,
            fontWeight: 700,
            color: 'var(--text-3)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'all var(--dur-fast)',
          }}
        >
          <ChevronRight size={12} />
          전환
        </button>
      )}

      {isActive && (
        <>
          {onClear && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hover)';
                e.currentTarget.style.color = 'var(--violet-600)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--text-3)';
              }}
              aria-label="Clear selection"
              title="선택 해제"
              style={{
                height: 22,
                width: 22,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 6,
                color: 'var(--text-3)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                flexShrink: 0,
                transition: 'all var(--dur-fast)',
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
