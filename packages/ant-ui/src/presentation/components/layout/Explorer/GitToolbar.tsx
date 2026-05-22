
import { GitStatusButton } from '../../GitStatusButton';
import { GitMenuButton } from '../../GitMenuButton';

/**
 * Inline Git toolbar that sits directly under the active project row
 * (spec §5.4 / §6.2 T8). Owns no Git state — it just composes the
 * existing `<GitStatusButton />` (commit / push / pull / sync /
 * publish + discard) and `<GitMenuButton />` (Clone / Init / Publish /
 * Push / Pull / Fetch dropdown) so they share the same `git-world`
 * snapshot + FSM.
 *
 * Aurora-toned container: subtle surface-2 panel with a hairline
 * border. Sits OUTSIDE the project RowList so it doesn't scroll with
 * the row collection.
 */
export function GitToolbar() {
  return (
    <div
      style={{
        marginTop: 4,
        padding: 6,
        borderRadius: 8,
        background: 'var(--surface-2)',
        border: '1px solid var(--border-1)',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <GitStatusButton />
      <GitMenuButton />
    </div>
  );
}
