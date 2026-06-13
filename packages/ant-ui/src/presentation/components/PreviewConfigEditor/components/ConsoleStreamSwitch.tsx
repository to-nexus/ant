import { SignalRing } from '@/presentation/components/ConfigEditor/aurora';
import type { SignalRingState } from '@/presentation/components/ConfigEditor/aurora';

/**
 * Dev | Deploy stream switch rendered inside the docked console's dark header.
 *
 * Local to the console surface on purpose: aurora `Tabs` is bound to the
 * light editor theme (var(--text-1), violet) and is illegible here. This is
 * a terminal-surface switcher, not a general-purpose tab primitive — it
 * styles with the console's own oklch/mono palette and reuses `SignalRing`
 * for per-stream status.
 */
export interface ConsoleStream {
  id: string;
  label: string;
  signal: SignalRingState;
  unread: boolean;
}

export function ConsoleStreamSwitch({
  streams,
  activeId,
  onSelect,
  ariaLabel,
}: {
  streams: ConsoleStream[];
  activeId: string;
  onSelect: (id: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      style={{ display: 'flex', alignItems: 'center', gap: 4 }}
    >
      {streams.map((s) => {
        const isActive = s.id === activeId;
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(s.id)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '3px 8px',
              borderRadius: 4,
              border: 'none',
              background: isActive ? 'oklch(22% 0.05 290)' : 'transparent',
              color: isActive ? 'oklch(92% 0.02 290)' : 'oklch(65% 0.03 290)',
              fontFamily: 'inherit',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            <SignalRing state={s.signal} size={8} />
            {s.label}
            {s.unread && !isActive && (
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'oklch(70% 0.18 155)',
                  boxShadow: '0 0 8px oklch(70% 0.18 155 / 0.6)',
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
