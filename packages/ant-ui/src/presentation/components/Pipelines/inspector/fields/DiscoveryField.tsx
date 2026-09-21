import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PIPELINE_FETCH_FIELD_NAME_PATTERN, PIPELINE_FETCH_MAX_FIELDS, isApprovalStep, type JobStepDef, type PipelineAdvisory, type PipelineDef } from '@ant/shared';
import { AuroraInput, AuroraSelect, FieldHint, FieldLabel } from '../../../ConfigEditor/aurora';
import { Chip, Toggle } from '../../../aurora';
import { HintBadge } from '../../../common/HintBadge';
import { setStepDiscovers } from '../../draft';
import { AdvisoryHints } from '../AdvisoryHints';

const FIELD_CHIP: React.CSSProperties = { height: 22, padding: '0 4px 0 8px', gap: 4, fontSize: 10.5, fontWeight: 500, fontFamily: 'var(--font-mono)' };

/**
 * The `discovers` contract of a job step: whether its turn fans the steps
 * after it out into one run per case, the field VOCABULARY those per-case
 * directives may reference, and how a turn that seals no `<cases>` is read.
 * HOW the cases are found is never declared here — it is the directive's
 * prose — so the only inputs are the field names and the missing policy.
 */
export function DiscoveryField({
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
  const [draft, setDraft] = useState('');
  const discovers = step.discovers;
  const fields = discovers?.fields ?? [];
  const other = def.steps.find((s) => !isApprovalStep(s) && s.discovers !== undefined && s.id !== step.id);
  const isLast = def.steps[def.steps.length - 1]?.id === step.id;
  const hasFetch = def.on?.fetch !== undefined;
  const blocked = other !== undefined || hasFetch;

  const trimmed = draft.trim();
  const draftError =
    trimmed.length === 0
      ? null
      : trimmed === 'key'
        ? t('step.discovery.fieldReserved', '"key" is reserved — every case carries its key')
        : !PIPELINE_FETCH_FIELD_NAME_PATTERN.test(trimmed)
          ? t('step.discovery.fieldInvalid', 'Field names are lowerCamel identifiers (e.g. merchantId)')
          : fields.includes(trimmed)
            ? t('step.discovery.fieldDuplicate', 'Already declared')
            : fields.length >= PIPELINE_FETCH_MAX_FIELDS
              ? t('step.discovery.fieldsMax', 'At most {{n}} fields', { n: PIPELINE_FETCH_MAX_FIELDS })
              : null;
  const addField = () => {
    if (trimmed.length === 0 || draftError) return;
    onChange(setStepDiscovers(def, step.id, { fields: [...fields, trimmed] }));
    setDraft('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-1)' }}>
          {t('step.discovery.toggle', 'This step discovers cases')}
          <HintBadge
            isCompact
            label={t('step.discovery.toggle', 'This step discovers cases')}
            tooltip={t('step.discovery.toggleHint', 'Its turn seals a list of cases and every step after it runs once per case, side by side up to the concurrency cap. How the cases are found is what the directive says.')}
          />
        </span>
        <Toggle
          size="sm"
          checked={discovers !== undefined}
          disabled={blocked && discovers === undefined}
          aria-label={t('step.discovery.toggle', 'This step discovers cases')}
          onChange={(next) => onChange(setStepDiscovers(def, step.id, next ? {} : null))}
        />
      </div>
      {other && discovers === undefined && (
        <FieldHint tone="muted">{t('step.discovery.otherStep', 'Only one step per pipeline discovers cases — "{{id}}" already does. Chain a second pipeline with an upstream trigger instead.', { id: other.id })}</FieldHint>
      )}
      {hasFetch && discovers === undefined && (
        <FieldHint tone="muted">{t('step.discovery.fetchPipeline', 'A fetch pipeline already runs once per fetched item — there is no second fan-out to declare.')}</FieldHint>
      )}
      {discovers !== undefined && (
        <>
          {isLast && <FieldHint tone="warn">{t('step.discovery.lastStep', 'Nothing runs per case yet — add at least one step after this one.')}</FieldHint>}
          <div>
            <FieldLabel optional>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                {t('step.discovery.fields', 'Case fields')}
                <HintBadge
                  isCompact
                  label={t('step.discovery.fields', 'Case fields')}
                  tooltip={t('step.discovery.fieldsHint', 'The names each case may carry besides its key — {{trigger.item.<name>}} in the per-case directives. The key is always present and never declared.')}
                />
              </span>
            </FieldLabel>
            {fields.length > 0 && (
              <div data-discovery-fields style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                {fields.map((f) => (
                  <Chip key={f} style={FIELD_CHIP} title={`{{trigger.item.${f}}}`} onClose={() => onChange(setStepDiscovers(def, step.id, { fields: fields.filter((x) => x !== f) }))}>
                    {f}
                  </Chip>
                ))}
              </div>
            )}
            <AuroraInput
              mono
              value={draft}
              hasError={draftError !== null}
              placeholder={t('step.discovery.fieldPlaceholder', 'amount — Enter to add')}
              onChange={setDraft}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addField();
                }
              }}
            />
            {draftError ? (
              <FieldHint tone="error" spacing="above">
                {draftError}
              </FieldHint>
            ) : fields.length === 0 ? (
              <FieldHint tone="muted" spacing="above">
                {t('step.discovery.fieldsEmpty', 'No fields — each case run learns its key only.')}
              </FieldHint>
            ) : null}
          </div>
          <div>
            <FieldLabel optional>{t('step.discovery.onMissing', 'If the turn seals no case list')}</FieldLabel>
            <AuroraSelect
              value={discovers.onMissing ?? 'fail'}
              onChange={(v) => onChange(setStepDiscovers(def, step.id, { onMissing: v === 'complete' ? 'complete' : 'fail' }))}
              options={[
                { value: 'fail', label: t('step.discovery.onMissingFail', 'Fail the step (default — retried like a missing verdict)') },
                { value: 'complete', label: t('step.discovery.onMissingComplete', 'Treat as nothing to do — the run completes') },
              ]}
            />
          </div>
          <AdvisoryHints advisories={advisories} field="discovers" />
        </>
      )}
    </div>
  );
}
