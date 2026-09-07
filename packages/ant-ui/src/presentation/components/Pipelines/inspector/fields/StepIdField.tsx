import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PipelineDef, PipelineStepDef } from '@ant/shared';
import { AuroraInput, FieldHint, FieldLabel } from '../../../ConfigEditor/aurora';
import { HintBadge } from '../../../common/HintBadge';
import { STEP_ID_PATTERN, renameStep } from '../../draft';

/**
 * The step id is the handle `needs` chips and `{{steps.<id>.*}}` refer to, so
 * it is authored, not generated. A valid, unique id renames live (every
 * reference follows); an invalid or taken id shows the error and changes
 * nothing.
 */
export function StepIdField({
  def,
  step,
  onChange,
  onRenamed,
}: {
  def: PipelineDef;
  step: PipelineStepDef;
  onChange: (d: PipelineDef) => void;
  onRenamed?: (id: string) => void;
}) {
  const { t } = useTranslation('pipelines');
  const [value, setValue] = useState(step.id);
  useEffect(() => setValue(step.id), [step.id]);
  const trimmed = value.trim();
  const invalid = !STEP_ID_PATTERN.test(trimmed);
  const taken = trimmed !== step.id && def.steps.some((s) => s.id === trimmed);
  return (
    <div>
      <FieldLabel required>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          {t('step.stepId', 'Step id')}
          <HintBadge
            isCompact
            label={t('step.stepId', 'Step id')}
            tooltip={t('step.stepIdHint', 'The handle other steps depend on and directives reference as {{steps.<id>.answer}} — lowercase letters, digits, hyphens. Renaming updates every reference.')}
          />
        </span>
      </FieldLabel>
      <AuroraInput
        mono
        value={value}
        hasError={invalid || taken}
        onChange={(v) => {
          setValue(v);
          const next = v.trim();
          if (next !== step.id && STEP_ID_PATTERN.test(next) && !def.steps.some((s) => s.id === next)) {
            onChange(renameStep(def, step.id, next));
            onRenamed?.(next);
          }
        }}
      />
      {invalid && <FieldHint tone="warn" spacing="above">{t('step.stepIdInvalid', 'Lowercase letters, digits and hyphens only, starting with a letter or digit.')}</FieldHint>}
      {!invalid && taken && <FieldHint tone="warn" spacing="above">{t('step.stepIdTaken', 'Another step already uses this id.')}</FieldHint>}
    </div>
  );
}
