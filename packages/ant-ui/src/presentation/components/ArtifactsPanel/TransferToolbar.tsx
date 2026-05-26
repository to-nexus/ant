
import { useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';

/**
 * TransferTinyButton — chrome-less header action button mirroring the
 * handoff TinyButton pattern (b3-explorer.jsx L78–L103). Hovers reveal
 * an orange-600 foreground over `var(--bg-hover)`; rest state is fully
 * transparent so the panel header chrome stays quiet.
 */
function TransferTinyButton({
  isNarrow,
  title,
  label,
  onClick,
}: {
  isNarrow: boolean;
  title: string;
  label: string;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={title}
      style={{
        height: 22,
        padding: isNarrow ? 0 : '0 8px',
        width: isNarrow ? 22 : 'auto',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        background: hover ? 'var(--bg-hover)' : 'transparent',
        color: hover ? 'var(--orange-600)' : 'var(--text-3)',
        border: 'none',
        borderRadius: 6,
        fontSize: 10,
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: 'inherit',
        flexShrink: 0,
        transition: 'all var(--dur-fast)',
      }}
    >
      <ArrowLeftRight size={12} />
      {!isNarrow && <span>{label}</span>}
    </button>
  );
}

interface TransferToolbarProps {
  isNarrow: boolean;
  onOpenTransfer: (subTab: 'send' | 'receive') => void;
  pendingTransferCount: number;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

/**
 * Panel-level transfer toolbar — replaces the SectionShell header action
 * slot that previously hosted the transfer button. Sits as a sibling to
 * the artifact sections (mirrors the `<GitToolbar />` pattern under
 * ProjectSection), right-aligned so it lives quietly above the section
 * stack without claiming its own SectionShell chrome.
 */
export function TransferToolbar({
  isNarrow,
  onOpenTransfer,
  pendingTransferCount,
  t,
}: TransferToolbarProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        justifyContent: 'flex-end',
        padding: 0,
      }}
    >
      <TransferTinyButton
        isNarrow={isNarrow}
        title={t('panel.transfer')}
        label={t('panel.transfer')}
        onClick={() => onOpenTransfer(pendingTransferCount > 0 ? 'receive' : 'send')}
      />
      {pendingTransferCount > 0 && (
        <span
          onClick={(e) => {
            e.stopPropagation();
            onOpenTransfer('receive');
          }}
          title={t('panel.transferPending', {
            count: pendingTransferCount,
            defaultValue: `${pendingTransferCount} pending`,
          })}
          aria-label={`${pendingTransferCount} pending`}
          style={{
            minWidth: 16,
            height: 16,
            padding: '0 5px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--red-500)',
            color: 'var(--text-on-brand)',
            fontSize: 10,
            fontWeight: 800,
            borderRadius: 999,
            cursor: 'pointer',
            boxShadow: '0 0 10px color-mix(in srgb, var(--red-500) 45%, transparent)',
          }}
        >
          {pendingTransferCount > 99 ? '99+' : pendingTransferCount}
        </span>
      )}
    </div>
  );
}
