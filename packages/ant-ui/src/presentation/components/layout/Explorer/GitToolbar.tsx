
import { GitBranch } from 'lucide-react';
import { GitStatusButton } from '../../GitStatusButton';
import { GitMenuButton } from '../../GitMenuButton';
import { useGitSnapshot } from '@/domain/git-world';

/**
 * Inline Git toolbar that sits directly under the active project row
 * (spec §5.4 / §6.2 T8). Owns no Git state — it just composes the
 * existing `<GitStatusButton />` (commit / push / pull / sync /
 * publish + discard) and `<GitMenuButton />` (Clone / Init / Publish /
 * Push / Pull / Fetch dropdown) so they share the same `git-world`
 * snapshot + FSM. The branch line (current branch + ahead/behind
 * counters) is absorbed into this toolbar so ProjectSection no longer
 * renders it separately — keeps Git-related affordances co-located.
 *
 * Aurora-toned container per B3 handoff: subtle surface-2 panel with
 * a hairline border, 12px radius, 8px padding, side-indented 10px to
 * align with row padding. Sits OUTSIDE the project RowList so it
 * doesn't scroll with the row collection.
 */
export function GitToolbar() {
  const snapshot = useGitSnapshot();
  const ahead = snapshot?.ahead ?? 0;
  const behind = snapshot?.behind ?? 0;
  const branch = snapshot?.currentBranch ?? null;

  return (
    <div
      style={{
        margin: '2px 10px 8px',
        padding: 8,
        background: 'color-mix(in srgb, var(--surface-2) 60%, transparent)',
        border: '1px solid var(--border-1)',
        borderRadius: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 6,
          alignItems: 'flex-start',
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            alignItems: 'stretch',
          }}
        >
          <GitStatusButton />
        </div>
        <GitMenuButton />
      </div>

      {branch && (
        <div
          style={{
            fontSize: 10,
            color: 'var(--text-3)',
            fontFamily: 'var(--font-mono)',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            paddingLeft: 2,
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          <GitBranch size={10} style={{ color: 'var(--violet-500)', flexShrink: 0 }} />
          <span
            style={{
              fontWeight: 600,
              color: 'var(--text-1)',
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={branch}
          >
            {branch}
          </span>
          {ahead > 0 && (
            <span style={{ color: 'var(--violet-600)', fontWeight: 700, flexShrink: 0 }}>
              ↑{ahead}
            </span>
          )}
          {behind > 0 && (
            <span style={{ color: 'var(--orange-600)', fontWeight: 700, flexShrink: 0 }}>
              ↓{behind}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
