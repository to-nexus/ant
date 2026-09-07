/**
 * PipelineHeader — breadcrumb (Pipelines › name), scope badge, the
 * publication lifecycle (draft ⇄ published — the segment IS the enable/disable
 * control), the activation count, and the Design ⇄ Execution toggle. Save /
 * Discard live in the ChangedBar below it.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PencilRuler, PlayCircle, Waypoints } from 'lucide-react';
import type { PipelineDef, PipelineListEntry } from '@ant/shared';
import { useStore } from '@/domain/store';
import { Badge, BoardViewModeToggle } from '../aurora';
import { Crumb, CRUMB_SEPARATOR } from '../shared/Crumb';
import { usePipelineDiscardGuard } from './usePipelineDiscardGuard';
import { decideLifecycle } from './lifecycle';
import { LifecycleSegment } from './LifecycleSegment';

export type PipelinePanelView = 'editor' | 'execution';

export function PipelineHeader({
  draft,
  entry,
  draftIsNew,
  readonly,
  enabled,
  definitionDirty,
  view,
  onViewChange,
}: {
  draft: PipelineDef;
  entry: PipelineListEntry | undefined;
  draftIsNew: boolean;
  readonly: boolean;
  enabled: boolean;
  definitionDirty: boolean;
  view: PipelinePanelView;
  onViewChange: (view: PipelinePanelView) => void;
}) {
  const { t } = useTranslation('pipelines');
  const selectPipeline = useStore((s) => s.selectPipeline);
  const enablePipelineById = useStore((s) => s.enablePipelineById);
  const disablePipelineById = useStore((s) => s.disablePipelineById);
  const guard = usePipelineDiscardGuard();
  const [busy, setBusy] = useState(false);

  const activationCount = entry?.activations.length ?? 0;
  const decision = decideLifecycle({ draftIsNew, readonly, enabled, definitionDirty, activationCount });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid var(--border-1)', background: 'var(--bg-surface)', flexWrap: 'wrap' }}>
      <Crumb icon={Waypoints} label={t('header.root', 'Pipelines')} current={false} onClick={() => guard(() => void selectPipeline(null))} />
      {CRUMB_SEPARATOR}
      <Crumb icon={Waypoints} label={draft.name || t('editor.namePlaceholder', 'Pipeline name')} current />
      {!draftIsNew && entry && (
        <Badge tone={entry.scope === 'user' ? 'brand' : 'info'} size="sm">
          {entry.scope === 'user' ? t('header.scopeUser', 'Mine') : t('header.scopeOrg', 'Organization')}
        </Badge>
      )}
      {decision.badgeOnly ? (
        <Badge tone={decision.block === 'unsaved' ? 'warning' : 'neutral'} size="sm">
          {decision.block === 'unsaved' ? t('rail.unsaved', 'Unsaved') : t('rail.readonly', 'Read-only')}
        </Badge>
      ) : (
        entry && (
          <LifecycleSegment
            decision={decision}
            busy={busy}
            activationCount={activationCount}
            onChange={async (next) => {
              setBusy(true);
              try {
                if (next === 'published') await enablePipelineById(entry.id);
                else await disablePipelineById(entry.id);
              } finally {
                setBusy(false);
              }
            }}
          />
        )
      )}
      {activationCount > 0 && (
        <Badge tone="info" size="sm" title={entry?.activations.map((a) => `${a.projectId} (${a.activatedBy})`).join('\n')}>
          {t('execution.activationsCount', '{{n}} project(s)', { n: activationCount })}
        </Badge>
      )}
      <div style={{ flex: 1 }} />
      <BoardViewModeToggle<PipelinePanelView>
        value={view}
        onChange={onViewChange}
        options={[
          { id: 'editor', label: t('views.wiring', 'Design'), icon: PencilRuler },
          { id: 'execution', label: t('views.execution', 'Execution'), icon: PlayCircle },
        ]}
        ariaLabel={t('editor.viewMode', 'Pipeline view')}
      />
    </div>
  );
}
