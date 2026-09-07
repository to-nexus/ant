import { useTranslation } from 'react-i18next';
import type { ApprovalStepDef, PipelineAdvisory, PipelineDef } from '@ant/shared';
import { AuroraInput, AuroraSelect, FieldHint, FieldLabel } from '../../ConfigEditor/aurora';
import { Textarea } from '../../aurora';
import { updateStep } from '../draft';
import { SectionHeading } from './SectionHeading';
import { ToggleChip } from './chips';
import { AdvisoryHints } from './AdvisoryHints';
import { StepIdField } from './fields/StepIdField';
import { DependsOnField } from './fields/DependsOnField';
import { EdgeConditionField } from './fields/EdgeConditionField';

const TIMEOUT_PRESETS = ['4h', '24h', '72h', '7d'];

/** Approval gate — prompt → wiring → policy (timeout, on-timeout, reminder, channels). */
export function GatePanel({
  def,
  step,
  stepIndex,
  onChange,
  advisories,
  onStepRenamed,
}: {
  def: PipelineDef;
  step: ApprovalStepDef;
  stepIndex: number;
  onChange: (d: PipelineDef) => void;
  advisories?: readonly PipelineAdvisory[];
  onStepRenamed?: (id: string) => void;
}) {
  const { t } = useTranslation('pipelines');
  const patch = (p: Partial<ApprovalStepDef>) => onChange(updateStep(def, step.id, p));
  const timeoutValue = step.timeout?.after ?? '';

  return (
    <>
      <div>
        <FieldLabel required>{t('gate.prompt', 'Approval prompt')}</FieldLabel>
        <Textarea value={step.prompt} onChange={(e) => patch({ prompt: e.target.value })} rows={3} placeholder={t('gate.promptPlaceholder', 'What is being approved?')} />
        <FieldHint spacing="above">{t('gate.promptHint', 'Say what happened upstream and what approving runs. The approver can only approve or reject — nothing they type reaches a step.')}</FieldHint>
      </div>
      <StepIdField def={def} step={step} onChange={onChange} onRenamed={onStepRenamed} />

      <SectionHeading>{t('inspector.section.wiring', 'Wiring')}</SectionHeading>
      <DependsOnField def={def} step={step} stepIndex={stepIndex} onChange={onChange} advisories={advisories} />
      <EdgeConditionField def={def} step={step} onChange={onChange} />

      <SectionHeading>{t('inspector.section.policy', 'Policy')}</SectionHeading>
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
              placeholder={t('gate.customTimeoutPlaceholder', 'e.g. 36h')}
              onChange={(v) => patch({ timeout: { after: v, onTimeout: step.timeout?.onTimeout ?? 'reject' } })}
            />
          </div>
        )}
        <AdvisoryHints advisories={advisories} field="timeout" />
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
        <AuroraInput mono value={step.remindAfter ?? ''} placeholder={t('gate.remindAfterPlaceholder', 'none — e.g. 4h, 24h')} onChange={(v) => patch({ remindAfter: v.trim() || undefined })} />
      </div>
      <div>
        <FieldLabel>{t('gate.channels', 'Channels')}</FieldLabel>
        <div style={{ display: 'flex', gap: 6 }}>
          <ToggleChip active disabled>{t('gate.inApp', 'In-app')}</ToggleChip>
          <ToggleChip active={false} disabled title={t('gate.comingSoon', 'Coming soon')}>Slack</ToggleChip>
          <ToggleChip active={false} disabled title={t('gate.comingSoon', 'Coming soon')}>Email</ToggleChip>
        </div>
        {/* Approvers are ACTIVATION data, never definition data — the definition
            is a shared template, so a name here would block reuse (A5-1). */}
        <FieldHint spacing="above">{t('gate.approversHint', 'Approvers are assigned per gate when the pipeline is activated on a project.')}</FieldHint>
      </div>
    </>
  );
}
