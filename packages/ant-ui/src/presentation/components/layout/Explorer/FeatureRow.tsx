
import { useState, type MouseEvent } from 'react';
import { ChevronRight, GitBranch, Monitor, X } from 'lucide-react';

interface FeatureRowProps {
  name: string;
  /**
   * Deprecated — branch line is now surfaced by `<GitToolbar />` under the
   * active project row (see ProjectSection). FeatureRow renders a single
   * mono name line per the B3 handoff. Prop is kept for backwards-compat
   * but is intentionally ignored.
   */
  branch?: string | null;
  isActive: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onSwitch: () => void;
  /** Active row: clear selection (return to base branch / no feature). */
  onClear?: () => void;
  /** Active row: enter Preview Editor (monitor icon + 「에디터」 label). */
  onOpenPreviewEditor?: () => void;
  /** Inactive row: delete the feature. Surfaces on hover/focus. */
  onDelete?: () => void;
  /** When set, the delete affordance is rendered disabled with this tooltip. */
  deleteBlockedReason?: string;
}

/**
 * Aurora feature row.
 *
 * Spec contract (§5.4 / §6.2 T8):
 *  • Inactive row: 「전환」 mini button is the only switch affordance
 *    visible on hover/focus. Clicking the body also fires onSwitch.
 *  • Active row: right side shows ONLY [📺 에디터] + [✕]. No 「열기」/
 *    「fix」/「installing」/「starting」/「running」/「error」 button is
 *    ever rendered here.
 *  • No Preview server status panel JSX.
 *  • No JOB-progress chip.
 *  • No domain hint chip.
 *  • git-branch icon + mono name + branch line are ellipsis-truncated
 *    (`min-width: 0` + `overflow: hidden` + `text-overflow: ellipsis`
 *    + `white-space: nowrap`).
 */
export function FeatureRow({
  name,
  // branch intentionally ignored — surfaced via <GitToolbar /> instead.
  isActive,
  disabled,
  disabledReason,
  onSwitch,
  onClear,
  onOpenPreviewEditor,
  onDelete,
  deleteBlockedReason,
}: FeatureRowProps) {
  const [hover, setHover] = useState(false);

  const handleBodyClick = (e: MouseEvent) => {
    if (disabled || isActive) return;
    e.stopPropagation();
    onSwitch();
  };

  const showSwitchHint = !isActive && hover && !disabled;

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
        background: isActive
          ? 'color-mix(in srgb, var(--pink-300) 18%, transparent)'
          : hover
            ? 'var(--bg-hover)'
            : 'transparent',
        border: isActive
          ? '1px solid color-mix(in srgb, var(--pink-500) 35%, transparent)'
          : '1px solid transparent',
        opacity: disabled ? 0.5 : 1,
        minWidth: 0,
        transition: 'background var(--dur-fast)',
      }}
    >
      <GitBranch
        size={12}
        style={{
          color: isActive ? 'var(--pink-600)' : 'var(--text-3)',
          flexShrink: 0,
        }}
      />

      {/* Feature name — single mono line (handoff B3 spec) */}
      <span
        className="font-mono"
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 12,
          fontWeight: isActive ? 600 : 500,
          color: isActive ? 'var(--pink-700)' : 'var(--text-2)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </span>

      {!isActive && showSwitchHint && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSwitch();
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)';
            e.currentTarget.style.color = 'var(--pink-600)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--text-3)';
          }}
          title={`${name}으로 전환 (worktree 변경)`}
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

      {!isActive && onDelete && showSwitchHint && (
        deleteBlockedReason ? (
          <span
            aria-label="Delete feature (blocked)"
            title={deleteBlockedReason}
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
              cursor: 'not-allowed',
              opacity: 0.5,
              flexShrink: 0,
            }}
          >
            <X size={12} />
          </span>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)';
              e.currentTarget.style.color = 'var(--pink-600)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--text-3)';
            }}
            aria-label="Delete feature"
            title="Delete feature"
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
        )
      )}

      {isActive && (
        <>
          {onOpenPreviewEditor && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenPreviewEditor();
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hover)';
                e.currentTarget.style.color = 'var(--pink-600)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--text-3)';
              }}
              title="Preview Editor 열기"
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
              <Monitor size={12} />
              Preview
            </button>
          )}
          {onClear && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hover)';
                e.currentTarget.style.color = 'var(--pink-600)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--text-3)';
              }}
              aria-label="Clear feature selection"
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
