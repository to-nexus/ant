/**
 * PipelineRail — the left rail on the AgentTree model: an icon-only toolbar
 * on top (+ New pipeline), the approval inbox, then the pipelines grouped by
 * SCOPE (My / Organization — both headers always render so an empty group is
 * distinguishable from a nonexistent one, and each group collapses
 * independently), invalid rows, orphan-activation rows, and the SPACE toggle
 * (Workspace / Codespace) pinned in the footer — icon-only when the rail is
 * narrow. Availability is an icon, not a control: activation is managed ONLY
 * in the Execution view; enable/disable lives in the workspace header. Each
 * row carries the AgentTree's ⋯ menu, which offers the definition folder
 * export — a read, so it is there in every scope.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Building2,
  Boxes,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleSlash,
  Code2,
  FolderDown,
  Lock,
  Plus,
  Unlink,
  User,
} from 'lucide-react';
import type { PipelineActivationView, PipelineListEntry, PipelineScope } from '@ant/shared';
import { useStore } from '@/domain/store';
import { pipelineDraftIsDirty } from '@/domain/store/slices/pipelineSlice';
import { selectIsTeamActive } from '@/domain/store/selectors/auth';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { downloadPipelineFolder } from '@/infrastructure/http/api/pipelines';
import { Badge, Button, KebabMenu } from '../aurora';
import { selectedRowStyle, selectedRowLabel } from '../aurora/selection';
import { ApprovalInbox } from './ApprovalInbox';
import { relativeFromNow } from './CronBuilder';
import type { PipelineSpace } from './index';

const SCOPE_ORDER: PipelineScope[] = ['user', 'org'];

/** AgentTree's toolbar icon box, verbatim, so the two rails read identically. */
const TOOLBAR_ICON_CLASS =
  'inline-flex items-center justify-center h-6 w-6 rounded text-[color:var(--text-3)] hover:text-[color:var(--text-2)] hover:bg-[color:var(--bg-hover)] transition-colors';

export function PipelineRail({
  space,
  onSpaceChange,
  railWidth,
}: {
  space: PipelineSpace;
  onSpaceChange: (space: PipelineSpace) => void;
  railWidth: number;
}) {
  const { t } = useTranslation('pipelines');
  const pipelines = useStore((s) => s.pipelines);
  const invalid = useStore((s) => s.pipelinesInvalid);
  const orphans = useStore((s) => s.pipelineOrphanActivations);
  const loading = useStore((s) => s.pipelinesLoading);
  const selectedId = useStore((s) => s.selectedPipelineId);
  const draftIsNew = useStore((s) => s.pipelineDraftIsNew);
  const draft = useStore((s) => s.pipelineDraft);
  const saved = useStore((s) => s.pipelineSavedDef);
  const selectPipeline = useStore((s) => s.selectPipeline);
  const newPipelineDraft = useStore((s) => s.newPipelineDraft);
  const deactivatePipelineById = useStore((s) => s.deactivatePipelineById);
  const isTeamActive = useStore(selectIsTeamActive);
  const { showConfirm, showError } = useAlertModalContext();

  // Collapse state is per-scope and unpersisted (AgentTree doctrine).
  const [collapsed, setCollapsed] = useState<Set<PipelineScope>>(new Set());
  const toggleScope = (scope: PipelineScope) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });

  const codespace = space === 'codespace';
  const compact = railWidth < 250;

  /** Folder export — a read, so it needs no dirty guard and no write authority. */
  const download = async (pipelineId: string) => {
    try {
      await downloadPipelineFolder(pipelineId);
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    }
  };

  const withDirtyGuard = (action: () => void) => {
    if (!pipelineDraftIsDirty(draft, saved)) {
      action();
      return;
    }
    showConfirm(t('rail.discardConfirm', 'Discard unsaved changes?'), { onConfirm: action });
  };

  const groups = SCOPE_ORDER.map((scope) => ({
    scope,
    entries: pipelines.filter((p: PipelineListEntry) => p.scope === scope),
    invalid: invalid.filter((i) => i.scope === scope),
  }));

  return (
    <div className="h-full flex flex-col min-h-0" style={{ background: 'var(--bg-surface)' }}>
      <div className="flex-1 overflow-y-auto min-h-0">
        {codespace ? (
          <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '24px 14px', textAlign: 'center', lineHeight: 1.7, whiteSpace: 'pre-line' }}>
            {t('space.codespaceRail', 'Pipelines are Workspace-only for now.')}
          </div>
        ) : (
          <div className="p-3 flex flex-col gap-3">
            {/* Icon-only toolbar — labels survive as the accessible names. */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                title={t('rail.new', 'New pipeline')}
                aria-label={t('rail.new', 'New pipeline')}
                className={TOOLBAR_ICON_CLASS}
                onClick={() => withDirtyGuard(() => newPipelineDraft())}
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            <ApprovalInbox />
            {draftIsNew && (
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 'var(--r-md)',
                  border: '1px dashed var(--violet-500)',
                  fontSize: 12,
                  color: 'var(--violet-500)',
                  fontWeight: 600,
                }}
              >
                {t('rail.newDraft', 'New pipeline (unsaved)')}
              </div>
            )}
            {/* Both scope headers stay rendered even at zero rows — an absent
                group is indistinguishable from a group that does not exist. */}
            {groups.map(({ scope, entries, invalid: invalidRows }) => {
              const isCollapsed = collapsed.has(scope);
              const count = entries.length + invalidRows.length;
              return (
                <div key={scope} className="flex flex-col gap-0.5">
                  <div
                    className="text-[10px] font-semibold uppercase tracking-wide flex items-center gap-1.5 px-1 cursor-pointer select-none"
                    style={{ color: 'var(--text-4)' }}
                    onClick={() => toggleScope(scope)}
                  >
                    {scope === 'user' ? <User size={11} /> : <Building2 size={11} />}
                    <span className="flex-1 truncate">
                      {scope === 'user' ? t('rail.scope.user', 'My pipelines') : t('rail.scope.org', 'Organization pipelines')}
                    </span>
                    {isCollapsed && count > 0 && <span>{count}</span>}
                    <button
                      type="button"
                      className="p-0.5 shrink-0 text-[color:var(--text-4)] hover:text-[color:var(--text-2)]"
                      aria-label={isCollapsed ? t('rail.expand', 'Expand') : t('rail.collapse', 'Collapse')}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleScope(scope);
                      }}
                    >
                      {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                  </div>
                  {!isCollapsed && (
                    <>
                      {entries.map((p) => (
                        <RailRow
                          key={p.id}
                          entry={p}
                          active={selectedId === p.id}
                          onSelect={() => withDirtyGuard(() => void selectPipeline(p.id))}
                          onDownload={() => void download(p.id)}
                        />
                      ))}
                      {invalidRows.map((entry) => (
                        <div
                          key={entry.id}
                          title={entry.error}
                          className="flex items-center gap-1.5 py-1.5 pl-2 pr-1 rounded text-xs"
                          style={{ color: 'var(--red-500)' }}
                        >
                          <AlertTriangle size={13} className="shrink-0" />
                          <span className="truncate flex-1">{entry.id}</span>
                        </div>
                      ))}
                      {!loading && entries.length === 0 && invalidRows.length === 0 && (
                        <div className="py-1 pl-2 pr-1" style={{ fontSize: 10.5, lineHeight: 1.45, color: 'var(--text-4)' }}>
                          {scope === 'user'
                            ? t('rail.scope.emptyUser', 'No pipelines of your own yet.')
                            : isTeamActive
                              ? t('rail.scope.emptyOrg', 'Nothing shared with the organization yet.')
                              : t('rail.scope.emptyOrgNoTeam', 'Join a team organization to share pipelines.')}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
            {orphans.map((o) => (
              <OrphanRow key={`${o.pipelineId}:${o.projectId}`} view={o} onDeactivate={() => void deactivatePipelineById(o.pipelineId, o.projectId)} />
            ))}
          </div>
        )}
      </div>
      <div style={{ padding: 10, borderTop: '1px solid var(--border-1)' }}>
        {/* Space toggle — Workspace is the only supported space for now. */}
        <div style={{ display: 'flex', gap: 4, borderRadius: 'var(--r-md)', border: '1px solid var(--border-1)', padding: 3 }}>
          {(
            [
              { id: 'workspace' as const, icon: Boxes, label: t('space.workspace', 'Workspace') },
              { id: 'codespace' as const, icon: Code2, label: t('space.codespace', 'Codespace') },
            ]
          ).map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              title={label}
              aria-pressed={space === id}
              onClick={() => onSpaceChange(id)}
              style={{
                flex: 1,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '5px 6px',
                borderRadius: 'var(--r-sm)',
                border: 'none',
                cursor: 'pointer',
                fontSize: 11.5,
                fontWeight: 600,
                background: space === id ? 'color-mix(in srgb, var(--violet-500) 12%, transparent)' : 'transparent',
                color: space === id ? 'var(--violet-400)' : 'var(--text-3)',
              }}
            >
              <Icon size={13} />
              {!compact && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function RailRow({
  entry,
  active,
  onSelect,
  onDownload,
}: {
  entry: PipelineListEntry;
  active: boolean;
  onSelect: () => void;
  onDownload: () => void;
}) {
  const { t } = useTranslation('pipelines');
  const awaiting = entry.pendingApprovalCount > 0;
  const running = entry.activations.some((a) => a.state === 'running' || a.state === 'awaiting_human');
  const nextFire = entry.nextFireAt ? relativeFromNow(entry.nextFireAt, t as any) : null;
  return (
    <div
      onClick={onSelect}
      title={nextFire ? `${entry.name} · ${nextFire}` : entry.name}
      className="group flex items-center gap-1.5 py-1.5 pl-2 pr-1 rounded text-xs cursor-pointer hover:bg-[color:var(--bg-hover)]"
      style={{ ...selectedRowStyle('violet', active), ...selectedRowLabel(active, 'var(--text-2)') }}
    >
      {entry.enabled ? (
        <CircleCheck size={13} className="shrink-0" style={{ color: 'var(--emerald-500)' }} aria-label={t('rail.enabled', 'Enabled')} />
      ) : (
        <CircleSlash size={13} className="shrink-0" style={{ color: 'var(--red-500)' }} aria-label={t('rail.draft', 'Disabled')} />
      )}
      <span className="truncate flex-1">{entry.name}</span>
      {awaiting && (
        <Badge tone="warning" size="sm" title={t('rail.awaiting', '{{n}} waiting', { n: entry.pendingApprovalCount })}>
          {entry.pendingApprovalCount}
        </Badge>
      )}
      {running && (
        <span
          className="shrink-0 rounded-full"
          style={{
            width: 7,
            height: 7,
            background: 'var(--violet-500)',
            animation: 'pulse-soft 1.4s ease-in-out infinite',
          }}
          title={t('rail.running', 'Running')}
        />
      )}
      {entry.activations.length > 0 && (
        <Badge
          tone="brand"
          size="sm"
          title={entry.activations.map((a) => `${a.projectId} (${a.activatedBy})`).join('\n')}
        >
          {entry.activations.length}
        </Badge>
      )}
      {entry.readonly && (
        <Lock size={11} className="shrink-0" style={{ color: 'var(--text-4)' }} aria-label={t('rail.readonly', 'readonly')} />
      )}
      <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
        <KebabMenu
          ariaLabel={t('rail.menu.pipelineActions', 'Pipeline actions')}
          items={[
            {
              icon: FolderDown,
              label: t('rail.menu.downloadFolder', 'Download folder'),
              onClick: onDownload,
            },
          ]}
        />
      </span>
    </div>
  );
}

/** An own activation whose pinned definition no longer resolves — deactivate is the only action. */
function OrphanRow({ view, onDeactivate }: { view: PipelineActivationView; onDeactivate: () => void }) {
  const { t } = useTranslation('pipelines');
  return (
    <div
      title={t('rail.orphanHint', 'This activation references a pipeline that no longer exists.')}
      className="flex items-center gap-1.5 py-1.5 pl-2 pr-1 rounded"
      style={{ border: '1px dashed var(--red-500)', fontSize: 11.5, color: 'var(--text-2)' }}
    >
      <Unlink size={12} className="shrink-0" style={{ color: 'var(--red-500)' }} />
      <span className="truncate flex-1 min-w-0">
        {view.pipelineId} · {view.projectId}
      </span>
      <Button variant="ghost" size="xs" onClick={onDeactivate}>
        {t('execution.deactivate', 'Deactivate')}
      </Button>
    </div>
  );
}
