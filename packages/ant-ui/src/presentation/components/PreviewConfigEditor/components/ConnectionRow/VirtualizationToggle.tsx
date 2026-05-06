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
  const baseClass =
    'px-2 py-0.5 text-[10px] font-medium rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const activeChipClass = 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300';
  const realChipClass = 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300';
  const inactiveClass = 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700';

  return (
    <div
      role="group"
      aria-label="Service Virtualization toggle"
      className="flex items-center gap-1"
      title={`Service Virtualization: ${conn.virtualization.toggleEnvVar}`}
    >
      <button
        type="button"
        onClick={() => onToggle(false)}
        disabled={disabled || !active}
        aria-pressed={!active}
        className={`${baseClass} ${!active ? realChipClass : inactiveClass}`}
        title={`Use real endpoint (${conn.virtualization.toggleEnvVar}=false)`}
      >
        Real
      </button>
      <button
        type="button"
        onClick={() => onToggle(true)}
        disabled={disabled || active}
        aria-pressed={active}
        className={`${baseClass} ${active ? activeChipClass : inactiveClass}`}
        title={`Use virtualized adapter (${conn.virtualization.toggleEnvVar}=true)`}
      >
        Virtualized
      </button>
    </div>
  );
}
