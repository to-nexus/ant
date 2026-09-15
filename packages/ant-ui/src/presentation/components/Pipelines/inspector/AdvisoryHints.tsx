import { useTranslation } from 'react-i18next';
import type { PipelineAdvisory, PipelineAdvisoryField } from '@ant/shared';
import { FieldHint } from '../../ConfigEditor/aurora';

/**
 * The step's advisories anchored to one field. An OPEN finding is a warn-toned
 * hint; an acknowledged one (carrying `reason`) is muted and shows the reason —
 * the author already weighed it.
 */
export function AdvisoryHints({ advisories, field }: { advisories?: readonly (PipelineAdvisory & { reason?: string })[]; field: PipelineAdvisoryField }) {
  const { t } = useTranslation('pipelines');
  const hits = (advisories ?? []).filter((a) => a.field === field);
  if (hits.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
      {hits.map((a) =>
        a.reason ? (
          <FieldHint key={a.code + a.message} tone="muted">
            {t('advisory.acknowledgedHint', 'Acknowledged — {{reason}}', { reason: a.reason })}
          </FieldHint>
        ) : (
          <FieldHint key={a.code + a.message} tone="warn">
            {a.message}
          </FieldHint>
        ),
      )}
    </div>
  );
}
