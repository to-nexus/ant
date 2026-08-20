/**
 * PipelineRail — the left list rail on the AgentTree model: approval inbox
 * pinned on top, then the pipelines grouped by SCOPE (My / Organization —
 * both headers always render so an empty group is distinguishable from a
 * nonexistent one), invalid rows, orphan-activation rows, "+ New pipeline",
 * and the SPACE toggle (Workspace / Codespace) pinned in the footer —
 * icon-only when the rail is narrow. Activation is controlled ONLY in the
 * Execution view — the rail just reports it.
 */

import { useTranslation } from 'react-i18next';
import { Plus, AlertTriangle, User, Building2, Boxes, Code2, Unlink } from 'lucide-react';
import type { PipelineActivationView, PipelineListEntry, PipelineScope } from '@ant/shared';
import { useStore } from '@/domain/store';
import { pipelineDraftIsDirty } from '@/domain/store/slices/pipelineSlice';
import { selectIsTeamActive } from '@/domain/store/selectors/auth';
import { Button } from '../aurora';
import { StatusPill } from '../ConfigEditor/aurora';
import { ApprovalInbox } from './ApprovalInbox';
import { relativeFromNow } from './CronBuilder';
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

  const codespace = space === 'codespace';
  const compact = railWidth < 250;

  const guardDirty = (): boolean => {
    if (!pipelineDraftIsDirty(draft, saved)) return true;
    return window.confirm(t('rail.discardConfirm', 'Discard unsaved changes?'));
  };

  const groups = SCOPE_ORDER.map((scope) => ({
    scope,
    entries: pipelines.filter((p: PipelineListEntry) => p.scope === scope),
    invalid: invalid.filter((i) => i.scope === scope),
  }));

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg-surface)' }}>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {codespace ? (
          <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '24px 14px', textAlign: 'center', lineHeight: 1.7, whiteSpace: 'pre-line' }}>
            {t('space.codespaceRail', 'Pipelines are Workspace-only for now.')}
          </div>
        ) : (
          <>
            <ApprovalInbox />
            <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {draftIsNew && (
                <div
                  style={{
                    padding: '10px 12px',
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
              {groups.map(({ scope, entries, invalid: invalidRows }) => (
                <div key={scope} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 2px 2px', fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--text-3)' }}>
                    {scope === 'user' ? <User size={11} /> : <Building2 size={11} />}
                    <span>{scope === 'user' ? t('rail.scope.user', 'My pipelines') : t('rail.scope.org', 'Organization pipelines')}</span>
                  </div>
                  {entries.map((p) => (
                    <RailRow
                      key={p.id}
                      entry={p}
                      active={selectedId === p.id}
                      onSelect={() => {
                        if (!guardDirty()) return;
                        void selectPipeline(p.id);
                      }}
                    />
                  ))}
                  {invalidRows.map((entry) => (
                    <div
                      key={entry.id}
                      title={entry.error}
                      style={{
                        padding: '9px 12px',
                        borderRadius: 'var(--r-md)',
                        border: '1px solid var(--red-500)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 7,
                        fontSize: 12,
                        color: 'var(--red-500)',
                      }}
                    >
                      <AlertTriangle size={13} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.id}</span>
                    </div>
                  ))}
                  {!loading && entries.length === 0 && invalidRows.length === 0 && (
                    <div style={{ fontSize: 11.5, color: 'var(--text-3)', padding: '4px 6px 8px', lineHeight: 1.6 }}>
                      {scope === 'user'
                        ? t('rail.scope.emptyUser', 'No pipelines of your own yet.')
                        : isTeamActive
                          ? t('rail.scope.emptyOrg', 'Nothing shared with the organization yet.')
                          : t('rail.scope.emptyOrgNoTeam', 'Join a team organization to share pipelines.')}
                    </div>
                  )}
                </div>
              ))}
              {orphans.map((o) => (
                <OrphanRow key={`${o.pipelineId}:${o.projectId}`} view={o} onDeactivate={() => void deactivatePipelineById(o.pipelineId, o.projectId)} />
              ))}
            </div>
          </>
        )}
      </div>
      <div style={{ padding: 10, borderTop: '1px solid var(--border-1)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {!codespace && (
          <Button
            variant="secondary"
            size="sm"
            fullWidth
            onClick={() => {
              if (!guardDirty()) return;
              newPipelineDraft();
            }}
          >
            <Plus size={13} /> {t('rail.new', 'New pipeline')}
          </Button>
        )}
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
}: {
  entry: PipelineListEntry;
  active: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation('pipelines');
  const awaiting = entry.pendingApprovalCount > 0;
  const mine = entry.activations.filter((a) => a.mine);
  const running = entry.activations.some((a) => a.state === 'running' || a.state === 'awaiting_human');
  return (
    <div
      onClick={onSelect}
      style={{
        padding: '9px 10px',
        borderRadius: 'var(--r-md)',
        border: `1px solid ${active ? 'var(--violet-500)' : 'var(--border-1)'}`,
        background: active ? 'color-mix(in srgb, var(--violet-500) 7%, transparent)' : 'var(--bg-surface)',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entry.name}
        </span>
        {entry.activations.length > 0 && (
          <span
            title={entry.activations.map((a) => `${a.projectId} (${a.activatedBy})`).join('\n')}
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '1px 7px',
              borderRadius: 8,
              background: 'color-mix(in srgb, var(--violet-500) 12%, transparent)',
              color: 'var(--violet-400)',
              whiteSpace: 'nowrap',
            }}
          >
            {t('rail.activations', '{{n}} active', { n: entry.activations.length })}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
        {awaiting ? (
          <StatusPill state="warning" label={t('rail.awaiting', '{{n}} waiting', { n: entry.pendingApprovalCount })} />
        ) : running ? (
          <StatusPill state="checking" label={t('rail.running', 'Running')} />
        ) : entry.enabled ? (
          <StatusPill state="connected" label={t('rail.enabled', 'Enabled')} />
        ) : (
          <StatusPill state="not-configured" label={t('rail.draft', 'Draft')} />
        )}
        {entry.readonly && <StatusPill state="not-configured" label={t('rail.readonly', 'readonly')} />}
        {mine.length > 0 && entry.nextFireAt && (
          <span style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
            {relativeFromNow(entry.nextFireAt, t as any)}
          </span>
        )}
        <span style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
          {t('rail.steps', '{{n}} steps', { n: entry.stepCount })}
        </span>
      </div>
    </div>
  );
}

/** An own activation whose pinned definition no longer resolves — deactivate is the only action. */
function OrphanRow({ view, onDeactivate }: { view: PipelineActivationView; onDeactivate: () => void }) {
  const { t } = useTranslation('pipelines');
  return (
    <div
      title={t('rail.orphanHint', 'This activation references a pipeline that no longer exists.')}
      style={{
        padding: '9px 10px',
        borderRadius: 'var(--r-md)',
        border: '1px dashed var(--red-500)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 11.5,
        color: 'var(--text-2)',
      }}
    >
      <Unlink size={12} style={{ color: 'var(--red-500)', flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {view.pipelineId} · {view.projectId}
      </span>
      <Button variant="ghost" size="xs" onClick={onDeactivate}>
        {t('execution.deactivate', 'Deactivate')}
      </Button>
    </div>
  );
}
