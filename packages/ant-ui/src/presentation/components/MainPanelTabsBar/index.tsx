import { useStore } from '@/domain/store';
import { Bar } from '../Bar';
import { Briefcase, Settings, FileEdit, User, ArrowLeftRight, Monitor, Zap, LayoutGrid, Workflow } from 'lucide-react';
import { TabButton, type TabAccent } from './components/TabButton';

const TAB_ACCENTS = {
  job: 'aurora',
  actions: 'sunset',
  projectConfig: 'cool',
  accountConfig: 'violet-pink',
  transfer: 'pink-orange',
  previewConfig: 'cool',
  fileEdit: 'pink-orange',
} as const satisfies Record<string, TabAccent>;
import { JobIdDropdown } from './components/JobIdDropdown';
import { EditorTabActions } from './components/EditorTabActions';
import { isEditorTabId } from '@/domain/store/editor/editorTabMainPanel';
import { useTranslation } from 'react-i18next';
import { BoardViewModeToggle } from '../aurora/BoardViewModeToggle';

/**
 * MainPanelTabsBar - Tab navigation for Main Panel
 *
 * Displays tabs for switching between:
 * - Job tab (always visible; jobId chip is now a dropdown trigger)
 * - Config tab (appears when project config is opened)
 * - FileEdit tab (appears when a file is selected)
 *
 * The job tab no longer carries an X button or a single-jobId reset path.
 * Job-id navigation, copy, and per-jobId delete all live inside the
 * JobIdDropdown attached to the chip.
 */
export function MainPanelTabsBar() {
  const { t } = useTranslation('nav');
  const activeTab = useStore((state) => state.mainPanelActiveTab);
  const openTabs = useStore((state) => state.mainPanelOpenTabs);
  const tabOrder = useStore((state) => state.mainPanelTabOrder);
  const currentJobId = useStore((state) => state.currentJobId);
  const editorTabs = useStore((state) => state.editorTabs);
  const selectMainPanelTab = useStore((state) => state.selectMainPanelTab);
  const closeMainPanelTab = useStore((state) => state.closeMainPanelTab);
  const selectEditorTab = useStore((state) => state.selectEditorTab);
  const pinEditorTab = useStore((state) => state.pinEditorTab);
  const unpinEditorTab = useStore((state) => state.unpinEditorTab);
  const closeEditorTab = useStore((state) => state.closeEditorTab);
  const taskViewMode = useStore((state) => state.taskViewMode);
  const setTaskViewMode = useStore((state) => state.setTaskViewMode);

  const getJobTabLabel = () => t('tabs.job');

  const renderStaticTab = (
    tabKey: 'projectConfig' | 'accountConfig' | 'transfer' | 'previewConfig' | 'actions',
  ) => {
    if (!openTabs[tabKey]) return null;

    const tabConfig: Record<string, { icon: any; label: string }> = {
      projectConfig: { icon: Settings, label: t('tabs.projectConfig') },
      accountConfig: { icon: User, label: t('tabs.accountConfig') },
      transfer: { icon: ArrowLeftRight, label: t('tabs.transfer') },
      previewConfig: { icon: Monitor, label: t('tabs.previewConfig', 'Preview Config') },
      actions: { icon: Zap, label: t('tabs.actions', 'Actions') },
    };
    const config = tabConfig[tabKey];
    if (!config) return null;

    return (
      <TabButton
        key={tabKey}
        icon={config.icon}
        label={config.label}
        isActive={activeTab === tabKey}
        showText={activeTab === tabKey}
        showCloseButton={true}
        accent={TAB_ACCENTS[tabKey] ?? 'aurora'}
        onClick={() => selectMainPanelTab(tabKey)}
        onClose={() => closeMainPanelTab(tabKey)}
      />
    );
  };

  const renderEditorTab = (tabKey: string) => {
    const tab = editorTabs.find((candidate) => candidate.id === tabKey);
    if (!tab) return null;

    return (
      <TabButton
        key={tab.id}
        icon={FileEdit}
        label={tab.title}
        isActive={activeTab === tab.id}
        truncateLabel
        showText={activeTab === tab.id}
        showTrailingWhenCollapsed={tab.status === 'streaming'}
        showCloseButton={false}
        title={tab.path || tab.title}
        accent={TAB_ACCENTS.fileEdit}
        trailing={(
          <EditorTabActions
            tab={tab}
            pinTitle={t('tabs.pin', 'Pin')}
            unpinTitle={t('tabs.unpin', 'Unpin')}
            closeTitle={t('tabs.close', 'Close')}
            streamingTitle={t('tabs.streamingLocked', 'Streaming in progress')}
            onPin={() => pinEditorTab(tab.id)}
            onUnpin={() => unpinEditorTab(tab.id)}
            onClose={() => closeEditorTab(tab.id)}
          />
        )}
        onClick={() => selectEditorTab(tab.id)}
      />
    );
  };

  const controls = Bar.render({
    left: (
      <div className="flex items-center gap-1">
        {/* Job Tab — always visible. The jobId chip + dropdown lives in `trailing`. */}
        <TabButton
          icon={Briefcase}
          label={getJobTabLabel()}
          isActive={activeTab === 'job'}
          isJobTab={true}
          showText={activeTab === 'job'}
          title={currentJobId ? `Job ID: ${currentJobId}` : t('tabs.job')}
          accent={TAB_ACCENTS.job}
          trailing={currentJobId ? <JobIdDropdown jobId={currentJobId} /> : undefined}
          onClick={() => selectMainPanelTab('job')}
        />

        {/* Dynamic tabs */}
        {tabOrder.map((tabKey) => (
          isEditorTabId(tabKey)
            ? renderEditorTab(tabKey)
            : renderStaticTab(tabKey as 'projectConfig' | 'accountConfig' | 'transfer' | 'previewConfig' | 'actions')
        ))}
      </div>
    ),
    right: activeTab === 'job' ? (
      <div className="flex items-center px-2">
        <BoardViewModeToggle
          value={taskViewMode === 'workflow' ? 'workflow' : 'kanban'}
          onChange={(v) => setTaskViewMode(v)}
          options={[
            { id: 'kanban', label: t('tabs.kanban', 'Kanban'), icon: LayoutGrid },
            { id: 'workflow', label: t('tabs.workflow', 'Workflow'), icon: Workflow },
          ]}
          ariaLabel={t('tabs.viewMode', 'View mode')}
        />
      </div>
    ) : null,
    className: undefined,
  });
  
  return (
    <>
      {controls}
    </>
  );
}
