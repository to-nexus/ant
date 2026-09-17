/**
 * StepRecordBody — ONE renderer for "one step of one run": status, verdict,
 * retries, job link, timing, error, dispatch audit, output, clarify Q/A and
 * the gate audit. The run timeline lists it per step; the read-only step
 * inspector shows it for the node a person clicked. Two surfaces, one body.
 */

import { useTranslation } from 'react-i18next';
import type { StepRecord } from '@ant/shared';
import { useStore } from '@/domain/store';
import { formatElapsedTime } from '@/shared/utils/timeUtils';
import { FieldHint } from '../ConfigEditor/aurora';
import { Badge } from '../aurora';
import { TokenChip } from './inspector/chips';
import { STEP_STATUS_COLOR, gateDecisionLabel, stepStatusLabel } from './runStepPresentation';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };
const jobChip: React.CSSProperties = { fontSize: 10, ...mono, padding: '1px 7px', borderRadius: 999, background: 'var(--bg-surface-2)', border: '1px solid var(--border-1)', color: 'var(--text-3)' };

export interface StepRecordBodyProps {
  step: StepRecord;
  /** false = plain jobId text (approver panel — job deep links are project-scoped). */
  jobLink?: boolean;
  /** Present when an artifact path can be opened in the editor (own run, bound project). */
  onOpenArtifact?: (path: string) => void;
  /** false when the surrounding surface already names the step (the node inspector). */
  showStepId?: boolean;
}

export function StepRecordBody({ step, jobLink = true, onOpenArtifact, showStepId = true }: StepRecordBodyProps) {
  const { t } = useTranslation('pipelines');
  const selectJobId = useStore((s) => (s as any).selectJobId);
  const color = STEP_STATUS_COLOR[step.status] ?? 'var(--text-3)';
  const startedMs = step.startedAt ? Date.parse(step.startedAt) : NaN;
  const endedMs = step.endedAt ? Date.parse(step.endedAt) : NaN;
  const elapsedMs = Number.isFinite(startedMs) ? (Number.isFinite(endedMs) ? endedMs : Date.now()) - startedMs : NaN;

  return (
    <div style={{ minWidth: 0, flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {showStepId && <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-1)' }}>{step.stepId}</span>}
        <span data-step-status={step.status} style={{ fontSize: 10.5, fontWeight: 600, color }}>
          {stepStatusLabel(t, step.status)}
        </span>
        {step.verdict && (
          <Badge size="sm" tone="brand" title={t('runs.verdictHint', "The intent's sealed decision — verdict edges route on it")}>
            {t('runs.verdict', 'Verdict: {{v}}', { v: step.verdict })}
          </Badge>
        )}
        {(step.retriesUsed ?? 0) > 0 && (
          <Badge size="sm" tone="warning" title={(step.attempts ?? []).map((a) => a.error).join('\n')}>
            {t('runs.retries', '{{n}} retr(y/ies)', { n: step.retriesUsed })}
          </Badge>
        )}
        {step.jobId &&
          (jobLink ? (
            <button
              data-job-id={step.jobId}
              onClick={() => typeof selectJobId === 'function' && selectJobId(step.jobId, { jobType: 'universal' })}
              title={step.jobId}
              style={{ ...jobChip, cursor: 'pointer' }}
            >
              {step.jobId}
            </button>
          ) : (
            <span data-job-id={step.jobId} title={step.jobId} style={jobChip}>
              {step.jobId}
            </span>
          ))}
      </div>
      {Number.isFinite(startedMs) && (
        <div data-step-timing style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
          {t('runs.started', 'Started {{when}}', { when: new Date(startedMs).toLocaleTimeString() })}
          {Number.isFinite(endedMs) && ` · ${t('runs.ended', 'Ended {{when}}', { when: new Date(endedMs).toLocaleTimeString() })}`}
          {Number.isFinite(elapsedMs) && elapsedMs >= 0 && ` · ${t('runs.elapsed', 'Elapsed {{d}}', { d: formatElapsedTime(elapsedMs) })}`}
        </div>
      )}
      {step.error && <div style={{ fontSize: 11, color: 'var(--status-error-fg)', marginTop: 3 }}>{step.error}</div>}
      {step.dispatch?.unresolvedTemplates && step.dispatch.unresolvedTemplates.length > 0 && (
        <FieldHint tone="warn" spacing="above">
          {t('runs.unresolvedTemplates', 'Rendered empty: {{refs}} — the referenced step had no output at dispatch', { refs: step.dispatch.unresolvedTemplates.map((r) => `{{${r}}}`).join(', ') })}
        </FieldHint>
      )}
      {step.output?.answer && (
        <details style={{ marginTop: 3 }}>
          <summary style={{ fontSize: 11, color: 'var(--text-2)', cursor: 'pointer' }}>
            {step.output.answer.split('\n').find((l) => l.trim())?.slice(0, 120)}
            {step.output.answerTruncated ? ' …' : ''}
          </summary>
          <div style={{ fontSize: 11, color: 'var(--text-2)', whiteSpace: 'pre-wrap', marginTop: 4, maxHeight: 240, overflowY: 'auto', padding: '6px 8px', background: 'var(--bg-surface-2)', borderRadius: 'var(--r-sm)' }}>
            {step.output.answer}
          </div>
        </details>
      )}
      {step.output?.artifacts && step.output.artifacts.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
          {step.output.artifacts.map((path) => (
            <TokenChip key={path} disabled={!onOpenArtifact} title={onOpenArtifact ? t('runs.openArtifact', 'Open in the editor') : path} onClick={() => onOpenArtifact?.(path)}>
              {path}
            </TokenChip>
          ))}
        </div>
      )}
      {step.clarify && (
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>
          {t('runs.clarifyAsked', 'Q{{round}}: {{question}}', { round: step.clarify.round, question: step.clarify.question })}
          {step.clarify.answeredAt
            ? ` · ${t('runs.clarifyAnswered', 'answered by {{who}}', { who: step.clarify.answeredBy ?? t('runs.unknownActor', 'unknown') })} · ${new Date(step.clarify.answeredAt).toLocaleTimeString()}${step.clarify.via ? ` · ${step.clarify.via}` : ''}`
            : ` · ${t('runs.clarifyWaiting', 'awaiting answer')}`}
          {step.clarify.answer && (
            <div style={{ marginTop: 3, padding: '3px 8px', borderLeft: '2px solid var(--border-2)', color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>
              {step.clarify.answer}
            </div>
          )}
        </div>
      )}
      {step.gate?.assignees && step.gate.assignees.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>
          {t('runs.gateAssignedTo', 'assigned to {{who}}', { who: step.gate.assignees.join(', ') })}
          {step.gate.assigneeSource === 'human' && step.gate.assignedBy && ` · ${t('runs.gateAssignedBy', 'by {{who}}', { who: step.gate.assignedBy })}`}
        </div>
      )}
      {step.gate?.decision && (
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>
          {gateDecisionLabel(t, step.gate.decision, step.gate.decidedBy)}
          {step.gate.decidedAt && ` · ${new Date(step.gate.decidedAt).toLocaleTimeString()}`}
          {step.gate.via && ` · ${step.gate.via}`}
          {step.gate.decisionNote && (
            <div style={{ marginTop: 3, padding: '3px 8px', borderLeft: '2px solid var(--border-2)', fontStyle: 'italic', color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>
              {step.gate.decisionNote}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
