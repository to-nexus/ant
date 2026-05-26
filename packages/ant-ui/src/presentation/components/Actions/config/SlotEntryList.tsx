import { useTranslation } from 'react-i18next';
import { Plus, Upload, FolderOpen } from 'lucide-react';
import { getFileDescription, getDirDescription } from '@ant/shared';
import { FileCard } from './FileCard';
import type { SlotEntry, SlotSubgroup, SlotWarning } from './types';

interface SlotEntryListProps {
  entries: SlotEntry[];
  selected: Set<string>;
  onToggle: (path: string) => void;
  /**
   * Batch-toggle for dir-level cards (ui-source `ant` / `handoff`):
   * selects all supplied file paths when none are selected, otherwise
   * deselects them all. Falls back to per-file `onToggle` when absent.
   */
  onToggleMany?: (paths: string[]) => void;
  onHighlightDir: (dir: string) => void;
  onCreateIntent: (intentId: string) => void;
  onUploadDir?: (dir: string) => void;
  onToggleSpotlight: (type: 'file' | 'dir', path: string) => void;
  onViewFile?: (path: string) => void;
  spotlightPath?: string | null;
  showEmptyActions?: boolean;
  lang: 'en' | 'ko';
}

export function SlotEntryList({ entries, selected, onToggle, onToggleMany, onHighlightDir, onCreateIntent, onUploadDir, onToggleSpotlight, onViewFile, spotlightPath, showEmptyActions = true, lang }: SlotEntryListProps) {
  const { t } = useTranslation('actions');
  const showSlotLabels = entries.length > 1;

  // ── ui-source subgroup renderers (captured closures) ────────────────────
  type SubgroupCtx = { isLocked: boolean; lockedBySlot?: boolean };

  const renderFigmaSubgroup = (sg: SlotSubgroup, ctx: SubgroupCtx): React.ReactNode[] => {
    if (!sg.hasFiles) {
      return [(
        <FileCard
          key={`${sg.dir}-empty`}
          name={sg.humanLabel?.[lang] || sg.label[lang] || sg.label.en}
          path={`${sg.dir}/`}
          empty
          emptyStyle="gray"
          disabled={ctx.isLocked}
          lang={lang}
        />
      )];
    }
    return sg.files.map(f => (
      <FileCard
        key={f.path}
        name={f.name}
        path={f.path}
        warnings={f.warnings}
        description={getFileDescription(f.name, sg.dir)}
        selected={!ctx.isLocked && f.warnings.length === 0 && selected.has(f.path)}
        disabled={ctx.isLocked}
        locked={ctx.lockedBySlot}
        onToggle={ctx.isLocked ? undefined : () => onToggle(f.path)}
        onViewFile={onViewFile ? () => onViewFile(f.path) : undefined}
        spotlight={{
          active: spotlightPath === f.path,
          onClick: () => onToggleSpotlight('file', f.path),
          title: t('emptySlot.viewInExplorer'),
        }}
        lang={lang}
      />
    ));
  };

  const renderDirSubgroup = (sg: SlotSubgroup, ctx: SubgroupCtx): React.ReactNode[] => {
    const name = sg.humanLabel?.[lang] || sg.humanLabel?.en || sg.label[lang] || sg.label.en;
    const dirDesc = getDirDescription(sg.dir)?.description ?? null;

    if (!sg.hasFiles) {
      return [(
        <FileCard
          key={`${sg.dir}-empty`}
          name={name}
          path={`${sg.dir}/`}
          description={dirDesc}
          empty
          emptyStyle="gray"
          disabled={ctx.isLocked}
          spotlight={{
            active: spotlightPath === sg.dir,
            onClick: () => onToggleSpotlight('dir', sg.dir),
            title: t('emptySlot.viewInExplorer'),
          }}
          lang={lang}
        />
      )];
    }

    // Dir-level aggregation: valid files determine selection; per-file warnings
    // AND subgroup-level bundle warnings (e.g. ant missing ui-tokens.json) both
    // surface on the single card so the user sees one universal "invalid"
    // indicator regardless of the cause.
    const filePaths = sg.files.map(f => f.path);
    const validFilePaths = sg.files.filter(f => f.warnings.length === 0).map(f => f.path);
    const togglePaths = validFilePaths.length > 0 ? validFilePaths : filePaths;
    const allSelected = togglePaths.length > 0 && togglePaths.every(p => selected.has(p));
    const aggregatedWarnings: SlotWarning[] = [
      ...(sg.warnings ?? []),
      ...sg.files.flatMap(f => f.warnings),
    ];
    const firstFilePath = sg.files[0]?.path;

    const handleToggle = ctx.isLocked
      ? undefined
      : () => {
        if (onToggleMany) onToggleMany(togglePaths);
        else togglePaths.forEach(p => onToggle(p));
      };

    return [(
      <FileCard
        key={`${sg.dir}-dir`}
        name={name}
        path={`${sg.dir}/ (${sg.files.length})`}
        warnings={aggregatedWarnings}
        description={dirDesc}
        selected={!ctx.isLocked && aggregatedWarnings.length === 0 && allSelected}
        disabled={ctx.isLocked}
        locked={ctx.lockedBySlot}
        onToggle={handleToggle}
        onViewFile={onViewFile && firstFilePath ? () => onViewFile(firstFilePath) : undefined}
        spotlight={{
          active: spotlightPath === sg.dir,
          onClick: () => onToggleSpotlight('dir', sg.dir),
          title: t('emptySlot.viewInExplorer'),
        }}
        lang={lang}
      />
    )];
  };

  return (
    <div className="space-y-1.5">
      {entries.map(entry => {
        const slotLabel = showSlotLabels ? (
          <div key={`label-${entry.def.path || entry.def.label.en}`} className="flex items-center gap-1.5 pt-1.5 first:pt-0">
            <span className="text-xs font-medium text-[color:var(--text-3)]">
              {entry.def.humanLabel?.[lang] || entry.def.humanLabel?.en || entry.def.label[lang] || entry.def.label.en}
            </span>
          </div>
        ) : null;

        if (entry.def.codebase) {
          const card = (
            <FileCard
              key="codebase-ref"
              name={entry.def.humanLabel?.[lang] || entry.def.humanLabel?.en || t('target.codebase')}
              path={entry.hasFiles ? t('target.codebaseDetected') : t('target.codebaseEmpty')}
              selected={entry.hasFiles}
              locked={entry.hasFiles}
              empty={!entry.hasFiles}
              emptyStyle={!entry.hasFiles ? 'amber' : undefined}
              icon={<FolderOpen className={`w-4 h-4 ${entry.hasFiles ? 'text-emerald-500' : 'text-amber-400'} shrink-0`} />}
              lang={lang}
            />
          );
          return slotLabel ? [slotLabel, card] : card;
        }

        // ── UI Source slot: hard-exclusive between three subgroups ──
        // Rendering contract:
        //   - `figma` is rendered file-level (the single figma.json reference carries
        //     file-scoped warnings — URL unset, MCP disconnected — that only make sense
        //     per file).
        //   - `ant` and `handoff` are rendered dir-level (one card per subgroup): the
        //     ant bundle is a conceptual trio (tokens/assets/spec) and handoff is a
        //     free-form bundle; enumerating individual files adds no useful affordance.
        //   - No subgroup header: each card's name + info tooltip already explains the
        //     source, and reducing chrome keeps the slot compact.
        if (entry.def.type === 'ui-source' && entry.subgroups) {
          // First subgroup owning any selection wins; BE `validateUiSourceExclusivity`
          // guarantees mutual exclusivity so the "first" heuristic is sufficient.
          const activeSubgroupId = entry.subgroups.find(sg =>
            sg.files.some(f => selected.has(f.path)),
          )?.id;

          const cards = entry.subgroups.flatMap(sg => {
            const isLocked = activeSubgroupId !== undefined && activeSubgroupId !== sg.id;
            return sg.id === 'figma'
              ? renderFigmaSubgroup(sg, { isLocked, lockedBySlot: entry.def.locked })
              : renderDirSubgroup(sg, { isLocked, lockedBySlot: entry.def.locked });
          });

          return slotLabel ? [slotLabel, ...cards] : cards;
        }

        if (!entry.hasFiles) {
          const humanName = entry.def.humanLabel?.[lang] || entry.def.humanLabel?.en || entry.def.label[lang] || entry.def.label.en;
          const showWarningStyle = showEmptyActions && entry.def.required;
          const hasCreateIntent = showEmptyActions && !!entry.def.createIntent;
          const hasPath = !!entry.def.path;
          const dirDesc = hasPath ? getDirDescription(entry.def.path) : null;

          const card = (
            <FileCard
              key={entry.def.path || entry.def.label.en}
              name={showWarningStyle ? t('emptySlot.missing', { name: humanName }) : t('emptySlot.optionalEmpty', { name: humanName, defaultValue: entry.def.label[lang] || entry.def.label.en })}
              path={hasPath ? `${entry.def.path}/` : `— ${t('emptySlot.noFiles')}`}
              description={dirDesc?.description}
              empty
              emptyStyle={showWarningStyle ? 'amber' : 'gray'}
              spotlight={hasPath ? {
                active: spotlightPath === entry.def.path,
                onClick: () => onToggleSpotlight('dir', entry.def.path),
                title: t('emptySlot.viewInExplorer'),
              } : undefined}
              actions={showEmptyActions ? (
                <>
                  {hasCreateIntent && (
                    <button
                      type="button"
                      onClick={() => onCreateIntent(entry.def.createIntent!)}
                      className="p-2 rounded-lg bg-blue-100 text-blue-600 hover:bg-blue-200 transition-colors"
                      title={t('emptySlot.create')}
                    >
                      <Plus className="w-4.5 h-4.5" />
                    </button>
                  )}
                  {hasPath && (
                    <button
                      type="button"
                      onClick={() => onUploadDir ? onUploadDir(entry.def.path) : onHighlightDir(entry.def.path)}
                      className="p-2 rounded-lg bg-[color:var(--bg-surface-2)]/50 text-[color:var(--text-3)] hover:bg-[color:var(--bg-active)] transition-colors"
                      title={t('emptySlot.upload')}
                    >
                      <Upload className="w-4.5 h-4.5" />
                    </button>
                  )}
                </>
              ) : undefined}
              lang={lang}
            />
          );
          return slotLabel ? [slotLabel, card] : card;
        }

        const fileCards = entry.files.map(f => {
          const dirPath = f.path.includes('/') ? f.path.substring(0, f.path.lastIndexOf('/')) : undefined;
          return (
            <FileCard
              key={f.path}
              name={f.name}
              path={f.path}
              warnings={f.warnings}
              description={getFileDescription(f.name, dirPath)}
              selected={f.warnings.length === 0 && selected.has(f.path)}
              locked={entry.def.locked}
              onToggle={() => onToggle(f.path)}
              onViewFile={onViewFile ? () => onViewFile(f.path) : undefined}
              spotlight={{
                active: spotlightPath === f.path,
                onClick: () => onToggleSpotlight('file', f.path),
                title: t('emptySlot.viewInExplorer'),
              }}
              lang={lang}
            />
          );
        });

        if (entry.def.type === 'dir' && showEmptyActions && entry.def.path) {
          const hasCreateIntent = !!entry.def.createIntent;
          fileCards.push(
            <FileCard
              key={`${entry.def.path}-add`}
              name={t('emptySlot.addFile')}
              path={entry.def.path + '/'}
              empty
              emptyStyle="gray"
              actions={
                <>
                  {hasCreateIntent && (
                    <button
                      type="button"
                      onClick={() => onCreateIntent(entry.def.createIntent!)}
                      className="p-2 rounded-lg bg-blue-100 text-blue-600 hover:bg-blue-200 transition-colors"
                      title={t('emptySlot.create')}
                    >
                      <Plus className="w-4.5 h-4.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onUploadDir ? onUploadDir(entry.def.path) : onHighlightDir(entry.def.path)}
                    className="p-2 rounded-lg bg-[color:var(--bg-surface-2)]/50 text-[color:var(--text-3)] hover:bg-[color:var(--bg-active)] transition-colors"
                    title={t('emptySlot.upload')}
                  >
                    <Upload className="w-4.5 h-4.5" />
                  </button>
                </>
              }
              lang={lang}
            />
          );
        }

        return slotLabel ? [slotLabel, ...fileCards] : fileCards;
      })}
    </div>
  );
}
