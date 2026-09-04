/**
 * StepInspector — the right-hand drawer the canvas opens on node click
 * (n8n interaction model). Three panels over ONE draft: trigger (cron +
 * policies), job step (agent→job cascade, intent ≤1, directive, context
 * pins, edge condition), approval gate (prompt, timeout, channels).
 *
 * Cascade gotchas honored: `jobs[].intents === undefined` means "catalog
 * failed to parse" (rendered as a warning, NOT as "no intents"), and
 * `CustomIntentDef.infer` is prompt text — never used as UI copy.
 */

import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Trash2, Plus, FolderOpen } from 'lucide-react';
import {
  GENERAL_INTENT,
  PIPELINE_TEMPLATE_VARS,
  isApprovalStep,
  parseCustomJobRef,
  type ApprovalStepDef,
  type JobStepDef,
  type PipelineDef,
  type PipelineRunStatus,
  type StepEdgeCondition,
} from '@ant/shared';
import { useStore } from '@/domain/store';
import { useArtifactPickerTree } from '@/application/hooks/ui/useArtifactPickerTree';
import { AuroraSelect, AuroraInput, FieldLabel } from '../ConfigEditor/aurora';
import { Textarea, Button } from '../aurora';
import { HintBadge } from '../common/HintBadge';
import { Tooltip } from '../common/Tooltip';
import { FileTreePicker } from '../common/FileTreePicker';
import { CronBuilder } from './CronBuilder';
import { TRIGGER_NODE_ID, descendantsOf, effectiveNeedsOf, removeStep, setStepNeeds, setTriggerMode, triggerModeOf, updateRunCompleted, updateSchedule, updateStep, type TriggerMode } from './draft';
import { upstreamOutputSuggestions } from './upstreamOutputs';

export interface StepInspectorProps {
  def: PipelineDef;
  nodeId: string;
  onChange: (next: PipelineDef) => void;
  onClose: () => void;
  onCronValidity: (ok: boolean) => void;
}

const TIMEOUT_PRESETS = ['4h', '24h', '72h', '7d'];

export function StepInspector({ def, nodeId, onChange, onClose, onCronValidity }: StepInspectorProps) {
  const { t } = useTranslation('pipelines');
  // Account-scoped catalog — the pipelines tab is account-scoped, so the
  // project-scoped `customAgents` slice can be legitimately empty here.
  const customAgents = useStore((s) => s.accountAgents);

  const step = def.steps.find((s) => s.id === nodeId);
  const isTrigger = nodeId === TRIGGER_NODE_ID;
  const stepIndex = def.steps.findIndex((s) => s.id === nodeId);

  const title = isTrigger
    ? t('inspector.trigger', 'Trigger & policies')
    : step && isApprovalStep(step)
      ? t('inspector.gate', 'Approval gate')
      : t('inspector.step', 'Job step');

  const body = useMemo(() => {
    if (isTrigger) {
      return (
        <TriggerPanel def={def} onChange={onChange} onCronValidity={onCronValidity} />
      );
    }
    if (!step) return null;
    if (isApprovalStep(step)) {
      return <GatePanel def={def} step={step} stepIndex={stepIndex} onChange={onChange} />;
    }
    return <JobStepPanel def={def} step={step} stepIndex={stepIndex} onChange={onChange} customAgents={customAgents} />;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def, step, isTrigger, stepIndex, customAgents]);

  return (
    <div
      style={{
        width: 360,
        flexShrink: 0,
        height: '100%',
        borderLeft: '1px solid var(--border-1)',
        background: 'var(--bg-surface)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: '1px solid var(--border-1)',
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-1)' }}>{title}</span>
        <button aria-label={t('inspector.close', 'Close')} onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer' }}>
          <X size={15} />
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {body}
        {!isTrigger && step && (
          <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid var(--border-1)' }}>
            <Button
              variant="danger"
              size="sm"
              fullWidth
              onClick={() => {
                onChange(removeStep(def, step.id));
                onClose();
              }}
            >
              {t('inspector.deleteStep', 'Remove step')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

const TERMINAL_STATUSES = ['completed', 'failed', 'partial', 'cancelled'] as const;

function TriggerPanel({ def, onChange, onCronValidity }: { def: PipelineDef; onChange: (d: PipelineDef) => void; onCronValidity: (ok: boolean) => void }) {
  const { t } = useTranslation('pipelines');
  const sched = def.on?.schedule;
  const runCompleted = def.on?.runCompleted;
  const mode = triggerModeOf(def);
  const pipelines = useStore((s) => s.pipelines);
  const selectedId = useStore((s) => s.selectedPipelineId);
  return (
    <>
      <div>
        <FieldLabel>{t('trigger.mode', 'Trigger')}</FieldLabel>
        <AuroraSelect
          value={mode}
          onChange={(v) => {
            onChange(setTriggerMode(def, v as TriggerMode));
            // Only a schedule has a cron to validate — other modes open the gate.
            if (v !== 'schedule') onCronValidity(true);
          }}
          options={[
            { value: 'schedule', label: t('trigger.modeSchedule', 'Cron schedule') },
            { value: 'runCompleted', label: t('trigger.modeRunCompleted', 'After another pipeline') },
            { value: 'manual', label: t('trigger.modeManual', 'Manual only (Run now)') },
          ]}
        />
      </div>
      {mode === 'runCompleted' && (
        <>
          <div>
            <FieldLabel required>{t('trigger.chainSource', 'Fires when this pipeline finishes')}</FieldLabel>
            <AuroraSelect
              value={runCompleted?.pipelineId ?? ''}
              onChange={(v) => onChange(updateRunCompleted(def, { pipelineId: v }))}
              placeholder={t('trigger.chainSourcePick', 'Choose a pipeline')}
              options={pipelines.filter((p) => p.id !== selectedId).map((p) => ({ value: p.id, label: p.name }))}
            />
          </div>
          <div>
            <FieldLabel>{t('trigger.chainStatuses', 'On these outcomes')}</FieldLabel>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {TERMINAL_STATUSES.map((s) => {
                const active = (runCompleted?.statuses ?? ['completed']).includes(s);
                return (
                  <button
                    key={s}
                    onClick={() => {
                      const current = new Set<PipelineRunStatus>(runCompleted?.statuses ?? ['completed']);
                      if (active) current.delete(s);
                      else current.add(s);
                      onChange(updateRunCompleted(def, { statuses: current.size > 0 ? [...current] : ['completed'] }));
                    }}
                    style={{ ...chipStyle(active), cursor: 'pointer' }}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
      {sched && (
        <>
          <CronBuilder
            cron={sched.cron}
            tz={sched.tz}
            onChange={(patch) => onChange(updateSchedule(def, patch))}
            onValidity={onCronValidity}
          />
          <div>
            <FieldLabel>{t('trigger.onMissed', 'If a fire is missed')}</FieldLabel>
            <AuroraSelect
              value={sched.onMissed ?? 'skip'}
              onChange={(v) => onChange(updateSchedule(def, { onMissed: v as 'skip' | 'runOnce' }))}
              options={[
                { value: 'skip', label: t('trigger.onMissedSkip', 'Skip it (default)') },
                { value: 'runOnce', label: t('trigger.onMissedRunOnce', 'Run once on recovery') },
              ]}
            />
          </div>
          <div>
            <FieldLabel>{t('trigger.overlap', 'If the previous run is still live')}</FieldLabel>
            <AuroraSelect
              value={sched.overlap ?? 'skip'}
              onChange={(v) => onChange(updateSchedule(def, { overlap: v as 'skip' | 'queue' }))}
              options={[
                { value: 'skip', label: t('trigger.overlapSkip', 'Skip this fire (default)') },
                { value: 'queue', label: t('trigger.overlapQueue', 'Queue until it finishes') },
              ]}
            />
          </div>
        </>
      )}
      <div>
        <FieldLabel>{t('trigger.onStepFailure', 'When a step fails')}</FieldLabel>
        <AuroraSelect
          value={def.defaults?.onStepFailure ?? 'abort'}
          onChange={(v) => onChange({ ...def, defaults: { ...def.defaults, onStepFailure: v as 'abort' | 'continue' } })}
          options={[
            { value: 'abort', label: t('trigger.failAbort', 'Abort the run (default)') },
            { value: 'continue', label: t('trigger.failContinue', 'Continue other branches') },
          ]}
        />
      </div>
    </>
  );
}

/** Per-var human labels for the template-var chips (SSOT list stays in @ant/shared). */
const TEMPLATE_VAR_META: Record<string, { labelKey: string; labelDefault: string }> = {
  'trigger.fireDate': { labelKey: 'step.templateVar.fireDate', labelDefault: 'Fire time (ISO)' },
  'trigger.fireEpoch': { labelKey: 'step.templateVar.fireEpoch', labelDefault: 'Fire time (epoch ms)' },
  'run.id': { labelKey: 'step.templateVar.runId', labelDefault: 'Run id' },
  'run.prevSuccess.fireDate': { labelKey: 'step.templateVar.prevSuccessFireDate', labelDefault: 'Previous successful run (ISO) — empty on the first run' },
  'run.prevSuccess.fireEpoch': { labelKey: 'step.templateVar.prevSuccessFireEpoch', labelDefault: 'Previous successful run (epoch ms) — empty on the first run' },
};

const varChipStyle: React.CSSProperties = {
  fontSize: 10,
  fontFamily: 'monospace',
  padding: '2px 7px',
  borderRadius: 999,
  background: 'var(--bg-surface-2)',
  border: '1px solid var(--border-1)',
  color: 'var(--text-3)',
  cursor: 'pointer',
};

function JobStepPanel({
  def,
  step,
  stepIndex,
  onChange,
  customAgents,
}: {
  def: PipelineDef;
  step: JobStepDef;
  stepIndex: number;
  onChange: (d: PipelineDef) => void;
  customAgents: Array<{
    id: string;
    name: string;
    jobs: Array<{
      id: string;
      name: string;
      intents?: Array<{ id: string; outcomes?: string[]; hooks?: { stop: Array<{ artifact: string } | { action: string }> } }>;
    }>;
  }>;
}) {
  const { t } = useTranslation('pipelines');
  const ref = parseCustomJobRef(step.customJobRef);
  const agent = customAgents.find((a) => a.id === ref?.agentId);
  const job = agent?.jobs.find((j) => j.id === ref?.jobId);
  const intentsBroken = !!job && job.intents === undefined;
  // The pinned intent's declared contracts — outputs (5a) and verdict vocabulary.
  const pinnedIntent = step.intent && step.intent !== GENERAL_INTENT
    ? job?.intents?.find((i) => i.id === step.intent)
    : undefined;
  const expectedOutputGlobs = (pinnedIntent?.hooks?.stop ?? []).flatMap((h) => ('artifact' in h ? [h.artifact] : []));
  const pinnedOutcomes = pinnedIntent?.outcomes ?? [];

  const patch = (p: Partial<JobStepDef>) => onChange(updateStep(def, step.id, p));

  const directive = step.directive ?? '';
  const directiveRef = useRef<HTMLTextAreaElement>(null);
  const insertTemplateVar = (token: string) => {
    const el = directiveRef.current;
    const start = el?.selectionStart ?? directive.length;
    const end = el?.selectionEnd ?? directive.length;
    patch({ directive: `${directive.slice(0, start)}${token}${directive.slice(end)}` });
    if (el) {
      requestAnimationFrame(() => {
        el.focus();
        const caret = start + token.length;
        el.setSelectionRange(caret, caret);
      });
    }
  };

  // Browse is a convenience tree of the CURRENTLY SELECTED universal project —
  // never an authority claim (pins resolve against the ACTIVATION project at
  // dispatch). Free text stays the primary input.
  const selectedProject = useStore((s) => s.selectedProject);
  const projectType = useStore((s) => s.projectType);
  const pickerTree = useArtifactPickerTree();
  const [pickerOpen, setPickerOpen] = useState(false);
  const canBrowse = !!selectedProject && projectType === 'universal' && pickerTree.length > 0;

  const suggestions = useMemo(
    () => upstreamOutputSuggestions(def, step.id, customAgents),
    [def, step.id, customAgents],
  );
  // Grouped by producing STEP — the outputs are the step's, derived from its pinned intent.
  const suggestionGroups = useMemo(() => {
    const groups = new Map<string, typeof suggestions>();
    for (const sug of suggestions) {
      const group = groups.get(sug.sourceStepId) ?? [];
      group.push(sug);
      groups.set(sug.sourceStepId, group);
    }
    return [...groups.entries()];
  }, [suggestions]);

  // Upstream JOB steps (transitive needs closure) — the legal {{steps.*}} refs.
  const upstreamJobSteps = useMemo(() => {
    const indexOf = new Map(def.steps.map((s, i) => [s.id, i]));
    const upstream = new Set<string>();
    const start = indexOf.get(step.id);
    const queue = start === undefined ? [] : [...effectiveNeedsOf(def, start)];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (upstream.has(id)) continue;
      const i = indexOf.get(id);
      if (i === undefined) continue;
      upstream.add(id);
      queue.push(...effectiveNeedsOf(def, i));
    }
    return def.steps.filter((s) => upstream.has(s.id) && !isApprovalStep(s)).map((s) => s.id);
  }, [def, step.id]);

  return (
    <>
      <div>
        <FieldLabel required>{t('step.agent', 'Agent')}</FieldLabel>
        <AuroraSelect
          value={ref?.agentId ?? ''}
          onChange={(agentId) => {
            const nextAgent = customAgents.find((a) => a.id === agentId);
            const firstJob = nextAgent?.jobs[0]?.id ?? '';
            patch({ customJobRef: firstJob ? `${agentId}/${firstJob}` : '', intent: undefined, onMissingVerdict: undefined });
          }}
          placeholder={t('step.pickAgent', 'Choose an agent')}
          options={customAgents.map((a) => ({ value: a.id, label: a.name }))}
        />
      </div>
      <div>
        <FieldLabel required>{t('step.job', 'Job')}</FieldLabel>
        <AuroraSelect
          value={ref?.jobId ?? ''}
          onChange={(jobId) => {
            if (ref) patch({ customJobRef: `${ref.agentId}/${jobId}`, intent: undefined, onMissingVerdict: undefined });
          }}
          disabled={!agent}
          placeholder={t('step.pickJob', 'Choose a job')}
          options={(agent?.jobs ?? []).map((j) => ({ value: j.id, label: j.name }))}
        />
      </div>
      <div>
        <FieldLabel optional>{t('step.intent', 'Intent (max 1)')}</FieldLabel>
        {intentsBroken ? (
          <div style={{ fontSize: 11.5, color: 'var(--amber-500, #f59e0b)' }}>
            {t('step.intentsUnavailable', 'Intent catalog failed to parse — fix the definition in Agent Settings.')}
          </div>
        ) : (
          <AuroraSelect
            value={step.intent ?? ''}
            onChange={(v) => patch({ intent: v || undefined, onMissingVerdict: undefined })}
            disabled={!job}
            options={[
              { value: '', label: t('step.noIntent', 'None (job decides)') },
              ...((job?.intents ?? []).filter((i) => i.id !== GENERAL_INTENT).map((i) => ({ value: i.id, label: i.id }))),
            ]}
          />
        )}
      </div>
      {pinnedIntent && (
        <div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <FieldLabel optional>{t('step.expectedOutputs', 'Expected outputs')}</FieldLabel>
            <HintBadge
              isCompact
              label={t('step.expectedOutputs', 'Expected outputs')}
              tooltip={t('step.expectedOutputsHint', "The intent's declared stop-hook artifact contract — downstream steps can pin these globs as context.")}
            />
          </span>
          {expectedOutputGlobs.length > 0 ? (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {expectedOutputGlobs.map((glob) => (
                <span key={glob} style={{ ...varChipStyle, cursor: 'default' }}>{glob}</span>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
              {t('step.expectedOutputsNone', 'This intent declares no artifact contract — action-only or free-form output.')}
            </div>
          )}
        </div>
      )}
      {pinnedOutcomes.length > 0 && (
        <div>
          <FieldLabel optional>{t('step.onMissingVerdict', 'If the run seals no verdict')}</FieldLabel>
          <AuroraSelect
            value={step.onMissingVerdict ?? 'fail'}
            onChange={(v) => patch({ onMissingVerdict: v === 'fail' ? undefined : v })}
            options={[
              { value: 'fail', label: t('step.onMissingVerdictFail', 'Fail the step (default)') },
              ...pinnedOutcomes.map((o) => ({ value: o, label: t('step.onMissingVerdictAssume', 'Assume "{{o}}"', { o }) })),
            ]}
          />
        </div>
      )}
      <div>
        <FieldLabel optional>{t('step.directive', 'Directive')}</FieldLabel>
        <Textarea
          ref={directiveRef}
          value={directive}
          onChange={(e) => patch({ directive: e.target.value || undefined })}
          rows={5}
          placeholder={t('step.directivePlaceholder', 'What should this run do? Leave empty to run the default directive.')}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-3)' }}>
            {t('step.templateVars', 'Template variables')}
          </span>
          <HintBadge
            isCompact
            label={t('step.templateVars', 'Template variables')}
            tooltip={t('step.templateVarsHint', 'Substituted with the actual values when the schedule fires — insert at the cursor.')}
          />
          {PIPELINE_TEMPLATE_VARS.map((v) => {
            const meta = TEMPLATE_VAR_META[v];
            const chip = (
              <button onClick={() => insertTemplateVar(`{{${v}}}`)} style={varChipStyle}>
                {`{{${v}}}`}
              </button>
            );
            return meta ? (
              <Tooltip key={v} content={t(meta.labelKey, meta.labelDefault)} placement="top" trigger="hover">
                {chip}
              </Tooltip>
            ) : (
              <span key={v}>{chip}</span>
            );
          })}
          {upstreamJobSteps.flatMap((id) =>
            (['answer', 'artifacts'] as const).map((field) => (
              <Tooltip
                key={`${id}.${field}`}
                content={t(`step.stepOutput.${field}`, field === 'answer' ? 'Final answer of step "{{id}}"' : 'Output artifact paths of step "{{id}}"', { id })}
                placement="top"
                trigger="hover"
              >
                <button onClick={() => insertTemplateVar(`{{steps.${id}.${field}}}`)} style={varChipStyle}>
                  {`{{steps.${id}.${field}}}`}
                </button>
              </Tooltip>
            )),
          )}
        </div>
      </div>
      <div>
        <FieldLabel optional action={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            {canBrowse && (
              <button
                onClick={() => setPickerOpen(true)}
                style={{ background: 'none', border: 'none', color: 'var(--violet-500)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, fontSize: 11 }}
              >
                <FolderOpen size={11} /> {t('step.browse', 'Browse')}
              </button>
            )}
            <button
              onClick={() => patch({ context: [...(step.context ?? []), ''] })}
              style={{ background: 'none', border: 'none', color: 'var(--violet-500)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, fontSize: 11 }}
            >
              <Plus size={11} /> {t('step.addContext', 'Add')}
            </button>
          </span>
        }>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {t('step.context', 'Context pins (@ctx)')}
            <HintBadge
              isCompact
              label={t('step.context', 'Context pins (@ctx)')}
              tooltip={t('step.contextHint', 'Pins are resolved when this step fires — you can pre-pin a path an earlier step will create; needs-ordering means it is existence-checked only after that step finished.')}
            />
          </span>
        </FieldLabel>
        {suggestions.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
              <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-3)' }}>
                {t('step.upstreamOutputs', 'Upstream step outputs')}
              </span>
              <HintBadge
                isCompact
                label={t('step.upstreamOutputs', 'Upstream step outputs')}
                tooltip={t('step.upstreamOutputsHint', "Each glob is that step intent's stop-hook output contract — needs-ordering and stop-hook enforcement guarantee it exists before this step runs; it expands to the actual files at fire time.")}
              />
            </div>
            {suggestionGroups.map(([sourceStepId, group]) => (
              <div key={sourceStepId} style={{ marginBottom: 4 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', marginBottom: 3 }}>
                  {sourceStepId} · {group[0].intentId}
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {group.map((sug) => {
                    const pinned = (step.context ?? []).includes(sug.glob);
                    return (
                      <button
                        key={sug.glob}
                        disabled={pinned}
                        onClick={() => patch({ context: [...(step.context ?? []), sug.glob] })}
                        style={{ ...varChipStyle, opacity: pinned ? 0.45 : 1, cursor: pinned ? 'default' : 'pointer' }}
                      >
                        {sug.glob}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(step.context ?? []).map((path, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <AuroraInput
                  mono
                  value={path}
                  placeholder={t('step.contextPlaceholder', 'plan/spec.md')}
                  onChange={(v) => patch({ context: (step.context ?? []).map((c, j) => (j === i ? v : c)) })}
                />
              </div>
              <button
                aria-label={t('step.removeContext', 'Remove pin')}
                onClick={() => patch({ context: (step.context ?? []).filter((_, j) => j !== i) })}
                style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer' }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
        {pickerOpen && (
          <FileTreePicker
            isOpen={pickerOpen}
            onClose={() => setPickerOpen(false)}
            title={t('step.browseTitle', 'Attach context — {{project}}', { project: selectedProject })}
            eyebrow="CONTEXT"
            fileTree={pickerTree}
            initialSelected={(step.context ?? []).filter((c) => c.trim().length > 0)}
            onConfirm={(paths) => {
              patch({ context: paths });
              setPickerOpen(false);
            }}
          />
        )}
      </div>
      <div>
        <FieldLabel optional>{t('step.retry', 'Retry on failure')}</FieldLabel>
        <AuroraSelect
          value={String(step.retry?.max ?? 0)}
          onChange={(v) => {
            const max = Number(v);
            patch({ retry: max > 0 ? { max, ...(step.retry?.backoff && { backoff: step.retry.backoff }) } : undefined });
          }}
          options={[
            { value: '0', label: t('step.retryOff', 'Off (fail immediately)') },
            { value: '1', label: t('step.retryN', 'Up to {{n}} retry', { n: 1 }) },
            { value: '2', label: t('step.retryN', 'Up to {{n}} retries', { n: 2 }) },
            { value: '3', label: t('step.retryN', 'Up to {{n}} retries', { n: 3 }) },
          ]}
        />
        {step.retry && (
          <>
            <div style={{ marginTop: 6 }}>
              <AuroraInput
                mono
                value={step.retry.backoff ?? ''}
                placeholder={t('step.retryBackoffPlaceholder', '1m (backoff, {n}m|h|d)')}
                onChange={(v) => patch({ retry: { max: step.retry!.max, ...(v.trim() && { backoff: v.trim() }) } })}
              />
            </div>
            <div style={{ fontSize: 11, color: 'var(--amber-500, #f59e0b)', marginTop: 6 }}>
              {t('step.retryIdempotency', 'A retried run may repeat side effects — this intent must check what already completed before acting.')}
            </div>
          </>
        )}
      </div>
      <div>
        <FieldLabel optional>{t('step.timeout', 'Time limit per run')}</FieldLabel>
        <AuroraInput
          mono
          value={step.timeout?.after ?? ''}
          placeholder={t('step.timeoutPlaceholder', 'none — e.g. 30m, 2h')}
          onChange={(v) => patch({ timeout: v.trim() ? { after: v.trim() } : undefined })}
        />
      </div>
      <DependsOnField def={def} step={step} stepIndex={stepIndex} onChange={onChange} />
      {effectiveNeedsOf(def, stepIndex).length > 0 && <EdgeConditionField step={step} def={def} onChange={onChange} />}
    </>
  );
}

function GatePanel({ def, step, stepIndex, onChange }: { def: PipelineDef; step: ApprovalStepDef; stepIndex: number; onChange: (d: PipelineDef) => void }) {
  const { t } = useTranslation('pipelines');
  const patch = (p: Partial<ApprovalStepDef>) => onChange(updateStep(def, step.id, p));
  const timeoutValue = step.timeout?.after ?? '';

  return (
    <>
      <div>
        <FieldLabel required>{t('gate.prompt', 'Approval prompt')}</FieldLabel>
        <Textarea
          value={step.prompt}
          onChange={(e) => patch({ prompt: e.target.value })}
          rows={3}
          placeholder={t('gate.promptPlaceholder', 'What is being approved?')}
        />
      </div>
      <div>
        <FieldLabel>{t('gate.timeout', 'Timeout')}</FieldLabel>
        <AuroraSelect
          value={TIMEOUT_PRESETS.includes(timeoutValue) ? timeoutValue : timeoutValue === '' ? '' : 'custom'}
          onChange={(v) => {
            if (v === '') patch({ timeout: undefined });
            else if (v === 'custom') patch({ timeout: { after: timeoutValue || '48h', onTimeout: step.timeout?.onTimeout ?? 'reject' } });
            else patch({ timeout: { after: v, onTimeout: step.timeout?.onTimeout ?? 'reject' } });
          }}
          options={[
            { value: '', label: t('gate.noTimeout', 'Wait forever') },
            ...TIMEOUT_PRESETS.map((p) => ({ value: p, label: p })),
            { value: 'custom', label: t('gate.customTimeout', 'Custom…') },
          ]}
        />
        {step.timeout && !TIMEOUT_PRESETS.includes(step.timeout.after) && (
          <div style={{ marginTop: 6 }}>
            <AuroraInput
              mono
              value={step.timeout.after}
              placeholder="36h"
              onChange={(v) => patch({ timeout: { after: v, onTimeout: step.timeout?.onTimeout ?? 'reject' } })}
            />
          </div>
        )}
      </div>
      {step.timeout && (
        <div>
          <FieldLabel>{t('gate.onTimeout', 'On timeout')}</FieldLabel>
          <AuroraSelect
            value={step.timeout.onTimeout}
            onChange={(v) => patch({ timeout: { after: step.timeout!.after, onTimeout: v as 'reject' | 'approve' } })}
            options={[
              { value: 'reject', label: t('gate.timeoutReject', 'Reject (safe default)') },
              { value: 'approve', label: t('gate.timeoutApprove', 'Auto-approve') },
            ]}
          />
        </div>
      )}
      <div>
        <FieldLabel optional>{t('gate.remindAfter', 'Remind while unresolved')}</FieldLabel>
        <AuroraInput
          mono
          value={step.remindAfter ?? ''}
          placeholder={t('gate.remindAfterPlaceholder', 'none — e.g. 4h, 24h')}
          onChange={(v) => patch({ remindAfter: v.trim() || undefined })}
        />
      </div>
      <div>
        <FieldLabel>{t('gate.channels', 'Channels')}</FieldLabel>
        <div style={{ display: 'flex', gap: 6 }}>
          <span style={chipStyle(true)}>{t('gate.inApp', 'In-app')}</span>
          <span style={chipStyle(false)} title={t('gate.comingSoon', 'Coming soon')}>Slack</span>
          <span style={chipStyle(false)} title={t('gate.comingSoon', 'Coming soon')}>Email</span>
        </div>
      </div>
      <DependsOnField def={def} step={step} stepIndex={stepIndex} onChange={onChange} />
      {effectiveNeedsOf(def, stepIndex).length > 0 && <EdgeConditionField step={step} def={def} onChange={onChange} />}
    </>
  );
}

/**
 * Multi-select over the step's upstream edges (`needs`). Toggling any chip
 * materializes explicit needs for THIS step; "Default" resets to the implicit
 * previous-in-file-order edge. Descendants are excluded so a cycle cannot be
 * authored (the shared validator stays the backstop).
 */
function DependsOnField({ def, step, stepIndex, onChange }: { def: PipelineDef; step: JobStepDef | ApprovalStepDef; stepIndex: number; onChange: (d: PipelineDef) => void }) {
  const { t } = useTranslation('pipelines');
  const excluded = useMemo(() => descendantsOf(def, step.id), [def, step.id]);
  const candidates = def.steps.filter((s) => s.id !== step.id && !excluded.has(s.id));
  const effective = effectiveNeedsOf(def, stepIndex);
  const explicit = step.needs !== undefined;
  const isGate = isApprovalStep(step);

  const toggle = (id: string) => {
    const current = new Set(effective);
    if (current.has(id)) current.delete(id);
    else current.add(id);
    onChange(setStepNeeds(def, step.id, [...current]));
  };

  if (candidates.length === 0) return null;
  return (
    <div>
      <FieldLabel
        action={
          explicit ? (
            <button
              onClick={() => onChange(setStepNeeds(def, step.id, undefined))}
              style={{ background: 'none', border: 'none', color: 'var(--violet-500)', cursor: 'pointer', fontSize: 11 }}
            >
              {t('step.needsReset', 'Default (previous step)')}
            </button>
          ) : undefined
        }
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          {t('step.needs', 'Depends on')}
          <HintBadge
            isCompact
            label={t('step.needs', 'Depends on')}
            tooltip={t('step.needsHint', 'This step runs after every selected step finished. Pick several for a fan-in; several steps depending on one make a fan-out. No selection makes it a root.')}
          />
        </span>
      </FieldLabel>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {candidates.map((s) => (
          <button key={s.id} onClick={() => toggle(s.id)} style={{ ...chipStyle(effective.includes(s.id)), cursor: 'pointer' }}>
            {s.id}
          </button>
        ))}
      </div>
      {isGate && effective.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--amber-500, #f59e0b)', marginTop: 6 }}>
          {t('step.gateNeedsUpstream', 'An approval gate needs an upstream step — pick at least one.')}
        </div>
      )}
    </div>
  );
}

function EdgeConditionField({ def, step, onChange }: { def: PipelineDef; step: JobStepDef | ApprovalStepDef; onChange: (d: PipelineDef) => void }) {
  const { t } = useTranslation('pipelines');
  const customAgents = useStore((s) => s.accountAgents);
  // Verdict options: the upstream needs' pinned intents' declared outcomes.
  const verdictOptions = useMemo(() => {
    const idx = def.steps.findIndex((s) => s.id === step.id);
    if (idx < 0) return [];
    const out: string[] = [];
    for (const needId of effectiveNeedsOf(def, idx)) {
      const need = def.steps.find((s) => s.id === needId);
      if (!need || isApprovalStep(need) || !need.intent) continue;
      const ref = parseCustomJobRef(need.customJobRef);
      if (!ref) continue;
      const outcomes =
        customAgents
          .find((a) => a.id === ref.agentId)
          ?.jobs.find((j) => j.id === ref.jobId)
          ?.intents?.find((i) => i.id === need.intent)?.outcomes ?? [];
      for (const o of outcomes) if (!out.includes(o)) out.push(o);
    }
    return out;
  }, [def, step.id, customAgents]);
  return (
    <div>
      <FieldLabel>{t('step.on', 'Run when its dependencies…')}</FieldLabel>
      <AuroraSelect
        value={step.on ?? 'success'}
        onChange={(v) => onChange(updateStep(def, step.id, { on: v === 'success' ? undefined : (v as StepEdgeCondition) }))}
        options={[
          { value: 'success', label: t('step.onSuccess', 'Succeeded (default)') },
          { value: 'failure', label: t('step.onFailure', 'Failed (failure branch)') },
          { value: 'always', label: t('step.onAlways', 'Finished either way') },
          ...verdictOptions.map((o) => ({ value: `verdict:${o}`, label: t('step.onVerdict', 'Verdict: {{o}}', { o }) })),
        ]}
      />
    </div>
  );
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: 11,
    padding: '3px 10px',
    borderRadius: 999,
    border: '1px solid var(--border-1)',
    background: active ? 'color-mix(in srgb, var(--violet-500) 14%, transparent)' : 'var(--bg-surface-2)',
    color: active ? 'var(--violet-500)' : 'var(--text-3)',
    opacity: active ? 1 : 0.65,
  };
}

