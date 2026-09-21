/**
 * ActivationRunHistory — one activation's fire history (firedBy, status,
 * duration, gate decisions) and the per-run step timeline (status, verdict,
 * retries, outputs, clarify Q/A, gate audit). Run detail is keyed per run and
 * the selection per activation, so two sections never fight over one slot.
 * Members' histories render read-only (no cancel, no detail — run detail is
 * own-runs-only on the server).
 */

import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Split, XCircle } from 'lucide-react';
import type { PipelineRunSummary, StepRecord } from '@ant/shared';
import type { AsyncResource } from '@/domain/async';
import { useStore } from '@/domain/store';
import { activationRunsKey } from '@/domain/store/slices/pipelineSlice';
import { StatusPill } from '../ConfigEditor/aurora';
import { Badge, Button } from '../aurora';
import { AsyncBoundary } from '../common/async/boundary/AsyncBoundary';
import { cancelPipelineRun } from '@/infrastructure/http/api/pipelines';
import { FIRED_BY_ICON, FIRED_BY_LABEL } from './runIdentity';
import { LIVE_STEP_STATUSES, STEP_STATUS_COLOR, gateDecisionLabel, isApprovedDecision } from './runStepPresentation';
import { StepRecordBody } from './StepRecordBody';

const RUN_PILL: Record<string, { state: any; labelKey: string; fallback: string }> = {
  running: { state: 'checking', labelKey: 'runs.running', fallback: 'Running' },
  awaiting_human: { state: 'warning', labelKey: 'runs.awaiting', fallback: 'Awaiting input' },
  completed: { state: 'connected', labelKey: 'runs.completed', fallback: 'Completed' },
  failed: { state: 'error', labelKey: 'runs.failed', fallback: 'Failed' },
  partial: { state: 'warning', labelKey: 'runs.partial', fallback: 'Partial' },
  cancelled: { state: 'not-configured', labelKey: 'runs.cancelled', fallback: 'Cancelled' },
};

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

/**
 * "from {run}" — the discovery run a case run was split from. Clickable only
 * when a handler is given (own runs); a member's read-only rows show the plain
 * chip. A span, never a button: it sits inside the row's own button.
 */
export function RunOriginChip({ discoveryRunId, onSelect }: { discoveryRunId: string; onSelect?: () => void }) {
  const { t } = useTranslation('pipelines');
  const style: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    height: 18,
    padding: '0 6px',
    borderRadius: 'var(--r-pill)',
    border: '1px solid var(--border-1)',
    background: 'var(--bg-surface-2)',
    fontSize: 10,
    color: 'var(--text-3)',
    cursor: onSelect ? 'pointer' : 'default',
  };
  const body = (
    <>
      <Split size={10} />
      {t('runs.from', 'from')} <span style={mono}>{discoveryRunId}</span>
    </>
  );
  const title = t('runs.fromHint', 'Split from discovery run {{id}}', { id: discoveryRunId });
  return (
    <span
      data-run-origin={discoveryRunId}
      role={onSelect ? 'link' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      title={title}
      onClick={
        onSelect
          ? (e) => {
              e.stopPropagation();
              onSelect();
            }
          : undefined
      }
      onKeyDown={
        onSelect
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onSelect();
              }
            }
          : undefined
      }
      style={style}
    >
      {body}
    </span>
  );
}

export function ActivationRunHistory({
  pipelineId,
  projectId,
  userId,
  mine,
}: {
  pipelineId: string;
  projectId: string;
  /** Set for an org member's activation — read-only summaries. */
  userId?: string;
  mine: boolean;
}) {
  const { t } = useTranslation('pipelines');
  const key = activationRunsKey(pipelineId, projectId, mine ? undefined : userId);
  const runs = useStore((s) => s.pipelineRunsByActivation[key]);
  const status = useStore((s) => s.pipelineRunsStatus[key]);
  const selectedRunId = useStore((s) => s.pipelineSelectedRunByActivation[key]);
  const detail = useStore((s) => (selectedRunId ? s.pipelineRunDetails[selectedRunId] : undefined));
  const loadActivationRuns = useStore((s) => s.loadActivationRuns);
  const selectActivationRun = useStore((s) => s.selectActivationRun);
  const selectedProject = useStore((s) => s.selectedProject);
  const selectFile = useStore((s) => s.selectFile);

  useEffect(() => {
    void loadActivationRuns(pipelineId, projectId, mine ? undefined : userId);
  }, [pipelineId, projectId, userId, mine, loadActivationRuns]);

  const resource = useMemo<AsyncResource<PipelineRunSummary[]>>(() => {
    if (status?.status === 'error' && !runs) return { status: 'error', error: new Error(status.error ?? t('runs.loadError', 'Could not load the run history.')) };
    if (!runs) return { status: 'loading' };
    if (runs.length === 0) return { status: 'empty', refreshing: status?.status === 'loading' };
    return { status: 'ready', data: runs, refreshing: status?.status === 'loading' };
  }, [runs, status, t]);

  // Artifact paths open in the editor only when the run's project is the one
  // the file panel is bound to — elsewhere the chip is a plain path.
  const onOpenArtifact = mine && selectedProject === projectId ? (path: string) => selectFile(path) : undefined;

  return (
    <AsyncBoundary
      surface="inline"
      resource={resource}
      retry={() => void loadActivationRuns(pipelineId, projectId, mine ? undefined : userId)}
      empty={
        <div style={{ color: 'var(--text-3)', fontSize: 12, padding: '10px 4px' }}>
          {mine ? t('runs.empty', 'No runs yet — press Run now to test this pipeline.') : t('runs.emptyOther', 'No runs recorded for this activation yet.')}
        </div>
      }
    >
      {(list) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 0' }}>
          {list.map((run) => {
            const open = mine && selectedRunId === run.runId;
            return (
              <div key={run.runId}>
                <RunRow
                  run={run}
                  active={open}
                  clickable={mine}
                  onClick={() => mine && selectActivationRun(key, open ? null : run.runId, projectId)}
                  onSelectOrigin={mine ? (runId) => selectActivationRun(key, runId, projectId) : undefined}
                />
                {open && detail && (
                  <div style={{ padding: '10px 6px 4px 18px' }}>
                    <RunTimeline
                      steps={detail.steps}
                      live={detail.status === 'running' || detail.status === 'awaiting_human'}
                      onCancel={detail.status === 'running' || detail.status === 'awaiting_human' ? () => void cancelPipelineRun(detail.runId) : undefined}
                      onOpenArtifact={onOpenArtifact}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </AsyncBoundary>
  );
}

function RunRow({
  run,
  active,
  clickable,
  onClick,
  onSelectOrigin,
}: {
  run: PipelineRunSummary;
  active: boolean;
  clickable: boolean;
  onClick: () => void;
  /** Selects the discovery run a case row was split from (own runs only). */
  onSelectOrigin?: (runId: string) => void;
}) {
  const { t } = useTranslation('pipelines');
  const pill = RUN_PILL[run.status] ?? RUN_PILL.completed;
  const started = new Date(run.startedAt);
  const duration = run.endedAt ? Math.max(0, Math.round((Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000)) : null;
  const FiredByIcon = FIRED_BY_ICON[run.firedBy];
  const firedBy = FIRED_BY_LABEL[run.firedBy];
  return (
    <button
      onClick={onClick}
      disabled={!clickable}
      style={{
        width: '100%',
        textAlign: 'left',
        padding: '8px 10px',
        borderRadius: 'var(--r-md)',
        border: `1px solid ${active ? 'var(--violet-500)' : 'var(--border-1)'}`,
        background: active ? 'color-mix(in srgb, var(--violet-500) 7%, transparent)' : 'var(--bg-surface)',
        cursor: clickable ? 'pointer' : 'default',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-2)' }}>
        <FiredByIcon size={11} />
        {t(firedBy.key, firedBy.fallback)}
      </span>
      <StatusPill state={pill.state} label={t(pill.labelKey, pill.fallback)} />
      <span style={{ fontSize: 11, color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>
        {started.toLocaleString()} {duration !== null && `· ${duration}s`}
      </span>
      <span style={{ fontSize: 10, ...mono, color: 'var(--text-3)' }}>{run.runId}</span>
      {run.discoveryRunId && <RunOriginChip discoveryRunId={run.discoveryRunId} onSelect={onSelectOrigin ? () => onSelectOrigin(run.discoveryRunId!) : undefined} />}
      {/* Gate decisions — the org observer's "who opened this gate" channel, on read-only rows too. */}
      {run.gates?.map((g) => (
        <Badge key={g.stepId} size="sm" tone={isApprovedDecision(g.decision) ? 'success' : 'error'} title={g.stepId}>
          {gateDecisionLabel(t, g.decision, g.decidedBy)}
        </Badge>
      ))}
      {run.error && <span style={{ flexBasis: '100%', fontSize: 11, color: 'var(--status-error-fg)' }}>{run.error}</span>}
    </button>
  );
}

export function RunTimeline({
  steps,
  live,
  onCancel,
  jobLink = true,
  onOpenArtifact,
}: {
  steps: StepRecord[];
  live: boolean;
  onCancel?: () => void;
  /** false = plain jobId text (approver panel — job deep links are project-scoped). */
  jobLink?: boolean;
  /** Present when an artifact path can be opened in the editor (own run, bound project). */
  onOpenArtifact?: (path: string) => void;
}) {
  const { t } = useTranslation('pipelines');
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-1)' }}>{t('runs.timeline', 'Step timeline')}</span>
        {onCancel && (
          <Button variant="ghost" size="xs" onClick={onCancel}>
            <XCircle size={12} /> {t('runs.cancel', 'Cancel run')}
          </Button>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {steps.map((step, i) => {
          const color = STEP_STATUS_COLOR[step.status] ?? 'var(--text-3)';
          const pulsing = live && LIVE_STEP_STATUSES.has(step.status);
          return (
            <div key={step.stepId} style={{ display: 'flex', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 14 }}>
                <span style={{ width: 10, height: 10, borderRadius: 6, marginTop: 5, background: color, boxShadow: pulsing ? `0 0 0 4px color-mix(in srgb, ${color} 22%, transparent)` : undefined }} />
                {i < steps.length - 1 && <span style={{ flex: 1, width: 2, background: 'var(--border-1)', minHeight: 22 }} />}
              </div>
              <div style={{ paddingBottom: 16, minWidth: 0, flex: 1 }}>
                <StepRecordBody step={step} jobLink={jobLink} onOpenArtifact={onOpenArtifact} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
