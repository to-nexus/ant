/**
 * PipelinesPanel — the `pipelines` main-panel tab: resizable rail (approval
 * inbox + scope-grouped pipeline list) beside the two-view workspace (wiring /
 * execution). ACCOUNT-scoped: definitions are cross-project, so the panel
 * renders regardless of the selected project; project bindings happen in the
 * Execution view's activation flow.
 *
 * The rail footer splits the panel into two SPACES: Workspace (universal
 * projects — the only space pipelines support today) and Codespace (code
 * projects — reserved; selecting it shows an unsupported notice and disables
 * all pipeline work). The choice is pure FE state, persisted locally.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban } from 'lucide-react';
import { useStore } from '@/domain/store';
import { useResizableWidth } from '../AgentSettings/useResizableWidth';
import { PipelineRail } from './PipelineRail';
import { PipelineWorkspace } from './PipelineWorkspace';

export type PipelineSpace = 'workspace' | 'codespace';

const SPACE_STORAGE_KEY = 'ant-ui:pipelines-space';

export function PipelinesPanel() {
  const { t } = useTranslation('pipelines');
  const loadPipelines = useStore((s) => s.loadPipelines);
  const { width, isResizing, startResize } = useResizableWidth({
    storageKey: 'ant-ui:pipelines-rail-width',
    min: 220,
    max: 420,
    defaultWidth: 280,
  });
  const [space, setSpace] = useState<PipelineSpace>(() =>
    localStorage.getItem(SPACE_STORAGE_KEY) === 'codespace' ? 'codespace' : 'workspace',
  );
  const changeSpace = (next: PipelineSpace) => {
    setSpace(next);
    localStorage.setItem(SPACE_STORAGE_KEY, next);
  };

  // Lazy account-scoped bootstrap — the tab is the only consumer of the list.
  useEffect(() => {
    void loadPipelines();
  }, [loadPipelines]);

  return (
    <div style={{ height: '100%', display: 'flex', background: 'var(--bg-canvas)', minHeight: 0, overflow: 'hidden' }}>
      <div className="relative shrink-0" style={{ width, borderRight: '1px solid var(--border-1)' }}>
        <PipelineRail space={space} onSpaceChange={changeSpace} railWidth={width} />
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
        {space === 'codespace' ? (
          <div
            style={{
              display: 'flex',
              height: '100%',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              color: 'var(--text-3)',
              fontSize: 13,
              textAlign: 'center',
              lineHeight: 1.7,
              padding: 24,
            }}
          >
            <Ban size={22} />
            <span style={{ whiteSpace: 'pre-line' }}>
              {t('space.codespaceUnsupported', 'Pipelines are not available for Codespace yet.\nFor now, pipelines run only on Workspace (universal) projects.')}
            </span>
          </div>
        ) : (
          <PipelineWorkspace />
        )}
      </div>
    </div>
  );
}
