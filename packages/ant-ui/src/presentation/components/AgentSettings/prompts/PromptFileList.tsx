/**
 * Grouped prompt file list — the top half of the Prompts card. Flat rows
 * under semantic group headers (base = always injected, injections =
 * intent-gated with per-row intent badges, config = the yaml hatches).
 * Intent bindings surface here ONCE: badges open the BindingPopover, the
 * hover "+" adds a first binding.
 */

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Plus } from 'lucide-react';
import type { CustomAgentDefinitionFileNode } from '@ant/shared';
import { Badge } from '@/presentation/components/aurora';
import { StatusPill } from '@/presentation/components/ConfigEditor/aurora';
import { selectedRowLabel, selectedRowStyle } from '@/presentation/components/aurora/selection';
import { buildPromptGroups, type PromptRow, type PromptsScope } from './promptGroups';
import { BindingPopover } from './BindingPopover';

const MAX_VISIBLE_BADGES = 3;

export interface PromptFileListProps {
  tree: CustomAgentDefinitionFileNode[];
  scope: PromptsScope;
  intentBindings: Record<string, string[]>;
  bindableIntentIds: (path: string) => string[];
  selectedPath: string | null;
  selectedDirty: boolean;
  readonly: boolean;
  onOpen: (path: string) => void;
  onBind: (intentId: string, path: string) => void;
  onUnbind: (intentId: string, path: string) => void;
}

function IntentBadgeButton({
  intentId,
  onClick,
}: {
  intentId: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0"
      style={{
        fontSize: 10,
        fontFamily: 'var(--font-mono)',
        padding: '1px 7px',
        borderRadius: 'var(--r-pill)',
        border: '1px solid var(--violet-300)',
        color: 'var(--select-fg)',
        background: 'var(--select-fill-violet)',
        cursor: 'pointer',
      }}
    >
      {intentId}
    </button>
  );
}

function FileRow({
  row,
  selected,
  dirty,
  readonly,
  bindable,
  onOpen,
  onBind,
  onUnbind,
}: {
  row: PromptRow;
  selected: boolean;
  dirty: boolean;
  readonly: boolean;
  bindable: string[];
  onOpen: () => void;
  onBind: (intentId: string) => void;
  onUnbind: (intentId: string) => void;
}) {
  const { t } = useTranslation('agents');
  const rowRef = useRef<HTMLDivElement>(null);
  const [popover, setPopover] = useState<{ anchor: HTMLElement; highlight?: string } | null>(null);

  const isInjection = row.kind === 'injection';
  const visibleBadges = row.boundIntents.slice(0, MAX_VISIBLE_BADGES);
  const overflow = row.boundIntents.length - visibleBadges.length;

  const openPopover = (e: React.MouseEvent<HTMLButtonElement>, highlight?: string) => {
    e.stopPropagation();
    setPopover({ anchor: e.currentTarget, highlight });
  };

  return (
    <div
      ref={rowRef}
      className="group flex items-center gap-1.5 py-1 px-1.5 rounded text-xs cursor-pointer hover:bg-[color:var(--bg-hover)]"
      style={{ ...selectedRowStyle('violet', selected), ...selectedRowLabel(selected, 'var(--text-2)') }}
      onClick={onOpen}
    >
      <FileText className="w-3 h-3 shrink-0" />
      <span className="truncate" style={{ fontFamily: 'var(--font-mono)' }}>
        {row.name}
        {dirty ? ' •' : ''}
      </span>
      <span className="flex-1" />

      {row.kind === 'base' && (
        <Badge tone="info" size="sm">
          {t('prompts.alwaysInjected', 'always injected')}
        </Badge>
      )}

      {isInjection && (
        <span className="flex items-center gap-1 min-w-0" onClick={(e) => e.stopPropagation()}>
          {visibleBadges.map((intentId) => (
            <IntentBadgeButton key={intentId} intentId={intentId} onClick={(e) => openPopover(e, intentId)} />
          ))}
          {overflow > 0 && <IntentBadgeButton intentId={`+${overflow}`} onClick={(e) => openPopover(e)} />}
          {row.boundIntents.length === 0 && (
            <button type="button" onClick={(e) => openPopover(e)} className="shrink-0">
              <StatusPill state="not-configured" label={t('prompts.unbound', 'not bound')} />
            </button>
          )}
          {!readonly && bindable.length > 0 && (
            <button
              type="button"
              title={t('prompts.bindToIntent', 'Bind to intent…')}
              aria-label={t('prompts.bindToIntent', 'Bind to intent…')}
              className="opacity-0 group-hover:opacity-100 inline-flex items-center justify-center h-4 w-4 rounded text-[color:var(--text-3)] hover:text-[color:var(--text-2)] hover:bg-[color:var(--bg-active)]"
              onClick={(e) => openPopover(e)}
            >
              <Plus className="w-3 h-3" />
            </button>
          )}
        </span>
      )}

      {popover && (
        <BindingPopover
          anchor={popover.anchor}
          boundIntents={row.boundIntents}
          bindable={bindable}
          readonly={readonly}
          highlightIntent={popover.highlight}
          onBind={(intentId) => onBind(intentId)}
          onUnbind={(intentId) => onUnbind(intentId)}
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  );
}

export function PromptFileList({
  tree,
  scope,
  intentBindings,
  bindableIntentIds,
  selectedPath,
  selectedDirty,
  readonly,
  onOpen,
  onBind,
  onUnbind,
}: PromptFileListProps) {
  const { t } = useTranslation('agents');
  const groups = buildPromptGroups(tree, scope, intentBindings);

  if (groups.length === 0) {
    return (
      <span className="text-xs px-1" style={{ color: 'var(--text-4)' }}>
        {t('prompts.empty', 'No prompt files in this scope yet.')}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {groups.map((group) => (
        <div key={group.id} className="flex flex-col gap-0.5">
          <div
            className="text-[10px] font-semibold uppercase tracking-wide px-1.5"
            style={{ color: 'var(--text-4)' }}
          >
            {t(group.labelKey, group.id)}
          </div>
          {group.rows.map((row) => (
            <FileRow
              key={row.path}
              row={row}
              selected={selectedPath === row.path}
              dirty={selectedPath === row.path && selectedDirty}
              readonly={readonly}
              bindable={bindableIntentIds(row.path)}
              onOpen={() => onOpen(row.path)}
              onBind={(intentId) => onBind(intentId, row.path)}
              onUnbind={(intentId) => onUnbind(intentId, row.path)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
