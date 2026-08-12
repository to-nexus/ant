/**
 * Tool chip — ONE surface for a tool's two orthogonal properties: whether the
 * job allows it (`tools.builtin`) and what approval it needs
 * (`tools.approval`). They share an identifier space, so splitting them into
 * two lists forced the reader to cross-reference; the chip is a single row of
 * that join.
 *
 * Left hit area toggles the allowlist. Right hit area opens the approval menu.
 * Policy is encoded by BOTH colour and glyph silhouette so it survives
 * greyscale, and inherited-vs-declared by emphasis (tint + ring = declared).
 */

import { useLayoutEffect, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, CirclePause, UserRoundCheck, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** yaml-writable policies; `undefined` on a chip means "inherited". */
export type ApprovalPolicy = 'always' | 'never';
/** Menu value space — `default` deletes the key, `ask` is not implemented yet. */
type MenuValue = ApprovalPolicy | 'default' | 'ask';

const POLICY_ACCENT: Record<ApprovalPolicy | 'ask', string> = {
  never: 'var(--emerald-500)',
  always: 'var(--amber-500)',
  ask: 'var(--violet-500)',
};

const POLICY_ICON = {
  never: Zap,
  always: CirclePause,
  ask: UserRoundCheck,
} as const;

const MENU_WIDTH = 268;

export function ToolChip({
  tool,
  selected,
  policy,
  inheritedPolicy,
  disabled,
  onToggle,
  onPolicyChange,
}: {
  tool: string;
  /** In the builtin allowlist. */
  selected: boolean;
  /** Declared override; `undefined` = inherits. */
  policy: ApprovalPolicy | undefined;
  /** What the runtime resolves to with no override (mutating ⇒ always). */
  inheritedPolicy: ApprovalPolicy;
  disabled: boolean;
  onToggle: () => void;
  onPolicyChange: (value: 'default' | ApprovalPolicy) => void;
}) {
  const { t } = useTranslation('agents');
  // The anchor element itself is the open flag — the menu positions off it, so
  // a separate boolean would just be a second source of truth that can skew.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const effective = policy ?? inheritedPolicy;
  const declared = policy !== undefined;
  const accent = POLICY_ACCENT[effective];
  const PolicyIcon = POLICY_ICON[effective];

  return (
    <>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'stretch',
          borderRadius: 'var(--r-pill)',
          border: `1px solid ${selected ? 'var(--violet-300)' : 'var(--border-2)'}`,
          background: selected ? 'var(--select-fill-violet)' : 'var(--bg-surface)',
          overflow: 'hidden',
          opacity: disabled && !selected ? 0.55 : 1,
          transition: 'background 120ms ease, border-color 120ms ease',
        }}
      >
        <button
          type="button"
          disabled={disabled}
          onClick={onToggle}
          title={selected ? t('overview.toolIncluded') : t('overview.toolExcluded')}
          style={{
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            padding: '3px 8px 3px 10px',
            border: 'none',
            background: 'transparent',
            color: selected ? 'var(--select-fg)' : 'var(--text-3)',
            fontWeight: selected ? 700 : 500,
            cursor: disabled ? 'default' : 'pointer',
            transition: 'color 120ms ease',
          }}
        >
          {tool}
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={(e: ReactMouseEvent<HTMLButtonElement>) =>
            setAnchor((prev) => (prev ? null : e.currentTarget))
          }
          aria-label={t('overview.approvalMenuAria', { tool })}
          title={t('overview.approvalMenuAria', { tool })}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 2,
            padding: '0 6px',
            border: 'none',
            borderLeft: `1px solid ${selected ? 'var(--violet-300)' : 'var(--border-2)'}`,
            background: declared ? `oklch(from ${accent} l c h / 0.2)` : 'transparent',
            boxShadow: declared ? `inset 0 0 0 1px oklch(from ${accent} l c h / 0.55)` : 'none',
            color: accent,
            opacity: declared ? 1 : 0.5,
            cursor: disabled ? 'default' : 'pointer',
            transition: 'background 120ms ease, opacity 120ms ease',
          }}
        >
          <PolicyIcon size={11} strokeWidth={2.4} />
          <ChevronDown size={9} strokeWidth={2.4} style={{ color: 'var(--text-4)' }} />
        </button>
      </span>

      {anchor && (
        <ApprovalMenu
          anchor={anchor}
          current={policy ?? 'default'}
          inheritedPolicy={inheritedPolicy}
          onSelect={(v) => {
            setAnchor(null);
            onPolicyChange(v);
          }}
          onClose={() => setAnchor(null)}
        />
      )}
    </>
  );
}

/**
 * Approval picker. Same portal/flip/dismiss core as BindingPopover, minus the
 * enter animation — this reads as a tooltip on a badge, so it must appear at
 * once. Position is measured before paint so it never flashes at 0,0.
 */
function ApprovalMenu({
  anchor,
  current,
  inheritedPolicy,
  onSelect,
  onClose,
}: {
  anchor: HTMLElement;
  current: MenuValue;
  inheritedPolicy: ApprovalPolicy;
  onSelect: (value: 'default' | ApprovalPolicy) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('agents');
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect();
    const GAP = 5;
    const ESTIMATED_HEIGHT = 190;
    let left = rect.right - MENU_WIDTH;
    if (left + MENU_WIDTH > window.innerWidth - 8) left = window.innerWidth - MENU_WIDTH - 8;
    if (left < 8) left = 8;
    let top = rect.bottom + GAP;
    if (top + ESTIMATED_HEIGHT > window.innerHeight - 8) {
      top = Math.max(8, rect.top - ESTIMATED_HEIGHT - GAP);
    }
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        !anchor.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const handleScroll = (e: Event) => {
      if (e.target instanceof Node && (e.target as Node).contains(anchor)) onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('resize', onClose);
    const rafId = requestAnimationFrame(() => document.addEventListener('scroll', handleScroll, true));
    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);

  if (!pos) return null;

  const items: {
    value: MenuValue;
    icon: typeof Zap | null;
    accent: string | null;
    label: string;
    desc: string;
    comingSoon?: boolean;
  }[] = [
    {
      value: 'default',
      icon: null,
      accent: null,
      label: `${t('overview.approvalDefault')} (${inheritedPolicy})`,
      desc: t('overview.approvalDefaultDesc'),
    },
    {
      value: 'never',
      icon: Zap,
      accent: POLICY_ACCENT.never,
      label: 'never',
      desc: t('overview.approvalNeverDesc'),
    },
    {
      value: 'always',
      icon: CirclePause,
      accent: POLICY_ACCENT.always,
      label: 'always',
      desc: t('overview.approvalAlwaysDesc'),
    },
    {
      value: 'ask',
      icon: UserRoundCheck,
      accent: POLICY_ACCENT.ask,
      label: t('overview.approvalAskLabel'),
      desc: t('overview.approvalAskDesc'),
      comingSoon: true,
    },
  ];

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] rounded-md border border-[color:var(--border-1)] bg-[color:var(--bg-surface)] shadow-lg py-1"
      style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
    >
      {items.map(({ value, icon: Icon, accent, label, desc, comingSoon }) => {
        const isCurrent = value === current;
        return (
          <button
            key={value}
            type="button"
            disabled={comingSoon}
            onClick={() => !comingSoon && onSelect(value as 'default' | ApprovalPolicy)}
            className={
              comingSoon
                ? 'flex items-start gap-2 w-full px-2.5 py-1.5 text-left'
                : 'flex items-start gap-2 w-full px-2.5 py-1.5 text-left hover:bg-[color:var(--bg-hover)]'
            }
            style={{ opacity: comingSoon ? 0.5 : 1, cursor: comingSoon ? 'default' : 'pointer' }}
          >
            <span
              style={{
                width: 13,
                display: 'inline-flex',
                justifyContent: 'center',
                marginTop: 2,
                color: accent ?? 'var(--text-4)',
                flexShrink: 0,
              }}
            >
              {Icon ? <Icon size={12} strokeWidth={2.4} /> : null}
            </span>
            <span style={{ flex: 1, minWidth: 0, lineHeight: 1.35 }}>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: 'var(--text-1)',
                }}
              >
                {label}
                {comingSoon && (
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      padding: '0 4px',
                      borderRadius: 'var(--r-pill)',
                      border: '1px solid var(--border-2)',
                      color: 'var(--text-4)',
                    }}
                  >
                    {t('overview.approvalComingSoon')}
                  </span>
                )}
              </span>
              <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-3)' }}>{desc}</span>
            </span>
            {isCurrent && (
              <Check size={12} strokeWidth={2.6} style={{ marginTop: 2, color: 'var(--violet-500)', flexShrink: 0 }} />
            )}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
