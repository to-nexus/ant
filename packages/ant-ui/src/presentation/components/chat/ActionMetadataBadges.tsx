import { useCallback, useMemo } from 'react';
import { useStore } from '@/domain/store';
import { useTranslation } from 'react-i18next';
import { INTENT_DEFINITIONS, compressPathsByFolderCore, getConfigSlotsForDomain, getIntentLabel, isDirLevelTarget, type ActionMetadata, type IntentId } from '@ant/shared';
import { X, Target, Crosshair, FileText, Folder, BookOpen, Zap, Lock } from 'lucide-react';
import { BadgeOverflowRow, type BadgeOverflowItem } from './BadgeOverflowRow';
import {
  makeTreeListDir,
  removeSelectedEntry,
  resolveSelectedEntries,
  type SelectedEntry,
} from '@/shared/utils/selectionDisplay';

interface BadgeProps {
  icon: any;
  label: string;
  value: string;
  /** Optional suffix shown next to the value (e.g. "(3 files)" for folder badges). */
  suffix?: string;
  color: string;
  onRemove?: () => void;
}

function Badge({ icon: Icon, label, value, suffix, color, onRemove }: BadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-xs font-medium border transition-colors ${color}`}>
      <Icon className="w-3 h-3 shrink-0" />
      <span className="truncate max-w-[120px]">{value}</span>
      {suffix && <span className="text-[10px] opacity-70 ml-0.5 shrink-0">{suffix}</span>}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 p-0.5 rounded-full hover:bg-[color:var(--bg-hover)] transition-colors"
          aria-label={`Remove ${label}`}
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </span>
  );
}

interface ActionMetadataBadgesProps {
  metadata?: ActionMetadata;
  readOnly?: boolean;
  /** Badge-row padding. Defaults to the live config-footer look; the user
   *  bubble overrides this to align badges with the message text. */
  className?: string;
}

export function ActionMetadataBadges({ metadata, readOnly = false, className = 'px-3 pt-2 pb-1' }: ActionMetadataBadgesProps) {
  const { i18n } = useTranslation();
  const lang = i18n.language as 'en' | 'ko';
  const updateActionMetadata = useStore(s => s.updateActionMetadata);
  const resetActionMetadata = useStore(s => s.resetActionMetadata);
  const setActionsStep = useStore(s => s.setActionsStep);
  const selectAction = useStore(s => s.selectAction);
  const selectedActionId = useStore(s => s.selectedActionId);
  const storeMetadata = useStore(s => s.actionMetadata);
  const fileTree = useStore(s => s.fileTree);

  const meta = metadata || storeMetadata;

  // Folder-collapse view. SSE/durable records (user bubble, PinnedQuery) arrive
  // BE-enriched with `foldersCompressed`; the live store metadata (chat input)
  // does not, so compute it here from the in-memory `fileTree` via the shared
  // `compressPathsByFolderCore` — the same decision the BE makes at submit.
  const folders = useMemo(() => {
    if (meta.foldersCompressed) return meta.foldersCompressed;
    if (!fileTree.length) return undefined;
    const listDir = makeTreeListDir(fileTree);
    return {
      target: meta.target?.length ? compressPathsByFolderCore(meta.target, listDir) : undefined,
      refs: meta.refs?.length ? compressPathsByFolderCore(meta.refs, listDir) : undefined,
      context: meta.context?.length ? compressPathsByFolderCore(meta.context, listDir) : undefined,
    };
  }, [meta.foldersCompressed, meta.target, meta.refs, meta.context, fileTree]);

  // D28 — domain-filter slots so a service-workspace ref-lock check
  // never matches a phantom game-art slot (and vice versa).
  const slots = useMemo(() => {
    if (!meta.intent) return null;
    return getConfigSlotsForDomain(meta.intent as IntentId, meta.domain ?? 'service');
  }, [meta.intent, meta.domain]);

  const isLockedIn = useCallback(
    (path: string, list: NonNullable<typeof slots>['refs'] | undefined): boolean => {
      if (!list) return false;
      return list.some(s =>
        (s.locked || s.codebase) &&
        (s.type === 'file' ? path === s.path : !s.path || path.startsWith(s.path + '/')),
      );
    },
    [],
  );

  const isRefLocked = useCallback(
    (refPath: string): boolean => isLockedIn(refPath, slots?.refs),
    [slots, isLockedIn],
  );
  const isCtxLocked = useCallback(
    (ctxPath: string): boolean => isLockedIn(ctxPath, slots?.context),
    [slots, isLockedIn],
  );

  const hasAnything = meta.explicit || meta.intent
    || (meta.target && meta.target.length > 0)
    || (meta.refs && meta.refs.length > 0)
    || (meta.context && meta.context.length > 0);
  if (!hasAnything) return null;

  const intentDef = meta.intent ? INTENT_DEFINITIONS.find(d => d.id === meta.intent) : null;
  const intentLabel = intentDef ? getIntentLabel(intentDef, meta.domain, lang) : meta.intent;

  const handleRemoveExplicit = () => {
    if (readOnly) return;
    updateActionMetadata({ explicit: undefined });
  };

  const handleRemoveIntent = () => {
    if (readOnly) return;
    if (selectedActionId) {
      selectAction(selectedActionId);
      setActionsStep('pick-intent');
    } else {
      resetActionMetadata();
    }
  };

  const handleRemoveRefEntry = (entry: SelectedEntry) => {
    if (readOnly) return;
    updateActionMetadata({ explicit: undefined, refs: removeSelectedEntry(meta.refs, entry) });
  };

  const handleRemoveContextEntry = (entry: SelectedEntry) => {
    if (readOnly) return;
    updateActionMetadata({ explicit: undefined, context: removeSelectedEntry(meta.context, entry) });
  };

  const pinned: BadgeOverflowItem[] = [];
  const overflowable: BadgeOverflowItem[] = [];

  if (meta.explicit) {
    pinned.push({
      key: 'explicit',
      node: (
        <span
          className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-xs font-semibold border transition-colors"
          style={{
            background: 'var(--status-todo-bg)',
            borderColor: 'var(--border-1)',
            color: 'var(--status-todo-fg)',
          }}
        >
          <Zap className="w-3 h-3 shrink-0" />
          <span>Explicit</span>
          {!readOnly && (
            <button
              type="button"
              onClick={handleRemoveExplicit}
              className="ml-0.5 p-0.5 rounded-full hover:bg-[color:var(--bg-hover)] transition-colors"
              aria-label="Remove explicit"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </span>
      ),
    });
  }

  if (meta.intent && intentLabel) {
    pinned.push({
      key: `intent:${meta.intent}`,
      node: (
        <Badge
          icon={Target}
          label="intent"
          value={intentLabel}
          color="bg-[color:var(--status-todo-bg)] border-[color:var(--border-1)] text-[color:var(--status-todo-fg)]"
          onRemove={readOnly ? undefined : handleRemoveIntent}
        />
      ),
    });
  }

  const folderSuffix = (count: number | undefined): string | undefined =>
    typeof count === 'number'
      ? lang === 'ko' ? `(파일 ${count}개)` : `(${count} files)`
      : undefined;

  // Dir-level matrix target (`isDirLevelTarget`) that does not exist on disk
  // yet: `compressPathsByFolderCore`'s self-directory branch cannot see it, so
  // read the granularity from the matrix instead of listing speculative files.
  const dirLevelTargetPath = slots && isDirLevelTarget(slots.target) && slots.target.kind === 'generate'
    ? slots.target.dir
    : undefined;
  const targetEntries = resolveSelectedEntries(folders?.target, meta.target).map(entry =>
    !entry.isFolder && entry.rawPath === dirLevelTargetPath
      ? { ...entry, isFolder: true, display: `${entry.display}/` }
      : entry,
  );

  targetEntries.forEach(entry => {
    pinned.push({
      key: `target:${entry.isFolder ? 'folder:' : ''}${entry.rawPath}`,
      node: (
        <Badge
          icon={entry.isFolder ? Folder : Crosshair}
          label="target"
          value={entry.display}
          suffix={entry.isFolder ? folderSuffix(entry.fileCount) : undefined}
          color="bg-[color:var(--status-progress-bg)] border-[color:var(--border-1)] text-[color:var(--status-progress-fg)]"
        />
      ),
    });
  });

  resolveSelectedEntries(folders?.refs, meta.refs).forEach(entry => {
    const locked = isRefLocked(entry.rawPath);
    const icon = locked ? Lock : (entry.isFolder ? Folder : FileText);
    const node = (
      <Badge
        icon={icon}
        label="ref"
        value={entry.display}
        suffix={entry.isFolder ? folderSuffix(entry.fileCount) : undefined}
        color="bg-[color:var(--status-done-bg)] border-[color:var(--border-1)] text-[color:var(--status-done-fg)]"
        onRemove={readOnly || locked ? undefined : () => handleRemoveRefEntry(entry)}
      />
    );
    const item: BadgeOverflowItem = {
      key: `ref:${entry.isFolder ? 'folder:' : ''}${entry.rawPath}`,
      node,
    };
    if (locked) pinned.push(item);
    else overflowable.push(item);
  });

  resolveSelectedEntries(folders?.context, meta.context).forEach(entry => {
    const locked = isCtxLocked(entry.rawPath);
    const icon = locked ? Lock : (entry.isFolder ? Folder : BookOpen);
    const node = (
      <Badge
        icon={icon}
        label="ctx"
        value={entry.display}
        suffix={entry.isFolder ? folderSuffix(entry.fileCount) : undefined}
        color="bg-[color:var(--bg-surface-2)] border-[color:var(--border-1)] text-[color:var(--text-3)]"
        onRemove={readOnly || locked ? undefined : () => handleRemoveContextEntry(entry)}
      />
    );
    const item: BadgeOverflowItem = {
      key: `ctx:${entry.isFolder ? 'folder:' : ''}${entry.rawPath}`,
      node,
    };
    if (locked) pinned.push(item);
    else overflowable.push(item);
  });

  return (
    <BadgeOverflowRow
      pinned={pinned}
      overflowable={overflowable}
      className={className}
    />
  );
}
