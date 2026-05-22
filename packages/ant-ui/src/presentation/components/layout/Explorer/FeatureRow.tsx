
import { useState, type MouseEvent } from 'react';
import { GitBranch, Monitor, X } from 'lucide-react';

interface FeatureRowProps {
  name: string;
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
  branch,
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
        height: 28,
        padding: '0 8px',
        borderRadius: 6,
        cursor: disabled ? 'not-allowed' : isActive ? 'default' : 'pointer',
        background: isActive
          ? 'color-mix(in srgb, var(--pink-500) 12%, transparent)'
          : hover
            ? 'var(--bg-hover)'
            : 'transparent',
        border: isActive
          ? '1px solid color-mix(in srgb, var(--pink-500) 35%, transparent)'
          : '1px solid transparent',
        opacity: disabled ? 0.5 : 1,
        transition: 'background 120ms ease, border-color 120ms ease',
        minWidth: 0,
      }}
    >
      <GitBranch
        size={12}
        style={{
          color: isActive ? 'var(--pink-500)' : 'var(--text-3)',
          flexShrink: 0,
        }}
      />

      {/* Name + branch line — both truncate with ellipsis */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span
          className="font-mono"
          style={{
            fontSize: 12,
            fontWeight: isActive ? 600 : 500,
            color: isActive ? 'var(--text-1)' : 'var(--text-2)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
          }}
        >
          {name}
        </span>
        {branch && (
          <span
            className="font-mono"
            style={{
              fontSize: 10,
              color: 'var(--text-3)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
              lineHeight: 1.2,
            }}
          >
            {branch}
          </span>
        )}
      </div>

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
              border: '1px solid var(--border-1)',
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
              border: '1px solid var(--border-1)',
              cursor: 'pointer',
              flexShrink: 0,
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
              title="Preview editor"
              style={{
                height: 22,
                padding: '0 8px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--text-1)',
                background: 'var(--surface-1)',
                border: '1px solid var(--border-1)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <Monitor size={12} />
              에디터
            </button>
          )}
          {onClear && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              aria-label="Clear feature selection"
              title="Clear feature selection"
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
