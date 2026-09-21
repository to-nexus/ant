/**
 * StepRunInspector — the read-only drawer a canvas node opens while the
 * pipeline is published or running. "Not editable" is not "not viewable": the
 * editor (StepInspector) is what the BE gate locks; this surface answers "what
 * is this step doing right now, and what is it defined to do". Two cards in
 * that order — Run (the focused live run's record for this node) then
 * Definition (the saved step, rendered from the same resolvers the editor
 * uses). No inputs, no onChange, no Remove.
 */

import { useTranslation } from 'react-i18next';
import { Activity, FileText } from 'lucide-react';
import {
  GENERAL_INTENT,
  isApprovalStep,
  parseCustomJobRef,
  resolveRunConcurrency,
  verdictEdgeOutcomes,
  type ApprovalStepDef,
  type JobStepDef,
  type PipelineDef,
  type PipelineLiveRun,
  type PipelineStepStatus,
  type StepEdgeCondition,
} from '@ant/shared';
import type { PipelineRunPublic } from '@/domain/store/slices/pipelineSlice';
import { Badge } from '../aurora';
import { InspectorShell } from './InspectorShell';
import { InspectorSection, type InspectorSectionStatus } from './inspector/primitives/InspectorSection';
import { Field } from './inspector/primitives/Field';
import { TokenChip } from './inspector/chips';
import { TemplatePreview } from './inspector/TemplatePreview';
import { NODE_KIND_STYLE, TRIGGER_MODE_ICON, type NodeKind } from './canvas/nodes';
import { focusRunId, stepRunChips } from './canvas/runOverlay';
import { TRIGGER_NODE_ID, effectiveNeedsOf, triggerModeOf } from './draft';
import { FIRED_BY_ICON, FIRED_BY_LABEL, runHue, runLabel, runTintFg } from './runIdentity';
import { stepStatusLabel } from './runStepPresentation';
import type { IdentityAgentSummary } from './stepIdentity';
import { StepRecordBody } from './StepRecordBody';

export interface StepRunInspectorProps {
  def: PipelineDef;
  /** A step id, or the trigger pseudo-node. */
  nodeId: string;
  onClose: () => void;
  customAgents: IdentityAgentSummary[];
  /** `describeTrigger(def, …)` — both callers already compute it for the canvas. */
  cronSummary: string;
  liveRuns: readonly PipelineLiveRun[];
  runDetails: Record<string, PipelineRunPublic>;
  selectedRunId: string | null;
  onSelectRun?: (runId: string) => void;
  /** Activation context: per-gate approver roster. */
  approversByGate?: Record<string, string[]>;
  onOpenArtifact?: (path: string) => void;
  jobLink?: boolean;
}

type T = (key: string, fallback: string, opts?: Record<string, unknown>) => string;

/** Step status → card badge: settled-good, needs-a-human/failed, or still moving. */
const SECTION_STATUS: Record<PipelineStepStatus, InspectorSectionStatus> = {
  pending: 'todo',
  dispatched: 'todo',
  running: 'todo',
  awaiting_gate: 'warn',
  awaiting_clarify: 'warn',
  succeeded: 'ok',
  failed: 'warn',
  skipped: 'todo',
  cancelled: 'todo',
};

const text: React.CSSProperties = { fontSize: 12, color: 'var(--text-1)', lineHeight: 1.5, overflowWrap: 'anywhere' };
const mono: React.CSSProperties = { ...text, fontFamily: 'var(--font-mono)', fontSize: 11.5 };
const muted: React.CSSProperties = { fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.5 };
const block: React.CSSProperties = { ...text, whiteSpace: 'pre-wrap', padding: '8px 10px', borderRadius: 'var(--r-md)', background: 'var(--bg-surface-2)', border: '1px solid var(--border-1)' };

/** The same label table `EdgeConditionField` offers — one vocabulary for `on:`. */
function edgeConditionLabel(t: T, on: StepEdgeCondition | undefined): string {
  const current = on ?? 'success';
  if (current === 'success') return t('step.onSuccess', 'Succeeded (default)');
  if (current === 'failure') return t('step.onFailure', 'Failed (failure branch)');
  if (current === 'always') return t('step.onAlways', 'Finished either way');
  return t('step.onVerdict', 'Verdict: {{o}}', { o: verdictEdgeOutcomes(current).join(' | ') });
}

/** One live run as a clickable chip in its own hue — the canvas chip vocabulary. */
function RunChip({ run, focused, onSelect, t }: { run: PipelineLiveRun; focused: boolean; onSelect?: (runId: string) => void; t: T }) {
  const fg = runTintFg(runHue(run.runId));
  const Icon = FIRED_BY_ICON[run.firedBy];
  const label = runLabel(run);
  return (
    <button
      type="button"
      data-run-chip={run.runId}
      data-focused={focused || undefined}
      title={t('canvas.selectRun', 'Show run {{label}}', { label })}
      disabled={!onSelect}
      onClick={() => onSelect?.(run.runId)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        height: 22,
        padding: '0 8px',
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 600,
        fontFamily: 'var(--font-mono)',
        color: fg,
        background: `color-mix(in srgb, ${fg} ${focused ? 18 : 9}%, var(--bg-surface))`,
        border: `1px solid ${fg}`,
        boxShadow: focused ? `0 0 0 2px color-mix(in srgb, ${fg} 30%, transparent)` : undefined,
        cursor: onSelect ? 'pointer' : 'default',
      }}
    >
      <Icon size={10} />
      {label}
    </button>
  );
}

function Needs({ def, index, step, t }: { def: PipelineDef; index: number; step: JobStepDef | ApprovalStepDef; t: T }) {
  const needs = effectiveNeedsOf(def, index);
  return (
    <Field label={t('step.needs', 'Depends on')} action={step.needs === undefined && needs.length > 0 ? <Badge size="sm" tone="neutral">{t('step.needsImplicit', 'Inherited: previous step')}</Badge> : undefined}>
      {needs.length === 0 ? (
        <span style={muted}>{t('step.needsRoot', 'None — root step (runs right after the trigger)')}</span>
      ) : (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {needs.map((id) => (
            <TokenChip key={id} disabled>
              {id}
            </TokenChip>
          ))}
        </div>
      )}
    </Field>
  );
}

function JobStepDefinition({ def, step, index, customAgents, t }: { def: PipelineDef; step: JobStepDef; index: number; customAgents: IdentityAgentSummary[]; t: T }) {
  const ref = parseCustomJobRef(step.customJobRef);
  const agent = customAgents.find((a) => a.id === ref?.agentId);
  const job = agent?.jobs.find((j) => j.id === ref?.jobId);
  const intent = step.intent && step.intent !== GENERAL_INTENT ? step.intent : undefined;
  const directive = step.directive?.trim() ?? '';
  const pins = step.context ?? [];
  return (
    <>
      <Field label={t('step.agent', 'Agent')}>
        <span style={text}>{agent?.name ?? ref?.agentId ?? '—'}</span>
      </Field>
      <Field label={t('step.job', 'Job')}>
        <span style={text} title={step.customJobRef}>
          {job?.name ?? ref?.jobId ?? '—'}
        </span>
      </Field>
      <Field label={t('step.intent', 'Intent (max 1)')}>
        <span style={intent ? mono : muted}>{intent ?? t('step.noIntent', 'None (job decides)')}</span>
      </Field>
      <Field label={t('step.stepId', 'Step id')}>
        <span style={mono}>{step.id}</span>
      </Field>
      <Needs def={def} index={index} step={step} t={t} />
      <Field label={t('step.on', 'Run when its dependencies…')}>
        <span style={text}>{edgeConditionLabel(t, step.on)}</span>
      </Field>
      <Field label={t('step.directive', 'Directive')}>
        {directive ? <div style={block}>{directive}</div> : <span style={muted}>{t('step.directiveDefault', 'Default directive (none authored)')}</span>}
        {directive && <TemplatePreview text={directive} def={def} agents={customAgents} stepId={step.id} />}
      </Field>
      <Field label={t('step.context', 'Context pins')}>
        {pins.length === 0 ? (
          <span style={muted}>{t('step.contextNone', 'No context pins')}</span>
        ) : (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {pins.map((p) => (
              <TokenChip key={p} disabled>
                {p}
              </TokenChip>
            ))}
          </div>
        )}
      </Field>
      <Field label={t('step.retry', 'Retry on failure')}>
        <span style={text}>
          {step.retry && step.retry.max > 0
            ? `${t('step.retryN', 'Up to {{n}} retries', { n: step.retry.max })}${step.retry.backoff ? ` · ${step.retry.backoff}` : ''}`
            : t('step.retryOff', 'Off (fail immediately)')}
        </span>
      </Field>
      <Field label={t('step.timeout', 'Time limit per run')}>
        <span style={step.timeout ? mono : muted}>{step.timeout?.after ?? t('step.timeoutNone', 'No time limit')}</span>
      </Field>
      {step.onMissingVerdict && (
        <Field label={t('step.onMissingVerdict', 'If the run seals no verdict')}>
          <span style={text}>{t('step.onMissingVerdictAssume', 'Assume "{{o}}"', { o: step.onMissingVerdict })}</span>
        </Field>
      )}
      {step.discovers && (
        <Field label={t('step.discovery.toggle', 'This step discovers cases')} hint={step.discovers.onMissing === 'complete' ? t('step.discovery.onMissingComplete', 'Treat as nothing to do — the run completes') : t('step.discovery.onMissingFail', 'Fail the step (default — retried like a missing verdict)')}>
          <div data-discovery-fields style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <TokenChip disabled>key</TokenChip>
            {(step.discovers.fields ?? []).map((f) => (
              <TokenChip key={f} disabled>
                {f}
              </TokenChip>
            ))}
          </div>
        </Field>
      )}
    </>
  );
}

function GateDefinition({ def, step, index, approvers, t }: { def: PipelineDef; step: ApprovalStepDef; index: number; approvers?: string[]; t: T }) {
  return (
    <>
      <Field label={t('gate.prompt', 'Approval prompt')}>
        <div style={block}>{step.prompt || '—'}</div>
      </Field>
      <Field label={t('step.stepId', 'Step id')}>
        <span style={mono}>{step.id}</span>
      </Field>
      <Needs def={def} index={index} step={step} t={t} />
      <Field label={t('step.on', 'Run when its dependencies…')}>
        <span style={text}>{edgeConditionLabel(t, step.on)}</span>
      </Field>
      <Field label={t('gate.timeout', 'Timeout')}>
        <span style={step.timeout ? text : muted}>
          {step.timeout
            ? `${step.timeout.after} → ${step.timeout.onTimeout === 'approve' ? t('gate.timeoutApprove', 'Auto-approve') : t('gate.timeoutReject', 'Reject (safe default)')}`
            : t('gate.noTimeout', 'Wait forever')}
        </span>
      </Field>
      <Field label={t('gate.remindAfter', 'Remind while unresolved')}>
        <span style={step.remindAfter ? mono : muted}>{step.remindAfter ?? t('gate.remindNone', 'No reminders')}</span>
      </Field>
      <Field label={t('gate.approvers', 'Approvers')} hint={t('gate.approversHint', 'Approvers are assigned per gate when the pipeline is activated on a project.')}>
        {approvers && approvers.length > 0 ? (
          <div data-gate-approvers style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {approvers.map((who) => (
              <TokenChip key={who} disabled>
                {who}
              </TokenChip>
            ))}
          </div>
        ) : (
          <span style={muted}>{t('gate.approversNone', 'No approvers assigned on this activation')}</span>
        )}
      </Field>
    </>
  );
}

function TriggerDefinition({ def, cronSummary, t }: { def: PipelineDef; cronSummary: string; t: T }) {
  const mode = triggerModeOf(def);
  const sched = def.on?.schedule;
  const upstream = def.on?.upstream;
  const fetch = def.on?.fetch;
  const concurrency = resolveRunConcurrency(def);
  const modeLabel = t(`canvas.triggerMode.${mode}`, { schedule: 'Schedule', manual: 'Manual', upstream: 'Upstream', fetch: 'Fetch' }[mode]);
  return (
    <>
      <Field label={t('trigger.mode', 'Trigger')}>
        <span style={text}>
          {modeLabel}
          {cronSummary && <span style={{ ...muted, marginLeft: 6 }}>{cronSummary}</span>}
        </span>
      </Field>
      {sched && (
        <>
          <Field label={t('trigger.onMissed', 'If a fire is missed')}>
            <span style={text}>{sched.onMissed === 'runOnce' ? t('trigger.onMissedRunOnce', 'Run once on recovery') : t('trigger.onMissedSkip', 'Skip it (default)')}</span>
          </Field>
          <Field label={t('trigger.overlap', 'If the previous run is still live')}>
            <span style={text}>{sched.overlap === 'queue' ? t('trigger.overlapQueue', 'Queue until it finishes') : t('trigger.overlapSkip', 'Skip this fire (default)')}</span>
          </Field>
        </>
      )}
      {upstream && (
        <>
          <Field label={t('trigger.upstreamNode', 'Upstream node')}>
            <span style={text}>{upstream.step ? `${upstream.pipelineId} / ${upstream.step}` : t('trigger.upstreamRunOf', '{{id}} run', { id: upstream.pipelineId })}</span>
          </Field>
          <Field label={t('trigger.upstreamWhen', 'Fires when the node')}>
            <span style={text}>{upstream.when ?? 'success'}</span>
          </Field>
          <Field label={t('trigger.overlap', 'If the previous run is still live')}>
            <span style={text}>{upstream.overlap === 'queue' ? t('trigger.overlapQueue', 'Queue until it finishes') : t('trigger.overlapSkip', 'Skip this fire (default)')}</span>
          </Field>
        </>
      )}
      {fetch && (
        <Field label={t('trigger.modeFetch', 'Poll an external queue (fetch)')}>
          <span style={text}>{t('trigger.fetch.everySummary', 'every {{every}}', { every: fetch.every })}</span>
        </Field>
      )}
      <Field label={t('trigger.concurrency', 'Live runs at once')}>
        <span style={text}>{concurrency === 1 ? t('trigger.concurrencyOne', '1 — one run at a time (default)') : t('trigger.concurrencyN', '{{n}} — up to {{n}} independent runs', { n: concurrency })}</span>
      </Field>
      <Field label={t('trigger.onStepFailure', 'When a step fails')}>
        <span style={text}>{def.defaults?.onStepFailure === 'continue' ? t('trigger.failContinue', 'Continue other branches') : t('trigger.failAbort', 'Abort the run (default)')}</span>
      </Field>
    </>
  );
}

export function StepRunInspector({ def, nodeId, onClose, customAgents, cronSummary, liveRuns, runDetails, selectedRunId, onSelectRun, approversByGate, onOpenArtifact, jobLink = true }: StepRunInspectorProps) {
  const { t } = useTranslation('pipelines');
  const isTrigger = nodeId === TRIGGER_NODE_ID;
  const index = def.steps.findIndex((s) => s.id === nodeId);
  const step = index >= 0 ? def.steps[index] : undefined;
  const kind: NodeKind = isTrigger ? 'trigger' : step && isApprovalStep(step) ? 'gate' : 'step';
  const look = NODE_KIND_STYLE[kind];
  const title = { trigger: t('inspector.trigger', 'Trigger & policies'), gate: t('inspector.gate', 'Approval gate'), step: t('inspector.step', 'Job step') }[kind];

  // The focused run is the canvas's rule (selected if live, else newest live) — the drawer never disagrees with the node border.
  const focus = focusRunId(liveRuns, selectedRunId);
  const focusRun = focus ? liveRuns.find((r) => r.runId === focus) : undefined;
  const detail = focus ? runDetails[focus] : undefined;
  const record = detail?.steps.find((s) => s.stepId === nodeId);
  const runsHere = isTrigger ? [] : (stepRunChips(def, liveRuns, (id) => runDetails[id])[nodeId] ?? []).flatMap((c) => liveRuns.filter((r) => r.runId === c.runId));

  const runState: 'noLiveRuns' | 'detailLoading' | 'notReached' | 'focused' =
    liveRuns.length === 0 ? 'noLiveRuns' : !detail ? 'detailLoading' : !record || record.status === 'pending' ? 'notReached' : 'focused';
  const focusLabel = focusRun ? runLabel(focusRun) : (focus ?? '');
  const sectionStatus = !isTrigger && runState === 'focused' && record ? SECTION_STATUS[record.status] : undefined;

  return (
    <InspectorShell title={title} icon={isTrigger ? TRIGGER_MODE_ICON[triggerModeOf(def)] : look.icon} accent={look.accent} onClose={onClose}>
      <InspectorSection
        icon={Activity}
        accent={look.accent}
        title={t('inspector.section.run', 'Run')}
        description={t('inspector.readOnlyHint', 'Read-only — the live run and the saved definition')}
        status={sectionStatus}
        statusLabel={sectionStatus && record ? stepStatusLabel(t, record.status) : undefined}
        action={isTrigger && liveRuns.length > 0 ? <Badge tone="brand" size="sm">{t('execution.liveCount', '{{n}} live', { n: liveRuns.length })}</Badge> : undefined}
        data-section="run"
      >
        {isTrigger ? (
          liveRuns.length === 0 ? (
            <span data-run-state="noLiveRuns" style={muted}>
              {t('inspector.run.noLiveRuns', 'No live runs — the definition below is what will run.')}
            </span>
          ) : (
            <div data-run-state="focused" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {liveRuns.map((run) => (
                <div key={run.runId} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <RunChip run={run} focused={run.runId === focus} onSelect={onSelectRun} t={t} />
                  <span style={muted}>{t(FIRED_BY_LABEL[run.firedBy].key, FIRED_BY_LABEL[run.firedBy].fallback)}</span>
                  <span style={{ ...muted, fontVariantNumeric: 'tabular-nums' }}>{new Date(run.startedAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )
        ) : (
          <>
            {runsHere.length > 1 && (
              <div role="group" aria-label={t('canvas.runsHere', '{{n}} live run(s) at this step', { n: runsHere.length })} style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {runsHere.map((run) => (
                  <RunChip key={run.runId} run={run} focused={run.runId === focus} onSelect={onSelectRun} t={t} />
                ))}
              </div>
            )}
            <div data-run-state={runState}>
              {runState === 'noLiveRuns' && <span style={muted}>{t('inspector.run.noLiveRuns', 'No live runs — the definition below is what will run.')}</span>}
              {runState === 'detailLoading' && <span style={muted}>{t('inspector.run.detailLoading', 'Loading run detail…')}</span>}
              {runState === 'notReached' && <span style={muted}>{t('inspector.run.notReached', 'Run {{label}} has not reached this step yet.', { label: focusLabel })}</span>}
              {runState === 'focused' && record && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={muted}>{t('inspector.run.focused', 'Showing run {{label}}', { label: focusLabel })}</span>
                  <StepRecordBody step={record} showStepId={false} jobLink={jobLink} onOpenArtifact={onOpenArtifact} />
                </div>
              )}
            </div>
          </>
        )}
      </InspectorSection>

      <InspectorSection icon={FileText} accent={look.accent} title={t('inspector.section.definition', 'Definition')} data-section="definition">
        {isTrigger ? (
          <TriggerDefinition def={def} cronSummary={cronSummary} t={t} />
        ) : step && isApprovalStep(step) ? (
          <GateDefinition def={def} step={step} index={index} approvers={approversByGate?.[step.id]} t={t} />
        ) : step ? (
          <JobStepDefinition def={def} step={step} index={index} customAgents={customAgents} t={t} />
        ) : null}
      </InspectorSection>
    </InspectorShell>
  );
}
