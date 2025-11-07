import { GitBranch, ExternalLink, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { createFeature, deleteFeature, startDevServer, stopDevServer, getDevServerStatus } from '../lib/api';
import { ItemDropdown } from './ItemDropdown';
import { useUIActionPolicy } from '@/hooks/useUIActionPolicy';

export function FeatureDropdown() {
  const { 
    features, 
    selectedProject, 
    selectedFeature, 
    setSelectedFeature, 
    fetchFeatures,
    refreshFileTree,
    devServerStatus,
    setDevServerStatus
  } = useStore();
  const [showStatusPanel, setShowStatusPanel] = useState(false);
  const [serverStarted, setServerStarted] = useState(false);
  const [isInitialMount, setIsInitialMount] = useState(true);
  const policy = useUIActionPolicy();

  // Auto-show status panel when dev server is running (including after refresh)
  useEffect(() => {
    if (devServerStatus?.running) {
      setShowStatusPanel(true);
      setServerStarted(true);
    }
  }, [devServerStatus?.running]);

  // Initial status check on mount (페이지 새로고침 시에도 실행)
  useEffect(() => {
    if (!selectedProject || !isInitialMount) return;
    
    setIsInitialMount(false);
    
    const checkInitialStatus = async () => {
      try {
        const status = await getDevServerStatus(selectedProject);
        setDevServerStatus(status);
      } catch (error) {
        console.error('[FeatureDropdown] Failed to get initial status:', error);
      }
    };
    
    checkInitialStatus();
  }, [selectedProject, isInitialMount, setDevServerStatus]);

  // SSE connection for dev server status
  useEffect(() => {
    if (!selectedProject) {
      setDevServerStatus(undefined);
      return;
    }
    
    // Setup SSE connection
    const eventSource = new EventSource(
      `http://localhost:4100/api/projects/${encodeURIComponent(selectedProject)}/dev/stream`
    );
    
    eventSource.onmessage = (event) => {
      try {
        const status = JSON.parse(event.data);
        
        // Log errors if server stopped unexpectedly
        if (!status.running && status.logs && status.logs.length > 0) {
          console.error('[FeatureDropdown] Dev server logs:', status.logs);
          status.logs.forEach((log: any) => {
            if (log.type === 'error' || log.type === 'stderr') {
              console.error(`[DevServer Log] ${log.message}`);
            }
          });
        }
        
        setDevServerStatus(status);
      } catch (error) {
        console.error('[FeatureDropdown] Failed to parse SSE data:', error);
      }
    };
    
    eventSource.onerror = (error) => {
      console.error('[FeatureDropdown] SSE error:', error);
      eventSource.close();
    };
    
    return () => {
      eventSource.close();
    };
  }, [selectedProject, setDevServerStatus]);

  const handleStartDevServer = async () => {
    if (!selectedProject) return;
    
    try {
      await startDevServer(selectedProject);
      setServerStarted(true);
      setShowStatusPanel(true);
      
      // SSE will handle status updates automatically
    } catch (error: any) {
      console.error('[FeatureDropdown] Failed to start dev server:', error);
      setShowStatusPanel(true);
      setServerStarted(false);
    }
  };

  const handleStopDevServer = async () => {
    if (!selectedProject) return;
    
    try {
      await stopDevServer(selectedProject);
      // Status will be updated by polling
    } catch (error: any) {
      console.error('[FeatureDropdown] Failed to stop dev server:', error);
      alert(`Failed to stop dev server: ${error.message}`);
    }
  };

  const handleCreateFeature = async (featureName: string) => {
    if (!selectedProject) {
      throw new Error('No project selected');
    }
    await createFeature(selectedProject, featureName);
    await refreshFileTree();
  };

  const handleDeleteFeature = async (featureName: string) => {
    if (!selectedProject) {
      throw new Error('No project selected');
    }
    await deleteFeature(selectedProject, featureName);
    await refreshFileTree();
  };

  const featureItems = features.map((f) => ({ name: f.name, path: f.path }));

  if (!selectedProject) {
    return null;
  }

  // Only log when state actually changes (removed constant logging on every render)
  const hasError = showStatusPanel && !serverStarted && !devServerStatus?.running;

  return (
    <div>
      <ItemDropdown
        title="Features"
        icon={GitBranch}
        items={featureItems}
        selectedItem={selectedFeature}
        onSelect={setSelectedFeature}
        onCreate={handleCreateFeature}
        onDelete={handleDeleteFeature}
        onItemCreated={fetchFeatures}
        placeholder="Select a feature..."
        inputPlaceholder="Feature name..."
        onPlayClick={handleStartDevServer}
        onStopClick={handleStopDevServer}
        isPlaying={devServerStatus?.running || false}
        disabled={!policy.canChangeFeature}
        disabledReason={policy.disabledReason || undefined}
      />
      
      {/* Dev Server Status Panel */}
      {showStatusPanel && selectedProject && selectedFeature && (
        <div className="mt-2">
          {/* Running Status */}
          {devServerStatus?.running && (
            <div className="p-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-md">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 animate-pulse">
                  <div className="w-2 h-2 bg-green-500 dark:bg-green-400 rounded-full"></div>
                  <span className="text-sm font-medium text-green-900 dark:text-green-100">Dev Server Running</span>
                </div>
                {devServerStatus.url && (
                  <button
                    onClick={() => window.open(devServerStatus.url!, '_blank')}
                    className="px-2 py-1 text-xs bg-green-600 dark:bg-green-700 text-white rounded hover:bg-green-700 dark:hover:bg-green-600 transition-colors flex items-center gap-1"
                    title="Open in new tab"
                  >
                    <ExternalLink size={12} />
                    Open
                  </button>
                )}
              </div>
            </div>
          )}
          
          {/* Error Status */}
          {hasError && (
            <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-red-600 dark:text-red-400 text-sm">⚠️</span>
                  <span className="text-sm font-medium text-red-900 dark:text-red-100">Dev Server Failed to Start</span>
                </div>
                <button
                  onClick={() => {
                    setShowStatusPanel(false);
                    setServerStarted(false);
                  }}
                  className="p-1 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 rounded hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
                  title="Close"
                >
                  <X size={14} />
                </button>
              </div>
              {devServerStatus?.logs && devServerStatus.logs.length > 0 && (
                <div className="mt-2 text-xs text-red-700 dark:text-red-300 max-h-20 overflow-y-auto">
                  {devServerStatus.logs.slice(-3).map((log, i) => (
                    <div key={i} className="font-mono">{log.message}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
