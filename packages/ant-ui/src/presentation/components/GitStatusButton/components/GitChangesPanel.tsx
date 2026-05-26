
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { FileChange } from '@ant/shared';

interface GitChangesPanelProps {
  staged: ReadonlyArray<FileChange>;
  unstaged: ReadonlyArray<FileChange>;
  untracked: ReadonlyArray<FileChange>;
  selectedFiles: string[];
  onSelectedFilesChange: (files: string[]) => void;
}

type RowState = 'S' | 'M' | 'U';

interface PanelRow {
  path: string;
  state: RowState;
}

interface StateTone {
  bg: string;
  fg: string;
}

// Theme-aware S/M/U letter badge tones. The underlying CSS tokens already
// resolve to the correct light/dark values via the project's token system,
// so no `document.documentElement.dataset.theme` branching is needed here
// (handoff used inline oklch() switching; ours rides on the token layer).
const STATE_TONES: Record<RowState, StateTone> = {
  S: {
    bg: 'var(--status-done-bg)',
    fg: 'var(--status-done-fg)',
  },
  M: {
    bg: 'color-mix(in srgb, var(--orange-500) 14%, transparent)',
    fg: 'var(--orange-600)',
  },
  U: {
    bg: 'color-mix(in srgb, var(--violet-500) 14%, transparent)',
    fg: 'var(--violet-700)',
  },
};

/**
 * Compact S/M/U changes list per handoff b3-explorer.jsx.
 *
 *   S → staged
 *   M → unstaged (modified working-tree)
 *   U → untracked
 *
 * Each row is a check-able label with a 14x14 letter badge and a
 * monospace path rendered RTL so the file's tail stays visible when
 * truncated. Discard is owned by the panel-level button in
 * `GitStatusButton`; there is no per-row discard affordance.
 */
export function GitChangesPanel({
  staged,
  unstaged,
  untracked,
  selectedFiles,
  onSelectedFilesChange,
}: GitChangesPanelProps) {
  const { t } = useTranslation('explorer');

  const rows: PanelRow[] = [
    ...staged.map<PanelRow>((f) => ({ path: f.path, state: 'S' })),
    ...unstaged.map<PanelRow>((f) => ({ path: f.path, state: 'M' })),
    ...untracked.map<PanelRow>((f) => ({ path: f.path, state: 'U' })),
  ];

  const allPaths = rows.map((r) => r.path);
  const allSelected = allPaths.length > 0 && allPaths.every((p) => selectedFiles.includes(p));
  const someSelected = selectedFiles.length > 0 && !allSelected;
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  if (rows.length === 0) return null;

  const handleToggleAll = () => {
    if (allSelected) {
      onSelectedFilesChange([]);
    } else {
      onSelectedFilesChange([...allPaths]);
    }
  };

  const handleToggleFile = (filePath: string) => {
    if (selectedFiles.includes(filePath)) {
      onSelectedFilesChange(selectedFiles.filter((f) => f !== filePath));
    } else {
      onSelectedFilesChange([...selectedFiles, filePath]);
    }
  };

  const visibleRows = rows.slice(0, 20);

  return (
    <div
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border-1)',
        borderRadius: 'var(--r-sm)',
        padding: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        maxHeight: 144,
        overflowY: 'auto',
      }}
    >
      {/* select-all row */}
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '2px 4px',
          borderRadius: 4,
          cursor: 'pointer',
          userSelect: 'none',
          fontSize: 10,
        }}
      >
        <input
          ref={selectAllRef}
          type="checkbox"
          checked={allSelected}
          onChange={handleToggleAll}
          style={{ accentColor: 'var(--violet-500)', width: 11, height: 11 }}
        />
        <span style={{ width: 14, flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, color: 'var(--text-3)' }}>
          {allSelected ? t('git.deselectAll') : t('git.selectAll')}
        </span>
      </label>

      {visibleRows.map((row, i) => {
        const tone = STATE_TONES[row.state];
        const checked = selectedFiles.includes(row.path);
        return (
          <label
            key={row.path + i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '2px 4px',
              borderRadius: 4,
              cursor: 'pointer',
              userSelect: 'none',
              fontSize: 10,
            }}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => handleToggleFile(row.path)}
              style={{ accentColor: 'var(--violet-500)', width: 11, height: 11 }}
            />
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 14,
                height: 14,
                borderRadius: 3,
                background: tone.bg,
                color: tone.fg,
                fontSize: 8,
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                flexShrink: 0,
              }}
            >
              {row.state}
            </span>
            <span
              title={row.path}
              style={{
                flex: 1,
                minWidth: 0,
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-2)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                direction: 'rtl',
              }}
            >
              {row.path}
            </span>
          </label>
        );
      })}
    </div>
  );
}
