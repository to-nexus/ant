import { useStore } from '@/domain/store';
import { Bar } from '../Bar';
import { Briefcase, Settings, FileEdit, User, ArrowLeftRight, Monitor } from 'lucide-react';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { TabButton } from './components/TabButton';
import { JobControls } from './components/JobControls';
import { useTranslation } from 'react-i18next';

/**
 * MainPanelTabsBar - Tab navigation for Main Panel
 * 
 * Displays tabs for switching between:
 * - Job tab (always visible, shows job ID)
 * - Config tab (appears when project config is opened)
 * - FileEdit tab (appears when a file is selected)
 * 
 * Each tab has a close button. Job tab cannot be removed, but can be "cleared"
 * (shows empty job state without removing the tab itself).
 */
export function MainPanelTabsBar() {
  const { t } = useTranslation('nav');
  const activeTab = useStore((state) => state.mainPanelActiveTab);
  const openTabs = useStore((state) => state.mainPanelOpenTabs);
  const tabOrder = useStore((state) => state.mainPanelTabOrder);
  const isJobTabCleared = useStore((state) => state.isJobTabCleared);
  const currentJobId = useStore((state) => state.currentJobId);
  const selectMainPanelTab = useStore((state) => state.selectMainPanelTab);
  const closeMainPanelTab = useStore((state) => state.closeMainPanelTab);
  const clearJobTab = useStore((state) => state.clearJobTab);
  const isRunning = useStore((state) => state.isRunning);
  const { showConfirm, showInfo } = useAlertModalContext();

  const getJobTabLabel = () => {
    if (!currentJobId || isJobTabCleared) return t('tabs.job');
    return `${t('tabs.job')} (${currentJobId})`;
  };

  const handleJobTabClose = () => {
    if (isRunning) {
      showInfo(t('tabs.removeJobBlocked'), {
        type: 'warning',
        title: t('tabs.removeJob'),
      });
      return;
    }

    showConfirm(
      <>
        <p>{t('tabs.removeJobDesc')}</p>
        <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
          <li>{t('tabs.removeJobItem1')}</li>
          <li>{t('tabs.removeJobItem2')}</li>
          <li>{t('tabs.removeJobItem3')}</li>
          <li>{t('tabs.removeJobItem4')}</li>
        </ul>
        <p className="mt-3 font-medium">{t('tabs.removeJobConfirm')}</p>
      </>,
      {
        type: 'warning',
        title: t('tabs.removeJob'),
        confirmText: t('common:button.remove'),
        cancelText: t('common:button.cancel'),
        onConfirm: async () => {
          await clearJobTab();
        }
      }
    );
  };

  // Render dynamic tabs (projectConfig, accountConfig, fileEdit, transfer, previewConfig)
  const renderTab = (tabKey: 'projectConfig' | 'accountConfig' | 'fileEdit' | 'transfer' | 'previewConfig') => {
    if (!openTabs[tabKey]) return null;
    
    const tabConfig = {
      projectConfig: {
        icon: Settings,
        label: t('tabs.projectConfig')
      },
      accountConfig: {
        icon: User,
        label: t('tabs.accountConfig')
      },
      fileEdit: {
        icon: FileEdit,
        label: t('tabs.fileEdit')
      },
      transfer: {
        icon: ArrowLeftRight,
        label: t('tabs.transfer')
      },
      previewConfig: {
        icon: Monitor,
        label: t('tabs.previewConfig', 'Preview Config')
      }
    }[tabKey];

    return (
      <TabButton
        key={tabKey}
        icon={tabConfig.icon}
        label={tabConfig.label}
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
        {/* Job Tab - Always visible */}
        <TabButton
          icon={Briefcase}
          label={getJobTabLabel()}
          isActive={activeTab === 'job'}
          isJobTab={true}
          showText={activeTab === 'job'}
          showCloseButton={!!currentJobId}
          title={currentJobId && !isJobTabCleared ? `Job ID: ${currentJobId}` : t('tabs.job')}
          onClick={() => selectMainPanelTab('job')}
          onClose={handleJobTabClose}
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
