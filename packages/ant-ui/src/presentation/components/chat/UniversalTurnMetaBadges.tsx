import { useMemo } from 'react';
import { useStore } from '@/domain/store';
import { X, Target, BookOpen, ClipboardList, Folder, Bot } from 'lucide-react';
import { compressSelection, removeSelectedEntry } from '@/shared/utils/selectionDisplay';
import { ctxAgentIdOf } from './hooks/universalMentionSurface';
import { useArtifactPickerTree } from '@/application/hooks/ui/useArtifactPickerTree';

/**
 * Chips for the universal explicit turn meta (`@intent:` / `@ctx:` / `@plan`
 * mentions). Mirrors the ActionMetadataBadges look; the data source is
 * `universalTurnMeta` (run-scoped, reset on send/job-switch) instead of the
 * canonical actionMetadata store.
 */
export function UniversalTurnMetaBadges({ className = 'px-3 pt-2 pb-1' }: { className?: string }) {
  const projectType = useStore(s => s.projectType);
  const meta = useStore(s => s.universalTurnMeta);
  const removeIntent = useStore(s => s.removeUniversalIntentMention);
  const setContextMentions = useStore(s => s.setUniversalContextMentions);
  const setPlan = useStore(s => s.setUniversalPlanMention);
  const fileTree = useArtifactPickerTree();
  // Folder-unit ctx selections render as one `name/ (N)` chip — same shared
  // compression core the canonical badge row uses.
  const contextEntries = useMemo(
    () => compressSelection(meta.context, fileTree),
    [meta.context, fileTree],
  );

  if (projectType !== 'universal') return null;
  if (meta.intents.length === 0 && meta.context.length === 0 && !meta.plan) return null;

  const chip = (
    key: string,
    Icon: typeof Target,
    value: string,
    color: string,
    onRemove: () => void,
  ) => (
    <span
      key={key}
      className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-xs font-medium border transition-colors ${color}`}
    >
      <Icon className="w-3 h-3 shrink-0" />
      <span className="truncate max-w-[140px]">{value}</span>
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 p-0.5 rounded-full hover:bg-[color:var(--bg-hover)] transition-colors"
        aria-label={`Remove ${value}`}
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );

  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      {meta.plan &&
        chip(
          'plan',
          ClipboardList,
          'plan',
          'bg-[color:var(--status-warning-bg, var(--bg-surface-2))] border-[color:var(--border-1)] text-[color:var(--status-warning-fg, var(--text-2))]',
          () => setPlan(false),
        )}
      {meta.intents.map(id =>
        chip(
          `intent:${id}`,
          Target,
          id,
          'bg-[color:var(--status-todo-bg)] border-[color:var(--border-1)] text-[color:var(--status-todo-fg)]',
          () => removeIntent(id),
        ),
      )}
      {contextEntries.map(entry => {
        // A peer definition chip is named by WHOSE it is — a bare `job.yaml`
        // is indistinguishable from an artifact of the same name.
        const agentId = ctxAgentIdOf(entry.rawPath);
        const display = agentId ? `${agentId} · ${entry.display}` : entry.display;
        return chip(
          `ctx:${entry.rawPath}`,
          agentId ? Bot : entry.isFolder ? Folder : BookOpen,
          entry.fileCount !== undefined ? `${display} (${entry.fileCount})` : display,
          'bg-[color:var(--bg-surface-2)] border-[color:var(--border-1)] text-[color:var(--text-3)]',
          () => setContextMentions(removeSelectedEntry(meta.context, entry) ?? []),
        );
      })}
    </div>
  );
}
