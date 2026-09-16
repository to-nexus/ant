/**
 * PipelineOriginChip — small badge marking a chat turn / kanban row as
 * pipeline-originated (`ChatUserTurnLine.pipeline` / job attribution). The
 * name is looked up from the loaded pipelines list; the id is the fallback
 * (the list is tab-lazy, and a deleted pipeline's turns must stay legible).
 * With a `runId` the chip also names the RUN — same label and hue as the
 * canvas chips, the run rows and the dock — so N live runs' turns in one flat
 * chat stay tellable apart (turns are never grouped by run: a run spans turns).
 */

import { useTranslation } from 'react-i18next';
import { Waypoints } from 'lucide-react';
import type { PipelineFiredBy, PipelineListEntry } from '@ant/shared';
import { useStore } from '@/domain/store';
import { FIRED_BY_ICON, runHue, runLabel, runTintFg } from './runIdentity';

export interface PipelineOriginChipProps {
  pipelineId: string;
  runId?: string;
  firedBy?: PipelineFiredBy;
  itemKey?: string;
}

export function PipelineOriginChip({ pipelineId, runId, firedBy, itemKey }: PipelineOriginChipProps) {
  const { t } = useTranslation('pipelines');
  const name = useStore(
    (s) => (s.pipelines as PipelineListEntry[]).find((p) => p.id === pipelineId)?.name ?? pipelineId,
  );
  const label = runId ? runLabel({ runId, itemKey }) : undefined;
  const accent = runId ? runTintFg(runHue(runId)) : undefined;
  const FiredIcon = firedBy ? FIRED_BY_ICON[firedBy] : undefined;
  return (
    <span
      title={
        label
          ? t('chip.firedByPipelineRun', 'Started by pipeline "{{name}}" — run {{run}}', { name, run: label })
          : t('chip.firedByPipeline', 'Started by pipeline "{{name}}"', { name })
      }
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
        maxWidth: 240,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        ...(accent ? { borderLeft: `3px solid ${accent}` } : {}),
      }}
    >
      <Waypoints size={10} style={{ flexShrink: 0 }} />
      {name}
      {label && (
        <>
          <span style={{ color: 'var(--text-3)', fontWeight: 500 }}>·</span>
          {FiredIcon && <FiredIcon size={9} style={{ flexShrink: 0, color: accent }} />}
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: accent }}>{label}</span>
        </>
      )}
    </span>
  );
}
