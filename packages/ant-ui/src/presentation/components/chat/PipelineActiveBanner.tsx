/**
 * PipelineActiveBanner — persistent strip inside the chat input container
 * when the selected project is OWNED by an active pipeline. Shows the
 * pipeline name, waiting/working state (+ next fire), and a "Manage" jump to
 * the pipelines tab's Execution view. The chat lock itself is enforced by
 * useChatPolicy ('pipeline-active' / 'pipeline-running').
 */

import { useTranslation } from 'react-i18next';
import { Waypoints } from 'lucide-react';
import { useStore } from '@/domain/store';
import { selectActivePipelineForSelectedProject } from '@/domain/store/selectors/pipelines';

export function PipelineActiveBanner() {
  const { t } = useTranslation('chat');
  const active = useStore((state) => selectActivePipelineForSelectedProject(state));
  const openMainPanelTab = useStore((state) => state.openMainPanelTab);
  const selectPipeline = useStore((state) => state.selectPipeline);
  const setPipelinePanelView = useStore((state) => state.setPipelinePanelView);

  if (!active) return null;

  const running = active.state === 'running' || active.state === 'awaiting_human';
  const stateColor = running ? 'var(--green-500, #22c55e)' : 'var(--violet-400)';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        fontSize: 11.5,
        borderBottom: '1px solid var(--border-1)',
        background: 'color-mix(in srgb, var(--violet-500) 6%, var(--bg-surface))',
        color: 'var(--text-2)',
      }}
    >
      <Waypoints size={13} style={{ color: 'var(--violet-400)', flexShrink: 0 }} />
      <span style={{ fontWeight: 700, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {active.pipelineName}
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
        <span style={{ width: 7, height: 7, borderRadius: 4, background: stateColor }} />
        {running ? t('banner.pipelineWorking', 'working') : t('banner.pipelineWaiting', 'waiting')}
      </span>
      {!running && active.nextFireAt && (
        <span style={{ color: 'var(--text-3)', flexShrink: 0 }}>
          {t('banner.pipelineNextFire', 'next: {{when}}', { when: new Date(active.nextFireAt).toLocaleString() })}
        </span>
      )}
      <div style={{ flex: 1 }} />
      <button
        onClick={() => {
          openMainPanelTab('pipelines');
          void selectPipeline(active.pipelineId);
          setPipelinePanelView('execution');
        }}
        style={{
          background: 'none',
          border: '1px solid var(--border-2)',
          borderRadius: 'var(--r-sm)',
          color: 'var(--text-2)',
          fontSize: 11,
          padding: '2px 8px',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        {t('banner.pipelineManage', 'Manage')}
      </button>
    </div>
  );
}
