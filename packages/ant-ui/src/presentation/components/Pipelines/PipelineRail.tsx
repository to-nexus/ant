/**
 * PipelineRail — the left list rail (AgentTree analogue): approval inbox
 * pinned on top, then one row per pipeline (activation chip + next fire),
 * "+ New pipeline" at the bottom. Activation is controlled ONLY in the
 * Execution view — the rail just reports it.
 */

import { useTranslation } from 'react-i18next';
import { Plus, AlertTriangle } from 'lucide-react';
import type { PipelineListEntry } from '@ant/shared';
import { useStore } from '@/domain/store';
import { pipelineDraftIsDirty } from '@/domain/store/slices/pipelineSlice';
import { Button } from '../aurora';
import { StatusPill } from '../ConfigEditor/aurora';
import { ApprovalInbox } from './ApprovalInbox';
import { relativeFromNow } from './CronBuilder';

export function PipelineRail() {
  const { t } = useTranslation('pipelines');
  const pipelines = useStore((s) => s.pipelines);
  const invalid = useStore((s) => s.pipelinesInvalid);
  const loading = useStore((s) => s.pipelinesLoading);
  const selectedId = useStore((s) => s.selectedPipelineId);
  const draftIsNew = useStore((s) => s.pipelineDraftIsNew);
  const draft = useStore((s) => s.pipelineDraft);
  const saved = useStore((s) => s.pipelineSavedDef);
  const selectPipeline = useStore((s) => s.selectPipeline);
  const newPipelineDraft = useStore((s) => s.newPipelineDraft);

  const guardDirty = (): boolean => {
    if (!pipelineDraftIsDirty(draft, saved)) return true;
    return window.confirm(t('rail.discardConfirm', 'Discard unsaved changes?'));
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg-surface)' }}>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
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
          {pipelines.map((p) => (
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
          {invalid.map((entry) => (
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
          {!loading && pipelines.length === 0 && invalid.length === 0 && !draftIsNew && (
            <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '18px 6px', textAlign: 'center', lineHeight: 1.6 }}>
              {t('rail.empty', 'No pipelines yet.\nChain your agent jobs on a schedule.')}
            </div>
          )}
        </div>
      </div>
      <div style={{ padding: 10, borderTop: '1px solid var(--border-1)' }}>
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
  const liveStatus = entry.lastRun?.status;
  const activated = !!entry.activation;
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
        {activated && (
          <span
            title={entry.activation!.projectId}
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '1px 7px',
              borderRadius: 8,
              background: 'color-mix(in srgb, var(--violet-500) 12%, transparent)',
              color: 'var(--violet-400)',
              maxWidth: 110,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {entry.activation!.projectId}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
        {awaiting ? (
          <StatusPill state="warning" label={t('rail.awaiting', '{{n}} waiting', { n: entry.pendingApprovalCount })} />
        ) : liveStatus === 'running' || liveStatus === 'awaiting_human' ? (
          <StatusPill state="checking" label={t('rail.running', 'Running')} />
        ) : activated ? (
          <StatusPill state="connected" label={t('rail.active', 'Active')} />
        ) : (
          <StatusPill state="not-configured" label={t('rail.inactive', 'Inactive')} />
        )}
        {activated && entry.nextFireAt && (
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
