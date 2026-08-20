/**
 * PipelineExecutionView — where a pipeline meets projects. ACTIVATION-centric:
 * one row per activation (own rows are actionable — run-now / deactivate /
 * expandable run history; org members' rows are read-only with the activator
 * shown), an "activate on project…" picker (enabled pipelines only; the
 * picker disables projects already bound to a pipeline), and the live-run
 * read-only canvas monitor at the bottom.
 *
 * An activation OWNS its project: while active, interactive job starts in
 * that project are rejected. `broken` rows reference a definition that no
 * longer resolves — deactivate is their only action.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Play, Power, PowerOff, User } from 'lucide-react';
import type { PipelineActivationView, PipelineDef, PipelineListEntry } from '@ant/shared';
import { useStore } from '@/domain/store';
import { Button } from '../aurora';
import { StatusPill } from '../ConfigEditor/aurora';
import { PipelineCanvas } from './canvas/PipelineCanvas';
import { ActivationRunHistory } from './ActivationRunHistory';

export interface PipelineExecutionViewProps {
  def: PipelineDef;
  draftIsNew: boolean;
  pipelineId: string | null;
  entry: PipelineListEntry | null;
}

export function PipelineExecutionView({ def, draftIsNew, pipelineId, entry }: PipelineExecutionViewProps) {
  const { t } = useTranslation('pipelines');
  const activatableProjects = useStore((s) => s.pipelineActivatableProjects);
  const executionProjectId = useStore((s) => s.pipelineExecutionProjectId);
  const activationError = useStore((s) => s.pipelineActivationError);
  const runDetail = useStore((s) => s.pipelineRunDetail);
  const loadActivatableProjects = useStore((s) => s.loadActivatableProjects);
  const setPipelineExecutionProject = useStore((s) => s.setPipelineExecutionProject);
  const activatePipelineTo = useStore((s) => s.activatePipelineTo);
  const deactivatePipelineById = useStore((s) => s.deactivatePipelineById);
  const runPipelineNowById = useStore((s) => s.runPipelineNowById);

  const [busy, setBusy] = useState(false);
  const [runNowNote, setRunNowNote] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    void loadActivatableProjects();
  }, [loadActivatableProjects]);

  const activations = entry?.activations ?? [];
  const enabled = entry?.enabled ?? false;
  const cronSummary = `${def.on.schedule.cron}${def.on.schedule.tz ? ` · ${def.on.schedule.tz}` : ''}`;

  const pickerRows = useMemo(() => {
    // Projects already holding an activation (any pipeline) are not offered.
    const taken = new Set(activations.filter((a) => a.mine).map((a) => a.projectId));
    return activatableProjects.filter((p) => !taken.has(p.id));
  }, [activatableProjects, activations]);

  if (draftIsNew || !pipelineId) {
    return (
      <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 13, textAlign: 'center', lineHeight: 1.7 }}>
        {t('execution.saveFirst', 'Save the pipeline first — activation binds a saved pipeline to a project.')}
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: '0 1 auto', overflowY: 'auto', borderBottom: '1px solid var(--border-1)', background: 'var(--bg-surface)', padding: 14, display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '60%' }}>
        {/* Activate on a new project */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-1)' }}>
            {t('execution.activationsTitle', 'Activations')}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {t('execution.activationsCount', '{{n}} project(s)', { n: activations.length })}
          </span>
          <div style={{ flex: 1 }} />
          <select
            value={executionProjectId ?? ''}
            onChange={(e) => setPipelineExecutionProject(e.target.value || null)}
            disabled={!enabled}
            style={{
              fontSize: 12,
              padding: '5px 8px',
              borderRadius: 'var(--r-sm)',
              border: '1px solid var(--border-2)',
              background: 'var(--bg-surface-2)',
              color: 'var(--text-1)',
              minWidth: 180,
            }}
          >
            <option value="">{t('execution.pickProject', 'Choose a workspace project…')}</option>
            {pickerRows.map((p) => (
              <option key={p.id} value={p.id} disabled={!!p.activePipelineId}>
                {p.name}
                {p.activePipelineId ? ` — ${t('execution.alreadyBound', 'bound to "{{pipelineId}}"', { pipelineId: p.activePipelineId })}` : ''}
              </option>
            ))}
          </select>
          <Button
            variant="primary"
            size="sm"
            disabled={busy || !enabled || !executionProjectId}
            onClick={async () => {
              if (!executionProjectId) return;
              setBusy(true);
              try {
                const ok = await activatePipelineTo(pipelineId, executionProjectId);
                if (ok) setPipelineExecutionProject(null);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Power size={13} /> {t('execution.activate', 'Activate')}
          </Button>
        </div>
        {!enabled && (
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
            {t('execution.enableFirst', 'This pipeline is disabled — enable it in the Wiring view to activate projects.')}
          </div>
        )}

        {/* Activation rows */}
        {activations.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '8px 2px' }}>
            {t('execution.noActivations', 'Not activated anywhere yet.')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {activations.map((a) => (
              <ActivationRow
                key={`${a.activatedBy}:${a.projectId}`}
                view={a}
                expanded={expanded === `${a.activatedBy}:${a.projectId}`}
                onToggle={() =>
                  setExpanded(expanded === `${a.activatedBy}:${a.projectId}` ? null : `${a.activatedBy}:${a.projectId}`)
                }
                busy={busy}
                onRunNow={async () => {
                  const err = await runPipelineNowById(pipelineId, a.projectId);
                  setRunNowNote(err ?? t('editor.runNowAccepted', 'Fired — watch the run history.'));
                  setTimeout(() => setRunNowNote(null), 4000);
                }}
                onDeactivate={async () => {
                  setBusy(true);
                  try {
                    await deactivatePipelineById(pipelineId, a.projectId);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            ))}
          </div>
        )}

        {(activationError || runNowNote) && (
          <div style={{ fontSize: 12, color: activationError ? 'var(--red-500)' : 'var(--text-2)' }}>
            {activationError ?? runNowNote}
          </div>
        )}
      </div>

      {/* Live monitor — read-only canvas with the run-status overlay. */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <PipelineCanvas
          def={def}
          cronSummary={cronSummary}
          run={runDetail && runDetail.pipelineId === pipelineId ? runDetail : null}
          selectedNodeId={null}
          onSelectNode={() => {}}
        />
      </div>
    </div>
  );
}

function ActivationRow({
  view,
  expanded,
  onToggle,
  busy,
  onRunNow,
  onDeactivate,
}: {
  view: PipelineActivationView;
  expanded: boolean;
  onToggle: () => void;
  busy: boolean;
  onRunNow: () => void;
  onDeactivate: () => void;
}) {
  const { t } = useTranslation('pipelines');
  const stateProps =
    view.state === 'broken'
      ? { state: 'error' as const, label: t('execution.stateBroken', 'Broken') }
      : view.state === 'running'
        ? { state: 'checking' as const, label: t('execution.stateRunning', 'Working') }
        : view.state === 'awaiting_human'
          ? { state: 'warning' as const, label: t('execution.stateAwaiting', 'Awaiting approval') }
          : { state: 'connected' as const, label: t('execution.stateWaiting', 'Waiting') };
  const live = view.state === 'running' || view.state === 'awaiting_human';
  return (
    <div style={{ border: '1px solid var(--border-1)', borderRadius: 'var(--r-md)', background: 'var(--bg-surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={onToggle}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-1)', fontSize: 12.5, fontWeight: 600, minWidth: 0 }}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{view.projectId}</span>
        </button>
        <StatusPill state={stateProps.state} label={stateProps.label} />
        {!view.mine && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: 'var(--text-3)' }} title={view.activatedBy}>
            <User size={10} />
            <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{view.activatedBy}</span>
          </span>
        )}
        {view.nextFireAt && !live && (
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {t('execution.nextFire', 'Next fire: {{when}}', { when: new Date(view.nextFireAt).toLocaleString() })}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {view.mine && view.state !== 'broken' && (
          <Button variant="ghost" size="xs" disabled={busy || live} onClick={onRunNow}>
            <Play size={12} /> {t('editor.runNow', 'Run now')}
          </Button>
        )}
        {view.mine && (
          <Button variant="secondary" size="xs" disabled={busy} onClick={onDeactivate}>
            <PowerOff size={12} /> {t('execution.deactivate', 'Deactivate')}
          </Button>
        )}
      </div>
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border-1)', padding: '4px 10px' }}>
          <ActivationRunHistory
            pipelineId={view.pipelineId}
            projectId={view.projectId}
            userId={view.mine ? undefined : view.activatedBy}
            mine={view.mine}
          />
        </div>
      )}
    </div>
  );
}
