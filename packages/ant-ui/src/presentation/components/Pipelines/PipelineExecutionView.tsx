/**
 * PipelineExecutionView — where a pipeline meets a project. Pick a universal
 * project, Activate/Deactivate (1:1 both ways — the picker disables projects
 * already bound to another pipeline), run-now, and watch the live run on a
 * read-only canvas (the status overlay doubles as the monitor).
 *
 * Activation OWNS the project: while active, interactive job starts in that
 * project are rejected and the definition is edit-locked. States: inactive /
 * active·waiting (nextFireAt) / active·running (current step).
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Power, PowerOff } from 'lucide-react';
import type { PipelineDef, PipelineListEntry } from '@ant/shared';
import { useStore } from '@/domain/store';
import { Button } from '../aurora';
import { PipelineCanvas } from './canvas/PipelineCanvas';

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

  useEffect(() => {
    void loadActivatableProjects();
  }, [loadActivatableProjects]);

  const activation = entry?.activation ?? null;
  const liveRun = runDetail && runDetail.pipelineId === (pipelineId ?? '') && (runDetail.status === 'running' || runDetail.status === 'awaiting_human')
    ? runDetail
    : null;
  const currentStep = liveRun?.steps.find((s) => s.status === 'running' || s.status === 'awaiting_gate');
  const pickedProject = executionProjectId ?? activation?.projectId ?? null;

  const cronSummary = `${def.on.schedule.cron}${def.on.schedule.tz ? ` · ${def.on.schedule.tz}` : ''}`;

  const stateLabel = !activation
    ? t('execution.stateInactive', 'Inactive')
    : liveRun
      ? t('execution.stateRunning', 'Active · working')
      : t('execution.stateWaiting', 'Active · waiting');
  const stateColor = !activation ? 'var(--text-3)' : liveRun ? 'var(--green-500, #22c55e)' : 'var(--violet-400)';

  const pickerRows = useMemo(() => {
    const rows = [...activatableProjects];
    // The bound project always appears, even if the picker fetch is stale.
    if (activation && !rows.some((r) => r.id === activation.projectId)) {
      rows.unshift({ id: activation.projectId, name: activation.projectId, activePipelineId: pipelineId });
    }
    return rows;
  }, [activatableProjects, activation, pipelineId]);

  if (draftIsNew || !pipelineId) {
    return (
      <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 13, textAlign: 'center', lineHeight: 1.7 }}>
        {t('execution.saveFirst', 'Save the pipeline first — activation binds a saved pipeline to a project.')}
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Activation controls */}
      <div style={{ padding: '14px', borderBottom: '1px solid var(--border-1)', background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              fontWeight: 700,
              color: stateColor,
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 4, background: stateColor }} />
            {stateLabel}
          </span>
          {activation && !liveRun && entry?.nextFireAt && (
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
              {t('execution.nextFire', 'Next fire: {{when}}', { when: new Date(entry.nextFireAt).toLocaleString() })}
            </span>
          )}
          {liveRun && currentStep && (
            <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
              {t('execution.currentStep', 'Current step: {{step}}', { step: currentStep.stepId })}
            </span>
          )}
          <div style={{ flex: 1 }} />
          {activation && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || !!liveRun}
              onClick={async () => {
                const err = await runPipelineNowById(pipelineId);
                setRunNowNote(err ?? t('editor.runNowAccepted', 'Fired — watch Runs.'));
                setTimeout(() => setRunNowNote(null), 4000);
              }}
            >
              <Play size={13} /> {t('editor.runNow', 'Run now')}
            </Button>
          )}
          {activation ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await deactivatePipelineById(pipelineId);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <PowerOff size={13} /> {t('execution.deactivate', 'Deactivate')}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              disabled={busy || !pickedProject}
              onClick={async () => {
                if (!pickedProject) return;
                setBusy(true);
                try {
                  await activatePipelineTo(pipelineId, pickedProject);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Power size={13} /> {t('execution.activate', 'Activate')}
            </Button>
          )}
        </div>

        {/* Project picker — activation targets exactly one universal project. */}
        {!activation && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{t('execution.project', 'Project')}</span>
            <select
              value={pickedProject ?? ''}
              onChange={(e) => setPipelineExecutionProject(e.target.value || null)}
              style={{
                fontSize: 12,
                padding: '5px 8px',
                borderRadius: 'var(--r-sm)',
                border: '1px solid var(--border-2)',
                background: 'var(--bg-surface-2)',
                color: 'var(--text-1)',
                minWidth: 200,
              }}
            >
              <option value="">{t('execution.pickProject', 'Choose a workspace project…')}</option>
              {pickerRows.map((p) => (
                <option key={p.id} value={p.id} disabled={!!p.activePipelineId && p.activePipelineId !== pipelineId}>
                  {p.name}
                  {p.activePipelineId && p.activePipelineId !== pipelineId
                    ? ` — ${t('execution.alreadyBound', 'bound to "{{pipelineId}}"', { pipelineId: p.activePipelineId })}`
                    : ''}
                </option>
              ))}
            </select>
            {pickerRows.length === 0 && (
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                {t('execution.noProjects', 'No workspace (universal) projects found.')}
              </span>
            )}
          </div>
        )}

        {activation && (
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
            {t('execution.boundTo', 'Bound to project "{{projectId}}" — interactive work there is locked while active.', {
              projectId: activation.projectId,
            })}
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
