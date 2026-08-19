/**
 * Prompt file list — the top half of the Prompts card. A flat list of the
 * scope's `base/*.md` files, nothing more: with injections gone every file
 * here is unconditionally injected, so a group header and an "always injected"
 * badge per row would restate the same fact on every line.
 *
 * The list is height-capped by the card, so the row the right pane currently
 * expresses is scrolled into view — a tree click on the 7th file must not
 * select a row nobody can see.
 */

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';
import type { CustomAgentDefinitionFileNode } from '@ant/shared';
import { selectedRowLabel, selectedRowStyle } from '@/presentation/components/aurora/selection';
import { buildPromptRows, type PromptRow, type PromptsScope } from './promptRows';

export interface PromptFileListProps {
  tree: CustomAgentDefinitionFileNode[];
  scope: PromptsScope;
  selectedPath: string | null;
  selectedDirty: boolean;
  onOpen: (path: string) => void;
}

function FileRow({
  row,
  selected,
  dirty,
  onOpen,
}: {
  row: PromptRow;
  selected: boolean;
  dirty: boolean;
  onOpen: () => void;
}) {
  return (
    <div
      data-prompt-path={row.path}
      className="group flex items-center gap-1.5 py-1 px-1.5 rounded text-xs cursor-pointer hover:bg-[color:var(--bg-hover)]"
      style={{ ...selectedRowStyle('violet', selected), ...selectedRowLabel(selected, 'var(--text-2)') }}
      onClick={onOpen}
    >
      <FileText className="w-3 h-3 shrink-0" />
      <span className="truncate" style={{ fontFamily: 'var(--font-mono)' }}>
        {row.name}
        {dirty ? ' •' : ''}
      </span>
    </div>
  );
}

export function PromptFileList({ tree, scope, selectedPath, selectedDirty, onOpen }: PromptFileListProps) {
  const { t } = useTranslation('agents');
  const rows = buildPromptRows(tree, scope);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Tree→card sync: reveal the addressed row ('nearest' is a no-op when it is
  // already visible).
  useEffect(() => {
    if (!selectedPath) return;
    rootRef.current
      ?.querySelector(`[data-prompt-path="${CSS.escape(selectedPath)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedPath, rows.length]);

  if (rows.length === 0) {
    return (
      <span className="text-xs px-1" style={{ color: 'var(--text-4)' }}>
        {t('prompts.empty', 'No prompt files in this scope yet.')}
      </span>
    );
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-0.5">
      {rows.map((row) => (
        <FileRow
          key={row.path}
          row={row}
          selected={selectedPath === row.path}
          dirty={selectedPath === row.path && selectedDirty}
          onOpen={() => onOpen(row.path)}
        />
      ))}
    </div>
  );
}
