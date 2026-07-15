import { useState, type CSSProperties } from 'react';
import { Layers, Gamepad2 } from 'lucide-react';
import type { Domain } from '@ant/shared';

export interface DomainOptionLabel {
  title: string;
  desc?: string;
}

export type DomainSelectLabels = Record<Domain, DomainOptionLabel>;

interface DomainSelectProps {
  value: Domain;
  onChange: (next: Domain) => void;
  labels: DomainSelectLabels;
  disabled?: boolean;
  className?: string;
}

const DOMAINS: readonly Domain[] = ['service', 'game'];
const ICONS: Record<Domain, typeof Layers> = { service: Layers, game: Gamepad2 };

/**
 * Form-bound service/game domain selector — the single control shared by the
 * project-creation wizard and the project-settings ConfigEditor. Domain is a
 * project-level property (persisted in `config.json`); there is no mid-flow
 * switcher, so this is a controlled input that writes to whatever form state
 * its consumer owns. Labels are passed in so the component stays i18n-neutral.
 */
export function DomainSelect({ value, onChange, labels, disabled, className }: DomainSelectProps) {
  return (
    <div role="radiogroup" className={`grid grid-cols-2 gap-3 ${className ?? ''}`}>
      {DOMAINS.map((d) => (
        <DomainCard
          key={d}
          domain={d}
          selected={value === d}
          disabled={disabled}
          label={labels[d]}
          onSelect={() => onChange(d)}
        />
      ))}
    </div>
  );
}

function DomainCard({
  domain, selected, disabled, label, onSelect,
}: {
  domain: Domain;
  selected: boolean;
  disabled?: boolean;
  label: DomainOptionLabel;
  onSelect: () => void;
}) {
  const [hover, setHover] = useState(false);
  const Icon = ICONS[domain];

  const style: CSSProperties = selected
    ? {
        background: 'var(--gradient-violet-pink)',
        backgroundSize: '180% 180%',
        border: '1.5px solid transparent',
        color: 'white',
        boxShadow: 'var(--shadow-glow-aurora)',
      }
    : {
        background: 'var(--bg-surface)',
        border: hover && !disabled ? '1.5px solid var(--border-3)' : '1.5px solid var(--border-1)',
        color: 'var(--text-1)',
      };

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={() => { if (!disabled) onSelect(); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="relative flex items-center gap-3 p-3 text-left transition-all overflow-hidden"
      style={{
        borderRadius: 'var(--r-xl, 14px)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        ...style,
      }}
    >
      <div
        className="flex items-center justify-center shrink-0"
        style={{
          width: 34,
          height: 34,
          borderRadius: 'var(--r-lg, 10px)',
          background: selected ? 'oklch(100% 0 0 / 0.22)' : 'var(--bg-surface-2)',
          color: selected ? 'white' : 'var(--text-3)',
        }}
      >
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <div
          className="text-sm font-semibold"
          style={{ color: selected ? 'white' : 'var(--text-1)' }}
        >
          {label.title}
        </div>
        {label.desc && (
          <div
            className="text-[11px] leading-snug"
            style={{ color: selected ? 'oklch(100% 0 0 / 0.85)' : 'var(--text-3)' }}
          >
            {label.desc}
          </div>
        )}
      </div>
    </button>
  );
}
