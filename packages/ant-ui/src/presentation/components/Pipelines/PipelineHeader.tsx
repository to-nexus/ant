/**
 * PipelineHeader — orientation only, no controls: breadcrumb (Pipelines ›
 * name), scope badge, status pill, and the Wiring ⇄ Execution toggle. Save /
 * Discard live in the ChangedBar below it; every other action lives in the
 * settings panel.
 */

import { useTranslation } from 'react-i18next';
import { PencilRuler, PlayCircle, Waypoints } from 'lucide-react';
import type { PipelineDef, PipelineListEntry } from '@ant/shared';
import { useStore } from '@/domain/store';
import { Badge, BoardViewModeToggle } from '../aurora';
import { StatusPill } from '../ConfigEditor/aurora';
import { Crumb, CRUMB_SEPARATOR } from '../shared/Crumb';
import { usePipelineDiscardGuard } from './usePipelineDiscardGuard';

export type PipelinePanelView = 'editor' | 'execution';

export function PipelineHeader({
  draft,
  entry,
  draftIsNew,
  readonly,
  enabled,
  view,
  onViewChange,
}: {
  draft: PipelineDef;
  entry: PipelineListEntry | undefined;
  draftIsNew: boolean;
  readonly: boolean;
  enabled: boolean;
  view: PipelinePanelView;
  onViewChange: (view: PipelinePanelView) => void;
}) {
  const { t } = useTranslation('pipelines');
  const selectPipeline = useStore((s) => s.selectPipeline);
  const guard = usePipelineDiscardGuard();

  const status = draftIsNew
    ? { state: 'warning' as const, label: t('rail.unsaved', 'Unsaved') }
    : readonly
      ? { state: 'not-configured' as const, label: t('rail.readonly', 'readonly') }
      : enabled
        ? { state: 'configured' as const, label: t('rail.enabled', 'Enabled') }
        : { state: 'not-configured' as const, label: t('rail.draft', 'Disabled') };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 14px',
        borderBottom: '1px solid var(--border-1)',
        background: 'var(--bg-surface)',
        flexWrap: 'wrap',
      }}
    >
      <Crumb icon={Waypoints} label={t('header.root', 'Pipelines')} current={false} onClick={() => guard(() => void selectPipeline(null))} />
      {CRUMB_SEPARATOR}
      <Crumb icon={Waypoints} label={draft.name || t('editor.namePlaceholder', 'Pipeline name')} current />
      {!draftIsNew && entry && (
        <Badge tone={entry.scope === 'user' ? 'brand' : 'info'} size="sm">
          {entry.scope === 'user' ? t('header.scopeUser', 'My') : t('header.scopeOrg', 'Organization')}
        </Badge>
      )}
      <StatusPill state={status.state} label={status.label} />
      <div style={{ flex: 1 }} />
      <BoardViewModeToggle<PipelinePanelView>
        value={view}
        onChange={onViewChange}
        options={[
          { id: 'editor', label: t('views.wiring', 'Wiring'), icon: PencilRuler },
          { id: 'execution', label: t('views.execution', 'Execution'), icon: PlayCircle },
        ]}
        ariaLabel={t('editor.viewMode', 'Pipeline view')}
      />
    </div>
  );
}
