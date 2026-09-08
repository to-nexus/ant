import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { CustomAgentSummary, JobStepDef, PipelineAdvisory, PipelineDef } from '@ant/shared';
import { FieldHint, FieldLabel } from '../../../ConfigEditor/aurora';
import { Textarea } from '../../../aurora';
import { HintBadge } from '../../../common/HintBadge';
import { Tooltip } from '../../../common/Tooltip';
import { updateStep } from '../../draft';
import { upstreamStepIds } from '../../upstreamOutputs';
import { resolveStepIdentity } from '../../stepIdentity';
import { STEP_OUTPUT_TOKENS, availableStaticTokens } from '../../templateTokens';
import { TokenChip } from '../chips';
import { TemplatePreview } from '../TemplatePreview';
import { AdvisoryHints } from '../AdvisoryHints';

export function DirectiveField({
  def,
  step,
  onChange,
  customAgents,
  advisories,
}: {
  def: PipelineDef;
  step: JobStepDef;
  onChange: (d: PipelineDef) => void;
  customAgents: CustomAgentSummary[];
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

  const statics = availableStaticTokens(def);
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
          {statics.map((spec) => (
            <Tooltip key={spec.name} content={`{{${spec.name}}} · ${t(spec.hintKey, spec.hintFallback)}`} placement="top" trigger="hover">
              <TokenChip onClick={() => insert(`{{${spec.name}}}`)}>
                <spec.icon size={11} />
                {t(spec.faceKey, spec.faceFallback)}
              </TokenChip>
            </Tooltip>
          ))}
        </div>
        {!def.on && (
          <FieldHint tone="muted">
            {t('step.templateVarsManualHint', 'A manual-only pipeline has no fire time and no previous fire — only the run id and upstream step results are available.')}
          </FieldHint>
        )}
        {upstreamJobs.map((id) => {
          const source = def.steps.find((s) => s.id === id);
          const name = source ? resolveStepIdentity(source, customAgents, t).primary : id;
          return (
            <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-3)' }} title={id}>
                {t('step.stepOutputGroup', 'From step "{{id}}"', { id: name })}
              </span>
              {Object.values(STEP_OUTPUT_TOKENS).map((spec) => (
                <Tooltip key={spec.name} content={`{{steps.${id}.${spec.name}}} · ${t(spec.hintKey, spec.hintFallback)}`} placement="top" trigger="hover">
                  <TokenChip onClick={() => insert(`{{steps.${id}.${spec.name}}}`)}>
                    <spec.icon size={11} />
                    {t(spec.faceKey, spec.faceFallback)}
                  </TokenChip>
                </Tooltip>
              ))}
            </div>
          );
        })}
      </div>
      <TemplatePreview text={directive} def={def} agents={customAgents} />
      <AdvisoryHints advisories={advisories} field="directive" />
    </div>
  );
}
