
import { ChevronDown, ChevronUp, Terminal } from 'lucide-react';

export interface DockedConsoleLog {
  timestamp: string;
  message: string;
  type?: 'stdout' | 'stderr';
}

export interface DockedConsoleProps {
  logs: DockedConsoleLog[];
  title?: string;
  open: boolean;
  onToggle: () => void;
  emptyHint?: string;
}

/**
 * Bottom-docked mini console used by the C3 editors.
 * Renders the last 100 log lines. Dark surface independent of theme.
 */
export function DockedConsole({
  logs,
  title = 'CONSOLE',
  open,
  onToggle,
  emptyHint = '로그가 없습니다.',
}: DockedConsoleProps) {
  const visibleLogs = logs.slice(-100);
  const hasLogs = logs.length > 0;

  return (
    <div
      style={{
        position: 'sticky',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 5,
        background: 'oklch(13% 0.05 295)',
        color: 'oklch(82% 0.025 290)',
        borderTop: '1px solid oklch(28% 0.06 290)',
        boxShadow: '0 -12px 32px -8px oklch(15% 0.05 290 / 0.45)',
        fontFamily: 'var(--font-mono)',
        flexShrink: 0,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 16px',
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <Terminal size={13} strokeWidth={2} />
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 2,
            textTransform: 'uppercase',
            color: 'oklch(90% 0.02 290)',
          }}
        >
          {title}
        </span>
        <span
          style={{
            fontSize: 10,
            color: 'oklch(70% 0.03 290)',
            fontWeight: 500,
          }}
        >
          {logs.length} entries
        </span>
        {hasLogs && (
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'oklch(70% 0.18 155)',
              animation: 'pulse-soft 1.6s ease-in-out infinite',
              boxShadow: '0 0 8px oklch(70% 0.18 155 / 0.6)',
            }}
          />
        )}
        <span style={{ flex: 1 }} />
        {open ? (
          <ChevronDown size={14} strokeWidth={2} />
        ) : (
          <ChevronUp size={14} strokeWidth={2} />
        )}
      </button>
      {open && (
        <div
          style={{
            maxHeight: 200,
            overflowY: 'auto',
            padding: '4px 16px 12px',
            fontSize: 11.5,
            lineHeight: 1.55,
          }}
        >
          {visibleLogs.length === 0 ? (
            <div
              style={{
                fontStyle: 'italic',
                textAlign: 'center',
                color: 'oklch(60% 0.03 290)',
                padding: '12px 0',
              }}
            >
              {emptyHint}
            </div>
          ) : (
            visibleLogs.map((log, idx) => (
              <div
                key={idx}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '76px 1fr',
                  gap: 10,
                  padding: '1px 0',
                  color:
                    log.type === 'stderr'
                      ? 'oklch(72% 0.18 25)'
                      : 'oklch(82% 0.025 290)',
                }}
              >
                <span
                  style={{
                    color: 'oklch(55% 0.04 290)',
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {log.timestamp}
                </span>
                <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {log.message}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
