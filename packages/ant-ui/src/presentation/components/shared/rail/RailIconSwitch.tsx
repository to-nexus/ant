import type { LucideIcon } from 'lucide-react';
import { TOOLBAR_ICON_CLASS } from './railTokens';

export interface RailIconSwitchOption<V extends string> {
  id: V;
  icon: LucideIcon;
  /** State name — the derived tooltip's `{{next}}`; explicit `labels` make it optional. */
  label?: string;
}

export interface RailIconSwitchProps<V extends string> {
  value: V;
  options: readonly [RailIconSwitchOption<V>, RailIconSwitchOption<V>];
  onChange: (next: V) => void;
  /** Explicit tooltip per CURRENT value; falls back to `railSwitchLabel`. */
  labels?: Partial<Record<V, string>>;
  /** Derived-tooltip template ("Switch to {{next}}") when no explicit label. */
  switchTo?: (nextLabel: string) => string;
}

/** Tooltip for a binary icon switch: explicit label wins, else "switch to <other>". */
export function railSwitchLabel<V extends string>(
  value: V,
  options: readonly [RailIconSwitchOption<V>, RailIconSwitchOption<V>],
  labels?: Partial<Record<V, string>>,
  switchTo?: (nextLabel: string) => string,
): string {
  const explicit = labels?.[value];
  if (explicit) return explicit;
  const next = options.find((o) => o.id !== value) ?? options[0];
  const nextLabel = next.label ?? next.id;
  return switchTo ? switchTo(nextLabel) : nextLabel;
}

/**
 * ONE icon toggles a binary: the icon is the current state, the tooltip names
 * the destination. A segmented pair spent rail width restating a binary the
 * icon already carries.
 */
export function RailIconSwitch<V extends string>({ value, options, onChange, labels, switchTo }: RailIconSwitchProps<V>) {
  const current = options.find((o) => o.id === value) ?? options[0];
  const next = options.find((o) => o.id !== value) ?? options[1];
  const label = railSwitchLabel(value, options, labels, switchTo);
  const Icon = current.icon;
  return (
    <button type="button" title={label} aria-label={label} className={TOOLBAR_ICON_CLASS} onClick={() => onChange(next.id)}>
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}
