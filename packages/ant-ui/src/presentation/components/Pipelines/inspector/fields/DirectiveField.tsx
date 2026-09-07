import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { JobStepDef, PipelineAdvisory, PipelineDef } from '@ant/shared';
import { FieldHint, FieldLabel } from '../../../ConfigEditor/aurora';
import { Textarea } from '../../../aurora';
import { HintBadge } from '../../../common/HintBadge';
import { Tooltip } from '../../../common/Tooltip';
import { updateStep } from '../../draft';
import { upstreamStepIds } from '../../upstreamOutputs';
import { TokenChip } from '../chips';
import { AdvisoryHints } from '../AdvisoryHints';

/**
 * Static variables a directive may use, given what the definition's trigger
 * actually provides. A manual-only pipeline has no fire time and no previous
 * fire; showing those chips is what made "template variables" look useless.
 */
export function staticTemplateVars(def: PipelineDef): string[] {
  const out = ['run.id'];
  if (def.on) out.unshift('trigger.fireDate', 'trigger.fireEpoch');
  if (def.on?.schedule) out.push('run.prevSuccess.fireDate', 'run.prevSuccess.fireEpoch');
  return out;
}

const VAR_LABEL: Record<string, [string, string]> = {
  'trigger.fireDate': ['step.templateVar.fireDate', 'Fire time (ISO)'],
  'trigger.fireEpoch': ['step.templateVar.fireEpoch', 'Fire time (epoch ms)'],
  'run.id': ['step.templateVar.runId', 'Run id'],
  'run.prevSuccess.fireDate': ['step.templateVar.prevSuccessFireDate', 'Previous successful run (ISO) — empty on the first run'],
  'run.prevSuccess.fireEpoch': ['step.templateVar.prevSuccessFireEpoch', 'Previous successful run (epoch ms) — empty on the first run'],
};

export function DirectiveField({
  def,
  step,
  onChange,
  advisories,
}: {
  def: PipelineDef;
  step: JobStepDef;
  onChange: (d: PipelineDef) => void;
  advisories?: readonly PipelineAdvisory[];
}) {
  const { t } = useTranslation('pipelines');
  const directive = step.directive ?? '';
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (token: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? directive.length;
    const end = el?.selectionEnd ?? directive.length;
    onChange(updateStep(def, step.id, { directive: `${directive.slice(0, start)}${token}${directive.slice(end)}` }));
    if (el) {
      requestAnimationFrame(() => {
        el.focus();
        const caret = start + token.length;
        el.setSelectionRange(caret, caret);
      });
    }
  };

  const statics = staticTemplateVars(def);
  const upstreamJobs = useMemo(() => upstreamStepIds(def, step.id, { jobsOnly: true }), [def, step.id]);

  return (
    <div>
      <FieldLabel optional>{t('step.directive', 'Directive')}</FieldLabel>
      <Textarea
        ref={ref}
        value={directive}
        onChange={(e) => onChange(updateStep(def, step.id, { directive: e.target.value || undefined }))}
        rows={5}
        placeholder={t('step.directivePlaceholder', 'What should this run do? Leave empty to run the default directive.')}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-3)' }}>{t('step.templateVars', 'Template variables')}</span>
          <HintBadge
            isCompact
            label={t('step.templateVars', 'Template variables')}
            tooltip={t('step.templateVarsHint', 'Substituted with the actual values when the run is dispatched — inserted at the cursor.')}
          />
          {statics.map((v) => {
            const [key, fallback] = VAR_LABEL[v];
            return (
              <Tooltip key={v} content={t(key, fallback)} placement="top" trigger="hover">
                <TokenChip onClick={() => insert(`{{${v}}}`)}>{`{{${v}}}`}</TokenChip>
              </Tooltip>
            );
          })}
        </div>
        {!def.on && (
          <FieldHint tone="muted">
            {t('step.templateVarsManualHint', 'A manual-only pipeline has no fire time and no previous fire — only the run id and upstream step results are available.')}
          </FieldHint>
        )}
        {upstreamJobs.map((id) => (
          <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-3)' }}>{t('step.stepOutputGroup', 'From step "{{id}}"', { id })}</span>
            <Tooltip content={t('step.stepOutput.answer', 'That step\'s final answer, as text')} placement="top" trigger="hover">
              <TokenChip onClick={() => insert(`{{steps.${id}.answer}}`)}>{`{{steps.${id}.answer}}`}</TokenChip>
            </Tooltip>
            <Tooltip content={t('step.stepOutput.artifacts', 'The files that step\'s job wrote — this run\'s own, one path per line')} placement="top" trigger="hover">
              <TokenChip onClick={() => insert(`{{steps.${id}.artifacts}}`)}>{`{{steps.${id}.artifacts}}`}</TokenChip>
            </Tooltip>
          </div>
        ))}
      </div>
      <AdvisoryHints advisories={advisories} field="directive" />
    </div>
  );
}
