/**
 * PipelinesPanel — the `pipelines` main-panel tab: resizable rail (approval
 * inbox + pipeline list) beside the three-view workspace (editor / execution
 * / run history). ACCOUNT-scoped: definitions are cross-project, so the panel
 * renders regardless of the selected project; the project binding happens in
 * the Execution view's activation flow.
 */

import { useEffect } from 'react';
import { useStore } from '@/domain/store';
import { useResizableWidth } from '../AgentSettings/useResizableWidth';
import { PipelineRail } from './PipelineRail';
import { PipelineWorkspace } from './PipelineWorkspace';

export function PipelinesPanel() {
  const loadPipelines = useStore((s) => s.loadPipelines);
  const { width, isResizing, startResize } = useResizableWidth({
    storageKey: 'ant-ui:pipelines-rail-width',
    min: 220,
    max: 420,
    defaultWidth: 280,
  });

  // Lazy account-scoped bootstrap — the tab is the only consumer of the list.
  useEffect(() => {
    void loadPipelines();
  }, [loadPipelines]);

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
        <PipelineWorkspace />
      </div>
    </div>
  );
}
