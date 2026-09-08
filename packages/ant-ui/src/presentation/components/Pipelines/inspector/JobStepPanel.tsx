import { useTranslation } from 'react-i18next';
import { GENERAL_INTENT, parseCustomJobRef, type CustomAgentSummary, type JobStepDef, type PipelineAdvisory, type PipelineDef } from '@ant/shared';
import { AuroraInput, AuroraSelect, FieldHint, FieldLabel } from '../../ConfigEditor/aurora';
import { HintBadge } from '../../common/HintBadge';
import { updateStep } from '../draft';
import { SectionHeading } from './SectionHeading';
import { TokenChip } from './chips';
import { withCurrentValue } from './selectOptions';
import { StepIdField } from './fields/StepIdField';
import { DependsOnField } from './fields/DependsOnField';
import { EdgeConditionField } from './fields/EdgeConditionField';
import { DirectiveField } from './fields/DirectiveField';
import { ContextPinsField } from './fields/ContextPinsField';
import { AdvisoryHints } from './AdvisoryHints';

/**
 * Job step — identity → wiring → work → inputs → policy. Cascade gotchas
 * honored: `jobs[].intents === undefined` means "catalog failed to parse"
 * (a warning, NOT "no intents"), and `CustomIntentDef.infer` is prompt text —
 * never used as UI copy.
 */
export function JobStepPanel({
  def,
  step,
  stepIndex,
  onChange,
  customAgents,
  advisories,
  onStepRenamed,
}: {
  def: PipelineDef;
  step: JobStepDef;
  stepIndex: number;
  onChange: (d: PipelineDef) => void;
  customAgents: CustomAgentSummary[];
  advisories?: readonly PipelineAdvisory[];
  onStepRenamed?: (id: string) => void;
}) {
  const { t } = useTranslation('pipelines');
  const ref = parseCustomJobRef(step.customJobRef);
  const agent = customAgents.find((a) => a.id === ref?.agentId);
  const job = agent?.jobs.find((j) => j.id === ref?.jobId);
  const intentsBroken = !!job && job.intents === undefined;
  const pinnedIntent = step.intent && step.intent !== GENERAL_INTENT ? job?.intents?.find((i) => i.id === step.intent) : undefined;
  const expectedOutputGlobs = (pinnedIntent?.hooks?.stop ?? []).flatMap((h) => ('artifact' in h ? [h.artifact] : []));
  const pinnedOutcomes = pinnedIntent?.outcomes ?? [];
  const patch = (p: Partial<JobStepDef>) => onChange(updateStep(def, step.id, p));
  const unknown = (v: string) => t('inspector.unknownValue', 'Unknown value: {{v}}', { v });

  const agentSel = withCurrentValue(customAgents.map((a) => ({ value: a.id, label: a.name })), ref?.agentId, unknown);
  const jobSel = withCurrentValue((agent?.jobs ?? []).map((j) => ({ value: j.id, label: j.name })), ref?.jobId, unknown);
  const intentSel = withCurrentValue(
    [
      { value: '', label: t('step.noIntent', 'None (job decides)') },
      ...((job?.intents ?? []).filter((i) => i.id !== GENERAL_INTENT).map((i) => ({ value: i.id, label: i.id }))),
    ],
    step.intent ?? '',
    unknown,
  );

  return (
    <>
      <SectionHeading>{t('inspector.section.identity', 'Identity')}</SectionHeading>
      <div>
        <FieldLabel required>{t('step.agent', 'Agent')}</FieldLabel>
        <AuroraSelect
          value={ref?.agentId ?? ''}
          hasError={agentSel.hasError}
          onChange={(agentId) => {
            const nextAgent = customAgents.find((a) => a.id === agentId);
            const firstJob = nextAgent?.jobs[0]?.id ?? '';
            patch({ customJobRef: firstJob ? `${agentId}/${firstJob}` : '', intent: undefined, onMissingVerdict: undefined });
          }}
          placeholder={t('step.pickAgent', 'Choose an agent')}
          options={agentSel.options}
        />
      </div>
      <div>
        <FieldLabel required>{t('step.job', 'Job')}</FieldLabel>
        <AuroraSelect
          value={ref?.jobId ?? ''}
          hasError={jobSel.hasError}
          onChange={(jobId) => {
            if (ref) patch({ customJobRef: `${ref.agentId}/${jobId}`, intent: undefined, onMissingVerdict: undefined });
          }}
          disabled={!agent}
          placeholder={t('step.pickJob', 'Choose a job')}
          options={jobSel.options}
        />
      </div>
      <div>
        <FieldLabel optional>{t('step.intent', 'Intent (max 1)')}</FieldLabel>
        {intentsBroken ? (
          <FieldHint tone="warn">{t('step.intentsUnavailable', 'Intent catalog failed to parse — fix the definition in Agent Settings.')}</FieldHint>
        ) : (
          <AuroraSelect
            value={step.intent ?? ''}
            hasError={intentSel.hasError}
            onChange={(v) => patch({ intent: v || undefined, onMissingVerdict: undefined })}
            disabled={!job}
            options={intentSel.options}
          />
        )}
        {pinnedIntent && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-3)' }}>{t('step.expectedOutputs', 'Expected outputs')}</span>
            <HintBadge
              isCompact
              label={t('step.expectedOutputs', 'Expected outputs')}
              tooltip={t('step.expectedOutputsHint', "The intent's declared stop-hook artifact contract — downstream steps can pin these globs as context.")}
            />
            {expectedOutputGlobs.length > 0 ? (
              expectedOutputGlobs.map((glob) => <TokenChip key={glob} disabled>{glob}</TokenChip>)
            ) : (
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{t('step.expectedOutputsNone', 'This intent declares no artifact contract — action-only or free-form output.')}</span>
            )}
          </div>
        )}
      </div>
      <StepIdField def={def} step={step} onChange={onChange} onRenamed={onStepRenamed} />

      <SectionHeading>{t('inspector.section.wiring', 'Wiring')}</SectionHeading>
      <DependsOnField def={def} step={step} stepIndex={stepIndex} onChange={onChange} advisories={advisories} />
      <EdgeConditionField def={def} step={step} onChange={onChange} />

      <SectionHeading>{t('inspector.section.work', 'Work')}</SectionHeading>
      <DirectiveField def={def} step={step} onChange={onChange} customAgents={customAgents} advisories={advisories} />

      <SectionHeading>{t('inspector.section.inputs', 'Inputs')}</SectionHeading>
      <ContextPinsField def={def} step={step} onChange={onChange} customAgents={customAgents} advisories={advisories} />

      <SectionHeading>{t('inspector.section.policy', 'Policy')}</SectionHeading>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
            <AuroraInput
              mono
              value={step.retry.backoff ?? ''}
              placeholder={t('step.retryBackoffPlaceholder', '1m (backoff, {n}m|h|d)')}
              onChange={(v) => patch({ retry: { max: step.retry!.max, ...(v.trim() && { backoff: v.trim() }) } })}
            />
            <FieldHint tone="warn">{t('step.retryIdempotency', 'A retried run may repeat side effects — this intent must check what already completed before acting.')}</FieldHint>
          </div>
        )}
      </div>
      <div>
        <FieldLabel optional>{t('step.timeout', 'Time limit per run')}</FieldLabel>
        <AuroraInput mono value={step.timeout?.after ?? ''} placeholder={t('step.timeoutPlaceholder', 'none — e.g. 30m, 2h')} onChange={(v) => patch({ timeout: v.trim() ? { after: v.trim() } : undefined })} />
      </div>
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
          <AdvisoryHints advisories={advisories} field="onMissingVerdict" />
        </div>
      )}
    </>
  );
}
