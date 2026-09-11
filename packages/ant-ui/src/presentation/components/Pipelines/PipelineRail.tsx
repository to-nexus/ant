/**
 * PipelineRail — the left rail on the shared rail primitives (AgentTree's
 * grammar): an icon-only toolbar (+ New pipeline), the approval inbox as a
 * collapsible group, then the pipelines grouped by SCOPE (My / Organization —
 * both headers always render so an empty group is distinguishable from a
 * nonexistent one), invalid rows, orphan-activation rows, and the SPACE switch
 * (Workspace / Codespace) pinned in the footer. Availability is an icon tint,
 * not a control: enable/disable lives in the settings panel, activation in the
 * Execution view. A NEW draft is a phantom active row in the My group — the
 * rail grammar has no "nothing selected" state.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Building2, Boxes, Code2, FileUp, FolderDown, FolderUp, Plus, Unlink, Upload, User, Waypoints } from 'lucide-react';
import type { PipelineActivationView, PipelineListEntry, PipelineScope } from '@ant/shared';
import { useStore } from '@/domain/store';
import { selectIsTeamActive } from '@/domain/store/selectors/auth';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { downloadPipelineFolder } from '@/infrastructure/http/api/pipelines';
import { useFilePicker } from '@/application/hooks/ui/useFilePicker';
import { extractDroppedFiles } from '@/application/hooks/ui/useDropZone';
import { fileListToEntries } from '@/shared/utils/upload-utils';
import { UploadConflictModal } from '@/presentation/components/common/UploadConflictModal';
import { UploadStatusCard } from '@/presentation/components/common/UploadStatusCard';
import { Badge, Button, KebabMenu } from '../aurora';
import { StatusPill } from '../ConfigEditor/aurora';
import { RailGroup, RailIconSwitch, RailRow, RailToolbarButton, toggleSetMember } from '../shared/rail';
import { ApprovalInbox } from './ApprovalInbox';
import { relativeFromNow } from './CronBuilder';
import { usePipelineDiscardGuard } from './usePipelineDiscardGuard';
import { usePipelineImport } from './usePipelineImport';
import type { PipelineSpace } from './index';

const SCOPE_ORDER: PipelineScope[] = ['user', 'org'];

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
  const { t: tc } = useTranslation('common');
  const pipelines = useStore((s) => s.pipelines);
  const invalid = useStore((s) => s.pipelinesInvalid);
  const orphans = useStore((s) => s.pipelineOrphanActivations);
  const loading = useStore((s) => s.pipelinesStatus === 'loading');
  const selectedId = useStore((s) => s.selectedPipelineId);
  const draftIsNew = useStore((s) => s.pipelineDraftIsNew);
  const draft = useStore((s) => s.pipelineDraft);
  const selectPipeline = useStore((s) => s.selectPipeline);
  const newPipelineDraft = useStore((s) => s.newPipelineDraft);
  const deactivatePipelineById = useStore((s) => s.deactivatePipelineById);
  const isTeamActive = useStore(selectIsTeamActive);
  const { showError } = useAlertModalContext();
  const guard = usePipelineDiscardGuard();

  // Collapse state is per-scope and unpersisted (AgentTree doctrine).
  const [collapsed, setCollapsed] = useState<Set<PipelineScope>>(new Set());

  const [filePicker, openFilePicker] = useFilePicker();
  const { upload, submitEntries, pendingOverwrite, resolveOverwrite } = usePipelineImport();
  /** `undefined` = not dragging · `null` = the rail itself · id = that row. */
  const [dropTarget, setDropTarget] = useState<string | null | undefined>(undefined);

  const startImport = (entries: ReturnType<typeof fileListToEntries>, targetId?: string) =>
    guard(() => void submitEntries(entries, targetId));

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

  const groups = SCOPE_ORDER.map((scope) => ({
    scope,
    entries: pipelines.filter((p: PipelineListEntry) => p.scope === scope),
    invalid: invalid.filter((i) => i.scope === scope),
  }));

  const spaceOptions = [
    { id: 'workspace' as const, icon: Boxes, label: t('space.workspace', 'Workspace') },
    { id: 'codespace' as const, icon: Code2, label: t('space.codespace', 'Codespace') },
  ] as const;

  return (
    <div className="h-full flex flex-col min-h-0" style={{ background: 'var(--bg-surface)' }}>
      <div className="flex-1 overflow-y-auto min-h-0">
        {codespace ? (
          <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '24px 14px', textAlign: 'center', lineHeight: 1.7, whiteSpace: 'pre-line' }}>
            {t('space.codespaceRail', 'Pipelines are Workspace-only for now.')}
          </div>
        ) : (
          <div
            className="p-3 flex flex-col gap-3"
            style={
              dropTarget === null
                ? { outline: '2px dashed var(--violet-400)', outlineOffset: -4, borderRadius: 8 }
                : undefined
            }
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
              const row = (e.target as HTMLElement).closest('[data-drop-pipeline]');
              setDropTarget(row?.getAttribute('data-drop-pipeline') ?? null);
            }}
            onDragLeave={(e) => {
              // Only when the pointer actually left the rail — child boundaries
              // fire dragleave constantly and would strobe the highlight.
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              if (
                e.clientX <= rect.left ||
                e.clientX >= rect.right ||
                e.clientY <= rect.top ||
                e.clientY >= rect.bottom
              ) {
                setDropTarget(undefined);
              }
            }}
            onDrop={async (e) => {
              e.preventDefault();
              const row = (e.target as HTMLElement).closest('[data-drop-pipeline]');
              setDropTarget(undefined);
              if (row?.hasAttribute('data-drop-readonly')) {
                upload.showNotice(t('import.readonlyTarget', 'That pipeline is read-only — drop on the rail to import a copy.'));
                return;
              }
              const entries = await extractDroppedFiles(e.dataTransfer);
              if (entries.length === 0) return;
              startImport(entries, row?.getAttribute('data-drop-pipeline') ?? undefined);
            }}
          >
            <div className="flex items-center gap-1">
              {filePicker}
              <RailToolbarButton icon={Plus} label={t('rail.new', 'New pipeline')} onClick={() => guard(() => newPipelineDraft())} />
              <KebabMenu
                icon={Upload}
                variant="toolbar"
                ariaLabel={t('rail.upload', 'Upload pipeline definition')}
                items={[
                  {
                    icon: FileUp,
                    label: t('rail.menu.uploadFile', 'Upload pipeline.yaml…'),
                    onClick: () =>
                      openFilePicker((files) => startImport(fileListToEntries(files)), { accept: '.yaml,.yml' }),
                  },
                  {
                    icon: FolderUp,
                    label: t('rail.menu.uploadFolder', 'Upload pipeline folder…'),
                    onClick: () =>
                      openFilePicker((files) => startImport(fileListToEntries(files)), { directory: true }),
                  },
                ]}
              />
            </div>
            <ApprovalInbox />
            {groups.map(({ scope, entries, invalid: invalidRows }) => {
              const isCollapsed = collapsed.has(scope);
              const phantom = scope === 'user' && draftIsNew && draft;
              return (
                <RailGroup
                  key={scope}
                  icon={scope === 'user' ? User : Building2}
                  label={scope === 'user' ? t('rail.scope.user', 'My pipelines') : t('rail.scope.org', 'Organization pipelines')}
                  pill={
                    entries.length > 0 && entries.every((e) => e.readonly) ? (
                      <StatusPill state="not-configured" label={t('rail.readonly', 'readonly')} />
                    ) : undefined
                  }
                  count={entries.length + invalidRows.length + (phantom ? 1 : 0)}
                  collapsed={isCollapsed}
                  onToggle={() => setCollapsed((prev) => toggleSetMember(prev, scope))}
                  toggleLabel={isCollapsed ? t('rail.expand', 'Expand') : t('rail.collapse', 'Collapse')}
                  emptyText={
                    loading
                      ? undefined
                      : scope === 'user'
                        ? t('rail.scope.emptyUser', 'No pipelines of your own yet.')
                        : isTeamActive
                          ? t('rail.scope.emptyOrg', 'Nothing shared with the organization yet.')
                          : t('rail.scope.emptyOrgNoTeam', 'Join a team organization to share pipelines.')
                  }
                >
                  {phantom && (
                    <RailRow
                      icon={Waypoints}
                      iconStyle={{ color: 'var(--text-4)' }}
                      label={draft.name || t('editor.namePlaceholder', 'Pipeline name')}
                      active
                      idleColor="var(--text-2)"
                      onClick={() => {}}
                      trailing={<StatusPill state="warning" label={t('rail.unsaved', 'Unsaved')} />}
                    />
                  )}
                  {entries.map((p) => (
                    <div
                      key={p.id}
                      data-drop-pipeline={p.id}
                      {...(p.readonly ? { 'data-drop-readonly': '' } : {})}
                      style={
                        dropTarget === p.id
                          ? { outline: '2px dashed var(--violet-500)', outlineOffset: -2, borderRadius: 6 }
                          : undefined
                      }
                    >
                      <PipelineRow
                        entry={p}
                        active={selectedId === p.id}
                        onSelect={() => guard(() => void selectPipeline(p.id))}
                        onDownload={() => void download(p.id)}
                      />
                    </div>
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
                </RailGroup>
              );
            })}
            {orphans.map((o) => (
              <OrphanRow key={`${o.pipelineId}:${o.projectId}`} view={o} onDeactivate={() => void deactivatePipelineById(o.pipelineId, o.projectId)} />
            ))}
          </div>
        )}
      </div>
      {/* Space switch — leaving the workspace drops the drafts, so it is guarded. */}
      <div className="flex items-center gap-2" style={{ padding: 10, borderTop: '1px solid var(--border-1)' }}>
        <RailIconSwitch<PipelineSpace>
          value={space}
          options={spaceOptions}
          switchTo={(next) => tc('rail.switchTo', 'Switch to {{next}}', { next })}
          onChange={(next) => guard(() => onSpaceChange(next))}
        />
        {!compact && (
          <span className="truncate" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-2)' }}>
            {spaceOptions.find((o) => o.id === space)?.label}
          </span>
        )}
      </div>

      <UploadStatusCard
        status={upload.status}
        notice={upload.notice}
        // One small JSON request — there are no batches to stop between, so the
        // X means dismiss rather than pretending to abort something.
        onCancel={upload.dismiss}
        onDismiss={upload.dismiss}
        onDismissNotice={upload.dismissNotice}
      />
      <UploadConflictModal
        isOpen={pendingOverwrite != null}
        conflictingFiles={pendingOverwrite ? [pendingOverwrite.id] : []}
        allowCopy={false}
        title={t('import.replaceTitle', 'Pipeline already exists')}
        message={t(
          'import.replaceMessage',
          'A pipeline with this id already exists. Overwriting REPLACES its definition; activations and run history are left untouched.',
        )}
        onClose={() => void resolveOverwrite(false)}
        onResolve={(resolution) => void resolveOverwrite(resolution !== 'cancel')}
      />
    </div>
  );
}

function PipelineRow({
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
    <RailRow
      icon={Waypoints}
      iconStyle={{ color: entry.enabled ? 'var(--emerald-500)' : 'var(--text-4)' }}
      label={entry.name}
      active={active}
      idleColor="var(--text-2)"
      title={nextFire ? `${entry.name} · ${nextFire}` : entry.name}
      onClick={onSelect}
      trailing={
        <>
          {awaiting && (
            <Badge tone="warning" size="sm" title={t('rail.awaiting', '{{n}} waiting', { n: entry.pendingApprovalCount })}>
              {entry.pendingApprovalCount}
            </Badge>
          )}
          {running && (
            <span
              className="shrink-0 rounded-full"
              style={{ width: 7, height: 7, background: 'var(--violet-500)', animation: 'pulse-soft 1.4s ease-in-out infinite' }}
              title={t('rail.running', 'Running')}
            />
          )}
          {entry.activations.length > 0 && (
            <Badge tone="brand" size="sm" title={entry.activations.map((a) => `${a.projectId} (${a.activatedBy})`).join('\n')}>
              {entry.activations.length}
            </Badge>
          )}
          {entry.readonly && <StatusPill state="not-configured" label={t('rail.readonly', 'readonly')} />}
          <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
            <KebabMenu
              ariaLabel={t('rail.menu.pipelineActions', 'Pipeline actions')}
              items={[{ icon: FolderDown, label: t('rail.menu.downloadFolder', 'Download folder'), onClick: onDownload }]}
            />
          </span>
        </>
      }
    />
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
