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

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Trash2, Plus } from 'lucide-react';
import {
  GENERAL_INTENT,
  isApprovalStep,
  parseCustomJobRef,
  type ApprovalStepDef,
  type JobStepDef,
  type PipelineDef,
  type StepEdgeCondition,
} from '@ant/shared';
import { useStore } from '@/domain/store';
import { AuroraSelect, AuroraInput, FieldLabel } from '../ConfigEditor/aurora';
import { Textarea, Button } from '../aurora';
import { CronBuilder } from './CronBuilder';
import { TRIGGER_NODE_ID, removeStep, updateSchedule, updateStep } from './draft';

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

function TriggerPanel({ def, onChange, onCronValidity }: { def: PipelineDef; onChange: (d: PipelineDef) => void; onCronValidity: (ok: boolean) => void }) {
  const { t } = useTranslation('pipelines');
  const sched = def.on.schedule;
  return (
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
  customAgents: Array<{ id: string; name: string; jobs: Array<{ id: string; name: string; intents?: Array<{ id: string }> }> }>;
}) {
  const { t } = useTranslation('pipelines');
  const ref = parseCustomJobRef(step.customJobRef);
  const agent = customAgents.find((a) => a.id === ref?.agentId);
  const job = agent?.jobs.find((j) => j.id === ref?.jobId);
  const intentsBroken = !!job && job.intents === undefined;

  const patch = (p: Partial<JobStepDef>) => onChange(updateStep(def, step.id, p));

  return (
    <>
      <div>
        <FieldLabel required>{t('step.agent', 'Agent')}</FieldLabel>
        <AuroraSelect
          value={ref?.agentId ?? ''}
          onChange={(agentId) => {
            const nextAgent = customAgents.find((a) => a.id === agentId);
            const firstJob = nextAgent?.jobs[0]?.id ?? '';
            patch({ customJobRef: firstJob ? `${agentId}/${firstJob}` : '', intent: undefined });
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
            if (ref) patch({ customJobRef: `${ref.agentId}/${jobId}`, intent: undefined });
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
            onChange={(v) => patch({ intent: v || undefined })}
            disabled={!job}
            options={[
              { value: '', label: t('step.noIntent', 'None (job decides)') },
              ...((job?.intents ?? []).filter((i) => i.id !== GENERAL_INTENT).map((i) => ({ value: i.id, label: `@${i.id}` }))),
            ]}
          />
        )}
      </div>
      <div>
        <FieldLabel required>{t('step.directive', 'Directive')}</FieldLabel>
        <Textarea
          value={step.directive}
          onChange={(e) => patch({ directive: e.target.value })}
          rows={5}
          placeholder={t('step.directivePlaceholder', 'What should this run do?')}
        />
        <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
          {['{{trigger.fireDate}}', '{{run.id}}'].map((v) => (
            <button
              key={v}
              onClick={() => patch({ directive: `${step.directive}${step.directive.endsWith(' ') || step.directive === '' ? '' : ' '}${v}` })}
              style={{
                fontSize: 10,
                fontFamily: 'monospace',
                padding: '2px 7px',
                borderRadius: 999,
                background: 'var(--bg-surface-2)',
                border: '1px solid var(--border-1)',
                color: 'var(--text-3)',
                cursor: 'pointer',
              }}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      <div>
        <FieldLabel optional action={
          <button
            onClick={() => patch({ context: [...(step.context ?? []), ''] })}
            style={{ background: 'none', border: 'none', color: 'var(--violet-500)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, fontSize: 11 }}
          >
            <Plus size={11} /> {t('step.addContext', 'Add')}
          </button>
        }>
          {t('step.context', 'Context pins (@ctx)')}
        </FieldLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(step.context ?? []).map((path, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <AuroraInput
                  mono
                  value={path}
                  placeholder="plan/spec.md"
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
      </div>
      {stepIndex > 0 && <EdgeConditionField step={step} def={def} onChange={onChange} />}
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
        <FieldLabel>{t('gate.channels', 'Channels')}</FieldLabel>
        <div style={{ display: 'flex', gap: 6 }}>
          <span style={chipStyle(true)}>{t('gate.inApp', 'In-app')}</span>
          <span style={chipStyle(false)} title={t('gate.comingSoon', 'Coming soon')}>Slack</span>
          <span style={chipStyle(false)} title={t('gate.comingSoon', 'Coming soon')}>Email</span>
        </div>
      </div>
      {stepIndex > 0 && <EdgeConditionField step={step} def={def} onChange={onChange} />}
    </>
  );
}

function EdgeConditionField({ def, step, onChange }: { def: PipelineDef; step: JobStepDef | ApprovalStepDef; onChange: (d: PipelineDef) => void }) {
  const { t } = useTranslation('pipelines');
  return (
    <div>
      <FieldLabel>{t('step.on', 'Run when the previous step…')}</FieldLabel>
      <AuroraSelect
        value={step.on ?? 'success'}
        onChange={(v) => onChange(updateStep(def, step.id, { on: v === 'success' ? undefined : (v as StepEdgeCondition) }))}
        options={[
          { value: 'success', label: t('step.onSuccess', 'Succeeded (default)') },
          { value: 'failure', label: t('step.onFailure', 'Failed (failure branch)') },
          { value: 'always', label: t('step.onAlways', 'Finished either way') },
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

