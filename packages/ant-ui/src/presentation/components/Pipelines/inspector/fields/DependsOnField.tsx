import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { isApprovalStep, type PipelineAdvisory, type PipelineDef, type PipelineStepDef } from '@ant/shared';
import { FieldHint, FieldLabel } from '../../../ConfigEditor/aurora';
import { Badge } from '../../../aurora';
import { HintBadge } from '../../../common/HintBadge';
import { descendantsOf, effectiveNeedsOf, setStepNeeds } from '../../draft';
import { ToggleChip } from '../chips';
import { AdvisoryHints } from '../AdvisoryHints';

/**
 * Multi-select over the step's upstream edges (`needs`). Toggling any chip
 * materializes explicit needs for THIS step; "Default" resets to the implicit
 * previous-in-file-order edge, and an inherited edge says so — a person must
 * be able to tell wiring they chose from wiring the file order implies.
 * Descendants are excluded so a cycle cannot be authored.
 */
export function DependsOnField({
  def,
  step,
  stepIndex,
  onChange,
  advisories,
}: {
  def: PipelineDef;
  step: PipelineStepDef;
  stepIndex: number;
  onChange: (d: PipelineDef) => void;
  advisories?: readonly PipelineAdvisory[];
}) {
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
          ) : (
            <Badge size="sm" tone="neutral">{t('step.needsImplicit', 'Inherited: previous step')}</Badge>
          )
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
          <ToggleChip key={s.id} active={effective.includes(s.id)} onClick={() => toggle(s.id)}>
            {s.id}
          </ToggleChip>
        ))}
      </div>
      {isGate && effective.length === 0 && (
        <FieldHint tone="warn" spacing="above">{t('step.gateNeedsUpstream', 'An approval gate needs an upstream step — pick at least one.')}</FieldHint>
      )}
      <AdvisoryHints advisories={advisories} field="needs" />
    </div>
  );
}
