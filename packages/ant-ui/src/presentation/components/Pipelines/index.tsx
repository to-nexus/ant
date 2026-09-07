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
import { STORAGE_KEYS } from '@/domain/store/storage';
import { useResizableWidth } from '../AgentSettings/useResizableWidth';
import { RailResizeHandle } from '../shared/rail';
import { PipelineRail } from './PipelineRail';
import { PipelineWorkspace } from './PipelineWorkspace';
import { ApproverRunPanel } from './ApproverRunPanel';

export type PipelineSpace = 'workspace' | 'codespace';

const SPACE_STORAGE_KEY = 'ant-ui:pipelines-space';

export function PipelinesPanel() {
  const { t } = useTranslation('pipelines');
  const loadPipelines = useStore((s) => s.loadPipelines);
  const loadAccountAgents = useStore((s) => s.loadAccountAgents);
  const { width, isResizing, startResize } = useResizableWidth({ storageKey: STORAGE_KEYS.PIPELINE_RAIL_WIDTH });
  const [space, setSpace] = useState<PipelineSpace>(() =>
    localStorage.getItem(SPACE_STORAGE_KEY) === 'codespace' ? 'codespace' : 'workspace',
  );
  const changeSpace = (next: PipelineSpace) => {
    setSpace(next);
    localStorage.setItem(SPACE_STORAGE_KEY, next);
  };

  // Lazy account-scoped bootstrap — the pipeline list, plus the account agent
  // catalog the canvas/inspector resolve step display names from.
  useEffect(() => {
    void loadPipelines();
    void loadAccountAgents();
  }, [loadPipelines, loadAccountAgents]);

  return (
    <div style={{ height: '100%', display: 'flex', background: 'var(--bg-canvas)', minHeight: 0, overflow: 'hidden' }}>
      <div className="relative shrink-0" style={{ width, borderRight: '1px solid var(--border-1)' }}>
        <PipelineRail space={space} onSpaceChange={changeSpace} railWidth={width} />
        <RailResizeHandle isResizing={isResizing} onMouseDown={startResize} />
      </div>
      {/* relative: the approver context panel slides over the workspace side
          (an approver's whole surface — never the project or the definition). */}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative' }}>
        <ApproverRunPanel />
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
