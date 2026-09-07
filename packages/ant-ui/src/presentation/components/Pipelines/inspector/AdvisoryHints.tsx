import type { PipelineAdvisory, PipelineAdvisoryField } from '@ant/shared';
import { FieldHint } from '../../ConfigEditor/aurora';

/** The step's save-time advisories anchored to one field, as warn-toned hints. */
export function AdvisoryHints({ advisories, field }: { advisories?: readonly PipelineAdvisory[]; field: PipelineAdvisoryField }) {
  const hits = (advisories ?? []).filter((a) => a.field === field);
  if (hits.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
      {hits.map((a) => (
        <FieldHint key={a.code + a.message} tone="warn">
          {a.message}
        </FieldHint>
      ))}
    </div>
  );
}
