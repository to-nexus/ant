import { useStore } from '@/domain/store';
import { Bar } from '../Bar';
import { Briefcase, Settings, FileEdit, User } from 'lucide-react';
import { useAlertModal } from '@/application/hooks/ui/useAlertModal';
import { TabButton } from './components/TabButton';
import { JobControls } from './components/JobControls';

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
  const activeTab = useStore((state) => state.mainPanelActiveTab);
  const openTabs = useStore((state) => state.mainPanelOpenTabs);
  const tabOrder = useStore((state) => state.mainPanelTabOrder);
  const isJobTabCleared = useStore((state) => state.isJobTabCleared);
  const currentJobId = useStore((state) => state.currentJobId);
  const selectMainPanelTab = useStore((state) => state.selectMainPanelTab);
  const closeMainPanelTab = useStore((state) => state.closeMainPanelTab);
  const clearJobTab = useStore((state) => state.clearJobTab);
  const { showConfirm, AlertModal } = useAlertModal();

  // Job tab label: show full ID when active, abbreviated when inactive
  const getJobTabLabel = () => {
    if (!currentJobId || isJobTabCleared) return 'Job';
    
    if (activeTab === 'job') {
      return `Job ${currentJobId}`;
    } else {
      return `Job ${currentJobId.slice(0, 8)}...`;
    }
  };

  const handleJobTabClose = () => {
    showConfirm(
      <>
        <p>This will remove the current job and clear all session data:</p>
        <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
          <li>Job ID and progress will be removed</li>
          <li>Task board will be cleared</li>
          <li>Chat history will be deleted</li>
          <li>Session files will be reset</li>
        </ul>
        <p className="mt-3 font-medium">Are you sure you want to continue?</p>
      </>,
      {
        type: 'warning',
        title: 'Remove Job?',
        confirmText: 'Remove',
        cancelText: 'Cancel',
        onConfirm: async () => {
          await clearJobTab();
        }
      }
    );
  };

  // Render dynamic tabs (projectConfig, accountConfig, fileEdit)
  const renderTab = (tabKey: 'projectConfig' | 'accountConfig' | 'fileEdit') => {
    if (!openTabs[tabKey]) return null;
    
    const tabConfig = {
      projectConfig: {
        icon: Settings,
        label: 'Project Config'
      },
      accountConfig: {
        icon: User,
        label: 'Account Config'
      },
      fileEdit: {
        icon: FileEdit,
        label: 'FileEdit'
      }
    }[tabKey];

    return (
      <TabButton
        key={tabKey}
        icon={tabConfig.icon}
        label={tabConfig.label}
        isActive={activeTab === tabKey}
        showText={activeTab !== 'job'}
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
          showText={true}
          showCloseButton={!!currentJobId}
          title={currentJobId && !isJobTabCleared ? `Job ID: ${currentJobId}` : 'Job'}
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
      <AlertModal />
    </>
  );
}
