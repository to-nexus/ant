import * as React from 'react';
import { useStore } from '@/domain/store';
import { textColors, cn } from '@/shared/utils/design-system';
import { Bar } from './Bar';
import { X, Briefcase, Settings, FileEdit, Columns, Rows, User } from 'lucide-react';

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
  const isJobTabCleared = useStore((state) => state.isJobTabCleared);
  const currentJobId = useStore((state) => state.currentJobId);
  const selectMainPanelTab = useStore((state) => state.selectMainPanelTab);
  const closeMainPanelTab = useStore((state) => state.closeMainPanelTab);
  const clearJobTab = useStore((state) => state.clearJobTab);
  const restoreJobTab = useStore((state) => state.restoreJobTab);

  // Job tab label: show full ID when active, abbreviated when inactive
  const getJobTabLabel = () => {
    if (!currentJobId || isJobTabCleared) return 'Job';
    
    // Show full Job ID when tab is active, abbreviated (first 8 chars) when inactive
    if (activeTab === 'job') {
      return `Job ${currentJobId}`;
    } else {
      return `Job ${currentJobId.slice(0, 8)}...`;
    }
  };
  
  const jobTabLabel = getJobTabLabel();

  const handleJobTabClose = () => {
    if (currentJobId && !isJobTabCleared) {
      // Has job and not cleared yet - clear it
      clearJobTab();
    } else if (isJobTabCleared) {
      // Already cleared - restore it
      restoreJobTab();
    }
    // If no job at all, do nothing
  };

  return Bar.render({
    left: (
      <div className="flex items-center gap-1">
        {/* Job Tab - Always visible */}
        <button
          onClick={() => selectMainPanelTab('job')}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-t transition-all text-sm font-medium',
            activeTab === 'job'
              ? 'bg-white dark:bg-[#0d1117] text-gray-900 dark:text-white border-t border-x border-gray-200 dark:border-[#30363d]'
              : 'bg-gray-100 dark:bg-[#161b22] text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#1c2128]'
          )}
          title={currentJobId && !isJobTabCleared ? `Job ID: ${currentJobId}` : 'Job'}
        >
          <Briefcase className="w-4 h-4 flex-shrink-0" />
          <span className="whitespace-nowrap">{jobTabLabel}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleJobTabClose();
            }}
            className={cn(
              'p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors',
              isJobTabCleared 
                ? 'text-gray-400 dark:text-gray-500' 
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            )}
            title={isJobTabCleared ? 'Restore job content' : 'Clear job content (tab remains)'}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </button>

        {/* Project Config Tab - Only visible when open */}
        {openTabs.projectConfig && (
          <button
            onClick={() => selectMainPanelTab('projectConfig')}
            className={cn(
              'flex items-center gap-2 py-1.5 rounded-t transition-all text-sm font-medium',
              // Job tab이 선택되었을 때는 아이콘만 표시 (px-2), 아니면 전체 표시 (px-3)
              activeTab === 'job' ? 'px-2' : 'px-3',
              activeTab === 'projectConfig'
                ? 'bg-white dark:bg-[#0d1117] text-gray-900 dark:text-white border-t border-x border-gray-200 dark:border-[#30363d]'
                : 'bg-gray-100 dark:bg-[#161b22] text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#1c2128]'
            )}
          >
            <Settings className="w-4 h-4 flex-shrink-0" />
            {/* Job tab 선택 시 텍스트 숨김 */}
            {activeTab !== 'job' && <span>Project Config</span>}
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeMainPanelTab('projectConfig');
              }}
              className={cn(
                'p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
                // Job tab 선택 시 close 버튼도 숨김
                activeTab === 'job' && 'hidden'
              )}
              title="Close project config tab"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </button>
        )}

        {/* Account Config Tab - Only visible when open */}
        {openTabs.accountConfig && (
          <button
            onClick={() => selectMainPanelTab('accountConfig')}
            className={cn(
              'flex items-center gap-2 py-1.5 rounded-t transition-all text-sm font-medium',
              // Job tab이 선택되었을 때는 아이콘만 표시 (px-2), 아니면 전체 표시 (px-3)
              activeTab === 'job' ? 'px-2' : 'px-3',
              activeTab === 'accountConfig'
                ? 'bg-white dark:bg-[#0d1117] text-gray-900 dark:text-white border-t border-x border-gray-200 dark:border-[#30363d]'
                : 'bg-gray-100 dark:bg-[#161b22] text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#1c2128]'
            )}
          >
            <User className="w-4 h-4 flex-shrink-0" />
            {/* Job tab 선택 시 텍스트 숨김 */}
            {activeTab !== 'job' && <span>Account Config</span>}
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeMainPanelTab('accountConfig');
              }}
              className={cn(
                'p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
                // Job tab 선택 시 close 버튼도 숨김
                activeTab === 'job' && 'hidden'
              )}
              title="Close account config tab"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </button>
        )}

        {/* FileEdit Tab - Only visible when open */}
        {openTabs.fileEdit && (
          <button
            onClick={() => selectMainPanelTab('fileEdit')}
            className={cn(
              'flex items-center gap-2 py-1.5 rounded-t transition-all text-sm font-medium',
              // Job tab이 선택되었을 때는 아이콘만 표시 (px-2), 아니면 전체 표시 (px-3)
              activeTab === 'job' ? 'px-2' : 'px-3',
              activeTab === 'fileEdit'
                ? 'bg-white dark:bg-[#0d1117] text-gray-900 dark:text-white border-t border-x border-gray-200 dark:border-[#30363d]'
                : 'bg-gray-100 dark:bg-[#161b22] text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#1c2128]'
            )}
          >
            <FileEdit className="w-4 h-4 flex-shrink-0" />
            {/* Job tab 선택 시 텍스트 숨김 */}
            {activeTab !== 'job' && <span>FileEdit</span>}
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeMainPanelTab('fileEdit');
              }}
              className={cn(
                'p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
                // Job tab 선택 시 close 버튼도 숨김
                activeTab === 'job' && 'hidden'
              )}
              title="Close file editor tab"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </button>
        )}
      </div>
    ),
    right: (
      activeTab === 'job' ? (
        // Only show controls when Job tab is active
        <div className="flex items-center gap-3">
          {/* Model and Mode badges moved here from MainPanelBar */}
          <MainPanelJobControls />
        </div>
      ) : null
    ),
    className: 'border-b border-gray-200 dark:border-[#30363d]'
  });
}

/**
 * Job-specific controls (Model, Mode, Split toggle)
 * Only displayed when Job tab is active
 */
function MainPanelJobControls() {
  const currentJobId = useStore((state) => state.currentJobId);
  const currentMode = useStore((state) => state.currentMode);
  const splitLayout = useStore((state) => state.splitLayout);
  const toggleSplitLayout = useStore((state) => state.toggleSplitLayout);
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedJobType = useStore((state) => state.selectedJobType);
  const isRunning = useStore((state) => state.isRunning);
  
  const [modelName, setModelName] = React.useState<string | null>(null);
  const [availableModels, setAvailableModels] = React.useState<Map<string, string>>(new Map());
  
  // Load available models
  React.useEffect(() => {
    const loadAvailableModels = async () => {
      try {
        const { fetchAvailableModels } = await import('@/infrastructure/http/api');
        const response = await fetchAvailableModels();
        
        const modelsMap = new Map<string, string>();
        response.models.forEach(model => {
          modelsMap.set(model.id, model.displayName);
        });
        setAvailableModels(modelsMap);
      } catch (error) {
        console.warn('[MainPanelJobControls] Failed to load available models:', error);
      }
    };
    
    loadAvailableModels();
  }, []);
  
  // Load model name from project config
  React.useEffect(() => {
    const loadModelName = async () => {
      if (!selectedProject || availableModels.size === 0) {
        setModelName(null);
        return;
      }
      
      try {
        const { fetchProjectConfig } = await import('@/infrastructure/http/api');
        const config = await fetchProjectConfig(selectedProject);
        
        if (config?.llmModels) {
          let modelId: string | undefined;
          
          if (selectedJobType === 'design') {
            modelId = config.llmModels.designDecompose || config.llmModels.designDefault;
          } else if (selectedJobType === 'code') {
            modelId = config.llmModels.codeDecompose || config.llmModels.codeDefault;
          } else {
            modelId = config.llmModels.codeDecompose || 
                     config.llmModels.codeDefault || 
                     config.llmModels.designDecompose ||
                     config.llmModels.designDefault;
          }
          
          if (modelId) {
            const displayName = availableModels.get(modelId);
            setModelName(displayName || modelId);
          } else {
            setModelName(null);
          }
        } else {
          setModelName(null);
        }
      } catch (error) {
        console.warn('[MainPanelJobControls] Failed to load model name:', error);
        setModelName(null);
      }
    };
    
    loadModelName();
  }, [selectedProject, selectedJobType, availableModels]);

  return (
    <>
      {/* Model Badge - Only show when job is running */}
      {modelName && currentJobId && isRunning && (
        <div className="flex items-center gap-2">
          <span className={textColors.tertiary}>Model:</span>
          <span className={cn(textColors.secondary, 'font-medium')}>
            {modelName}
          </span>
        </div>
      )}
      
      {/* Mode Badge - Only show when job is running */}
      {currentMode && isRunning && (
        <div className="flex items-center gap-2">
          <span className={textColors.tertiary}>Mode:</span>
          <span className={cn(textColors.secondary, 'font-medium capitalize')}>
            {currentMode}
          </span>
        </div>
      )}
      
      {/* Split Layout Toggle */}
      <div className="flex items-center gap-1 border-l pl-3 border-gray-300 dark:border-gray-600">
        <button
          onClick={() => toggleSplitLayout('horizontal')}
          className={cn(
            'p-1.5 rounded transition-all',
            splitLayout === 'horizontal'
              ? 'bg-emerald-600 dark:bg-emerald-500 text-white shadow-sm'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
          )}
          title="Horizontal Split (Left/Right)"
        >
          <Columns className="w-4 h-4" />
        </button>
        <button
          onClick={() => toggleSplitLayout('vertical')}
          className={cn(
            'p-1.5 rounded transition-all',
            splitLayout === 'vertical'
              ? 'bg-emerald-600 dark:bg-emerald-500 text-white shadow-sm'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
          )}
          title="Vertical Split (Top/Bottom)"
        >
          <Rows className="w-4 h-4" />
        </button>
      </div>
    </>
  );
}

