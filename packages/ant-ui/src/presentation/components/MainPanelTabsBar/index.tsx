import { useStore } from '@/domain/store';
import { Bar } from '../Bar';
import { Briefcase, Settings, FileEdit, User, ArrowLeftRight, Monitor, Zap } from 'lucide-react';
import { TabButton } from './components/TabButton';
import { JobIdDropdown } from './components/JobIdDropdown';
import { JobControls } from './components/JobControls';
import { useTranslation } from 'react-i18next';

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
  const activeEditorTabId = useStore((state) => state.activeEditorTabId);
  const editorTabs = useStore((state) => state.editorTabs);
  const selectMainPanelTab = useStore((state) => state.selectMainPanelTab);
  const closeMainPanelTab = useStore((state) => state.closeMainPanelTab);

  const getJobTabLabel = () => t('tabs.job');

  // Render dynamic tabs
  const renderTab = (tabKey: 'projectConfig' | 'accountConfig' | 'fileEdit' | 'transfer' | 'previewConfig' | 'actions') => {
    if (!openTabs[tabKey]) return null;
    
    const activeEditorTab = editorTabs.find((tab) => tab.id === activeEditorTabId);
    const tabConfig: Record<string, { icon: any; label: string }> = {
      projectConfig: { icon: Settings, label: t('tabs.projectConfig') },
      accountConfig: { icon: User, label: t('tabs.accountConfig') },
      fileEdit: { icon: FileEdit, label: activeEditorTab?.title || t('tabs.fileEdit') },
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
        onClick={() => selectMainPanelTab(tabKey)}
        onClose={() => closeMainPanelTab(tabKey)}
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
          trailing={currentJobId ? <JobIdDropdown jobId={currentJobId} /> : undefined}
          onClick={() => selectMainPanelTab('job')}
        />

        {/* Dynamic tabs */}
        {tabOrder.map(tabKey => renderTab(tabKey))}
      </div>
    ),
    right: (
      activeTab === 'job' ? (
        <div className="flex items-center gap-3">
          <JobControls />
        </div>
      ) : null
    ),
    className: 'border-b border-gray-200 dark:border-[#30363d]'
  });
  
  return (
    <>
      {controls}
    </>
  );
}
