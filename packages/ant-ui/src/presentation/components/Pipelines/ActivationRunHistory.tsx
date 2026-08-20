/**
 * ActivationRunHistory — one activation's fire history (firedBy badge,
 * status, duration) and the per-run step timeline (status chips, jobId chip →
 * job deep link, gate audit line). Embedded per-activation inside the
 * Execution view; members' histories render read-only (no cancel, no detail —
 * run detail is own-runs-only on the server).
 */

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Play, XCircle } from 'lucide-react';
import type { PipelineRunSummary, StepRecord } from '@ant/shared';
import { useStore } from '@/domain/store';
import { activationRunsKey } from '@/domain/store/slices/pipelineSlice';
import { StatusPill } from '../ConfigEditor/aurora';
import { Button } from '../aurora';
import { cancelPipelineRun } from '@/infrastructure/http/api/pipelines';

const RUN_PILL: Record<string, { state: any; labelKey: string; fallback: string }> = {
  running: { state: 'checking', labelKey: 'runs.running', fallback: 'Running' },
  awaiting_human: { state: 'warning', labelKey: 'runs.awaiting', fallback: 'Awaiting approval' },
  completed: { state: 'connected', labelKey: 'runs.completed', fallback: 'Completed' },
  failed: { state: 'error', labelKey: 'runs.failed', fallback: 'Failed' },
  partial: { state: 'warning', labelKey: 'runs.partial', fallback: 'Partial' },
  cancelled: { state: 'not-configured', labelKey: 'runs.cancelled', fallback: 'Cancelled' },
  expired: { state: 'not-configured', labelKey: 'runs.expired', fallback: 'Expired' },
};

const STEP_COLOR: Record<string, string> = {
  succeeded: 'var(--emerald-500)',
  failed: 'var(--red-500)',
  running: 'var(--violet-500)',
  dispatched: 'var(--violet-500)',
  awaiting_gate: 'var(--amber-500, #f59e0b)',
  skipped: 'var(--text-3)',
  cancelled: 'var(--text-3)',
  pending: 'var(--text-3)',
};

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
  const runs = useStore((s) => s.pipelineRunsByActivation[key]) ?? [];
  const detail = useStore((s) => s.pipelineRunDetail);
  const loadActivationRuns = useStore((s) => s.loadActivationRuns);
  const loadPipelineRunDetail = useStore((s) => s.loadPipelineRunDetail);

  useEffect(() => {
    void loadActivationRuns(pipelineId, projectId, mine ? undefined : userId);
  }, [pipelineId, projectId, userId, mine, loadActivationRuns]);

  if (runs.length === 0) {
    return (
      <div style={{ color: 'var(--text-3)', fontSize: 12, padding: '10px 4px' }}>
        {mine
          ? t('runs.empty', 'No runs yet — press Run now to test this pipeline.')
          : t('runs.emptyOther', 'No runs recorded for this activation yet.')}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 0' }}>
      {runs.map((run) => (
        <div key={run.runId}>
          <RunRow
            run={run}
            active={mine && detail?.runId === run.runId}
            clickable={mine}
            onClick={() => mine && void loadPipelineRunDetail(run.runId, projectId)}
          />
          {mine && detail?.runId === run.runId && (
            <div style={{ padding: '10px 6px 4px 18px' }}>
              <RunTimeline
                steps={detail.steps}
                live={detail.status === 'running' || detail.status === 'awaiting_human'}
                onCancel={
                  detail.status === 'running' || detail.status === 'awaiting_human'
                    ? () => void cancelPipelineRun(detail.runId)
                    : undefined
                }
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function RunRow({
  run,
  active,
  clickable,
  onClick,
}: {
  run: PipelineRunSummary;
  active: boolean;
  clickable: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation('pipelines');
  const pill = RUN_PILL[run.status] ?? RUN_PILL.completed;
  const started = new Date(run.startedAt);
  const duration = run.endedAt ? Math.max(0, Math.round((Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000)) : null;
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
        {run.firedBy === 'cron' ? <Clock size={11} /> : <Play size={11} />}
        {run.firedBy === 'cron' ? t('runs.cron', 'Scheduled') : t('runs.manual', 'Manual')}
      </span>
      <StatusPill state={pill.state} label={t(pill.labelKey, pill.fallback)} />
      <span style={{ fontSize: 11, color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>
        {started.toLocaleString()} {duration !== null && `· ${duration}s`}
      </span>
      <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)' }}>{run.runId}</span>
    </button>
  );
}

export function RunTimeline({ steps, live, onCancel }: { steps: StepRecord[]; live: boolean; onCancel?: () => void }) {
  const { t } = useTranslation('pipelines');
  const selectJobId = useStore((s) => (s as any).selectJobId);
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
          const color = STEP_COLOR[step.status] ?? 'var(--text-3)';
          return (
            <div key={step.stepId} style={{ display: 'flex', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 14 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 6,
                    marginTop: 5,
                    background: color,
                    boxShadow: live && (step.status === 'running' || step.status === 'awaiting_gate') ? `0 0 0 4px color-mix(in srgb, ${color} 22%, transparent)` : undefined,
                  }}
                />
                {i < steps.length - 1 && <span style={{ flex: 1, width: 2, background: 'var(--border-1)', minHeight: 22 }} />}
              </div>
              <div style={{ paddingBottom: 16, minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-1)' }}>{step.stepId}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 600, color, textTransform: 'capitalize' }}>{step.status.replace(/_/g, ' ')}</span>
                  {step.jobId && (
                    <button
                      onClick={() => typeof selectJobId === 'function' && selectJobId(step.jobId, { jobType: 'universal' })}
                      title={step.jobId}
                      style={{
                        fontSize: 10,
                        fontFamily: 'monospace',
                        padding: '1px 7px',
                        borderRadius: 999,
                        background: 'var(--bg-surface-2)',
                        border: '1px solid var(--border-1)',
                        color: 'var(--text-3)',
                        cursor: 'pointer',
                      }}
                    >
                      {step.jobId}
                    </button>
                  )}
                </div>
                {step.error && <div style={{ fontSize: 11, color: 'var(--red-500)', marginTop: 3 }}>{step.error}</div>}
                {step.gate?.decision && (
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>
                    {step.gate.decision.startsWith('expired')
                      ? t('runs.gateExpired', 'Timed out → {{action}}', { action: step.gate.decision === 'expired_approve' ? 'approved' : 'rejected' })
                      : t('runs.gateDecided', '{{decision}} by {{who}}', {
                          decision: step.gate.decision === 'approved' ? 'Approved' : 'Rejected',
                          who: step.gate.decidedBy ?? 'unknown',
                        })}
                    {step.gate.decidedAt && ` · ${new Date(step.gate.decidedAt).toLocaleTimeString()}`}
                    {step.gate.via && ` · ${step.gate.via}`}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
