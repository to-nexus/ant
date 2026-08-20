/**
 * PipelineOriginChip — small badge marking a chat turn / kanban row as
 * pipeline-originated (`ChatUserTurnLine.pipeline` / job attribution). The
 * name is looked up from the loaded pipelines list; the id is the fallback
 * (the list is tab-lazy, and a deleted pipeline's turns must stay legible).
 */

import { useTranslation } from 'react-i18next';
import { Waypoints } from 'lucide-react';
import type { PipelineListEntry } from '@ant/shared';
import { useStore } from '@/domain/store';

export function PipelineOriginChip({ pipelineId }: { pipelineId: string }) {
  const { t } = useTranslation('pipelines');
  const name = useStore(
    (s) => (s.pipelines as PipelineListEntry[]).find((p) => p.id === pipelineId)?.name ?? pipelineId,
  );
  return (
    <span
      title={t('chip.firedByPipeline', 'Started by pipeline "{{name}}"', { name })}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 10,
        fontWeight: 700,
        padding: '1px 7px',
        borderRadius: 8,
        background: 'color-mix(in srgb, var(--violet-500) 12%, transparent)',
        color: 'var(--violet-400)',
        maxWidth: 160,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      <Waypoints size={10} style={{ flexShrink: 0 }} />
      {name}
    </span>
  );
}
