import type { ServiceConnection } from '@/infrastructure/http/api';

/**
 * Per-connection [Real | Virtualized] toggle.
 *
 * Renders only for connections whose `virtualization` strategy was attached
 * by the BE detector — i.e. every `business` connection. `infrastructure`
 * connections (docker-compose) skip rendering because virtualization is
 * not a concern there.
 *
 * Clicking either button calls `onToggle(active)`. The parent owns the
 * actual transport: the active state is persisted by writing
 * `USE_MOCK_<NAME>=true|false` to the project `.env` file via a dedicated
 * BE endpoint, so a real-swap requires zero code changes.
 */
export function VirtualizationToggle({
  conn,
  onToggle,
  disabled,
}: {
  conn: ServiceConnection;
  onToggle: (active: boolean) => void;
  disabled?: boolean;
}) {
  if (!conn.virtualization) return null;

  const active = conn.virtualization.active;

  const baseStyle: React.CSSProperties = {
    padding: '2px 8px',
    fontSize: 10,
    fontWeight: 700,
    borderRadius: 'var(--r-pill)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    letterSpacing: '0.02em',
  };

  const realActive: React.CSSProperties = {
    ...baseStyle,
    background: 'oklch(94% 0.04 240 / 0.55)',
    color: 'oklch(42% 0.14 250)',
    border: '1px solid oklch(84% 0.08 240)',
  };
  const virtActive: React.CSSProperties = {
    ...baseStyle,
    background: 'oklch(94% 0.06 290 / 0.55)',
    color: 'var(--violet-700)',
    border: '1px solid var(--violet-200)',
  };
  const inactive: React.CSSProperties = {
    ...baseStyle,
    background: 'var(--bg-surface-2)',
    color: 'var(--text-4)',
    border: '1px solid var(--border-2)',
  };

  return (
    <div
      role="group"
      aria-label="Service Virtualization toggle"
      title={`Service Virtualization: ${conn.virtualization.toggleEnvVar}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
    >
      <button
        type="button"
        onClick={() => onToggle(false)}
        disabled={disabled || !active}
        aria-pressed={!active}
        style={!active ? realActive : inactive}
        title={`Use real endpoint (${conn.virtualization.toggleEnvVar}=false)`}
      >
        Real
      </button>
      <button
        type="button"
        onClick={() => onToggle(true)}
        disabled={disabled || active}
        aria-pressed={active}
        style={active ? virtActive : inactive}
        title={`Use virtualized adapter (${conn.virtualization.toggleEnvVar}=true)`}
      >
        Virtualized
      </button>
    </div>
  );
}
