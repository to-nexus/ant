import * as React from 'react';
import { useStore } from '@/domain/store';
import { textColors, cn } from '@/shared/utils/design-system';
import { Bar } from './Bar';
import { X, Briefcase, Settings, FileEdit, Columns, Rows, User } from 'lucide-react';
import { useAlertModal } from '@/application/hooks/ui/useAlertModal';

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
  const tabOrder = useStore((state) => state.mainPanelTabOrder);  // ✅ 탭 순서 가져오기
  const isJobTabCleared = useStore((state) => state.isJobTabCleared);
  const currentJobId = useStore((state) => state.currentJobId);
  const selectMainPanelTab = useStore((state) => state.selectMainPanelTab);
  const closeMainPanelTab = useStore((state) => state.closeMainPanelTab);
  const clearJobTab = useStore((state) => state.clearJobTab);
  const { showConfirm, AlertModal } = useAlertModal();

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
    // ✅ Job ID 제거 전 확인 팝업
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
  
  // ✅ 탭 렌더링 헬퍼 함수
  const renderTab = (tabKey: 'projectConfig' | 'accountConfig' | 'fileEdit') => {
    if (!openTabs[tabKey]) return null;
    
    const tabConfig = {
      projectConfig: {
        icon: Settings,
        label: 'Project Config',
        title: 'Close project config tab'
      },
      accountConfig: {
        icon: User,
        label: 'Account Config',
        title: 'Close account config tab'
      },
      fileEdit: {
        icon: FileEdit,
        label: 'FileEdit',
        title: 'Close file editor tab'
      }
    }[tabKey];
    
    const Icon = tabConfig.icon;
    
    return (
      <div
        key={tabKey}
        className={cn(
          'flex items-center gap-2 py-1.5 rounded-t transition-all text-sm font-medium',
          // Job tab이 선택되었을 때는 아이콘만 표시 (px-2), 아니면 전체 표시 (px-3)
          activeTab === 'job' ? 'px-2' : 'px-3',
          activeTab === tabKey
            ? 'bg-white dark:bg-[#0d1117] text-gray-900 dark:text-white border-t border-x border-gray-200 dark:border-[#30363d]'
            : 'bg-gray-100 dark:bg-[#161b22] text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#1c2128] cursor-pointer'
        )}
      >
        <div 
          onClick={() => selectMainPanelTab(tabKey)}
          className="flex items-center gap-2 flex-1"
        >
          <Icon className="w-4 h-4 flex-shrink-0" />
          {/* Job tab 선택 시 텍스트 숨김 */}
          {activeTab !== 'job' && <span>{tabConfig.label}</span>}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            closeMainPanelTab(tabKey);
          }}
          className={cn(
            'p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
            // Job tab 선택 시 close 버튼도 숨김
            activeTab === 'job' && 'hidden'
          )}
          title={tabConfig.title}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  };

  const controls = Bar.render({
    left: (
      <div className="flex items-center gap-1">
        {/* Job Tab - Always visible */}
        <div
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-t transition-all text-sm font-medium',
            activeTab === 'job'
              ? 'bg-white dark:bg-[#0d1117] text-gray-900 dark:text-white border-t border-x border-gray-200 dark:border-[#30363d]'
              : 'bg-gray-100 dark:bg-[#161b22] text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#1c2128] cursor-pointer'
          )}
          title={currentJobId && !isJobTabCleared ? `Job ID: ${currentJobId}` : 'Job'}
        >
          <div 
            onClick={() => selectMainPanelTab('job')}
            className="flex items-center gap-2 flex-1"
          >
            <Briefcase className="w-4 h-4 flex-shrink-0" />
            <span className="whitespace-nowrap">{jobTabLabel}</span>
          </div>
          {/* ✅ Job ID가 있을 때만 닫기 버튼 표시 */}
          {currentJobId && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleJobTabClose();
              }}
              className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              title="Remove job ID"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* ✅ 동적으로 탭 순서대로 렌더링 */}
        {tabOrder.map(tabKey => renderTab(tabKey))}
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
  
  return (
    <>
      {controls}
      <AlertModal />
    </>
  );
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
  const [currentTask, setCurrentTask] = React.useState<any>(null);
  
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
  
  // Subscribe to workflow state for current task updates
  React.useEffect(() => {
    if (!currentJobId || !isRunning) {
      setCurrentTask(null);
      return;
    }
    
    // Dynamic import to avoid SSR issues
    import('@/infrastructure/sse/SSEManager').then(({ sseManager }) => {
      const handleWorkflowUpdate = (data: any) => {
        // Backend sends the entire workflow state
        if (data.currentTask) {
          setCurrentTask(data.currentTask);
        }
      };
      
      sseManager.registerHandler('workflow', handleWorkflowUpdate);
      
      // Cleanup on unmount or when jobId changes
      return () => {
        sseManager.unregisterHandler('workflow', handleWorkflowUpdate);
      };
    });
  }, [currentJobId, isRunning]);
  
  // Load model name based on job type, current task type, and priority
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
            // Design job: decompose or default
            if (currentTask) {
              modelId = config.llmModels.designDefault;
            } else {
              modelId = config.llmModels.designDecompose || config.llmModels.designDefault;
            }
          } else if (selectedJobType === 'code') {
            // Code job: task type에 따라 선택
            if (currentTask) {
              const taskType = currentTask.type;
              const taskPriority = currentTask.priority;
              
              if (taskType === 'error') {
                modelId = config.llmModels.codeError || config.llmModels.codeDefault;
              } else if (taskType === 'setup') {
                modelId = config.llmModels.codeSetup || config.llmModels.codeDefault;
              } else if (taskType === 'feature' && taskPriority === 1000) {
                modelId = config.llmModels.codeFinal || config.llmModels.codeDefault;
              } else {
                modelId = config.llmModels.codeDefault;
              }
            } else {
              // No current task = decompose phase
              modelId = config.llmModels.codeDecompose || config.llmModels.codeDefault;
            }
          } else {
            // Unknown job type, use decompose or default
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
  }, [selectedProject, selectedJobType, availableModels, currentTask]);

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

