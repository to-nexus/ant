/**
 * PipelinesPanel — the `pipelines` main-panel tab: resizable rail (approval
 * inbox + pipeline list) beside the n8n-style editor. Universal (workspace)
 * projects only; the panel splits by project kind itself (ActionsPanel
 * doctrine) instead of threading a store-level tab gate.
 */

import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { useResizableWidth } from '../AgentSettings/useResizableWidth';
import { PipelineRail } from './PipelineRail';
import { PipelineEditor } from './PipelineEditor';

export function PipelinesPanel() {
  const { t } = useTranslation('pipelines');
  const isUniversal = useStore((s) => s.projectType === 'universal');
  const { width, isResizing, startResize } = useResizableWidth({
    storageKey: 'ant-ui:pipelines-rail-width',
    min: 220,
    max: 420,
    defaultWidth: 280,
  });

  if (!isUniversal) {
    return (
      <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 13, textAlign: 'center', lineHeight: 1.7, whiteSpace: 'pre-line' }}>
        {t('panel.universalOnly', 'Pipelines schedule custom agent jobs.\nOpen a workspace (universal) project to use them.')}
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', background: 'var(--bg-canvas)', minHeight: 0, overflow: 'hidden' }}>
      <div className="relative shrink-0" style={{ width, borderRight: '1px solid var(--border-1)' }}>
        <PipelineRail />
        <div
          className="absolute top-0 right-0 h-full"
          style={{
            width: 4,
            marginRight: -2,
            zIndex: 10,
            cursor: 'col-resize',
            background: isResizing ? 'var(--violet-400)' : 'transparent',
          }}
          onMouseDown={startResize}
        />
      </div>
      <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        <PipelineEditor />
      </div>
    </div>
  );
}
