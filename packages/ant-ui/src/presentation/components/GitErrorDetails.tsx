/**
 * GitErrorDetails — collapsed technical detail for a failed Git operation.
 *
 * The raw git stderr is never the primary text of a dialog: it is unreadable
 * to most users and buries the recovery step. It stays available here, one
 * click away, for copy/paste into an issue.
 *
 * Only `useGitErrorRouting` renders this — it is the single owner of Git
 * error presentation.
 */

interface GitErrorDetailsProps {
  summary: string;
  detailLabel: string;
  raw?: string;
}

export function GitErrorDetails({ summary, detailLabel, raw }: GitErrorDetailsProps) {
  return (
    <span>
      {summary}
      {raw ? (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-3)' }}>
            {detailLabel}
          </summary>
          <pre
            style={{
              marginTop: 6,
              maxHeight: 180,
              overflow: 'auto',
              padding: 10,
              borderRadius: 8,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-2)',
              color: 'var(--text-2)',
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 11,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              userSelect: 'text',
            }}
          >
            {raw}
          </pre>
        </details>
      ) : null}
    </span>
  );
}
