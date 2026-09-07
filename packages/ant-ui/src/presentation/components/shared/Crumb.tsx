import type { ElementType } from 'react';

/** One breadcrumb segment — a button when it is an ancestor with a target. */
export function Crumb({
  icon: Icon,
  label,
  current,
  mono,
  onClick,
}: {
  icon: ElementType;
  label: string;
  current: boolean;
  mono?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <span
      className="inline-flex items-center gap-1.5"
      style={{
        fontSize: 13,
        fontFamily: mono ? 'var(--font-mono)' : undefined,
        fontWeight: current ? 600 : 400,
        color: current ? 'var(--text-1)' : 'var(--text-2)',
      }}
    >
      <Icon size={14} style={{ color: current ? 'var(--text-2)' : 'var(--text-3)' }} />
      {label}
    </span>
  );
  if (current || !onClick) return content;
  return (
    <button type="button" onClick={onClick} className="hover:underline underline-offset-2">
      {content}
    </button>
  );
}

export const CRUMB_SEPARATOR = <span style={{ color: 'var(--text-4)', fontSize: 13 }}>›</span>;
