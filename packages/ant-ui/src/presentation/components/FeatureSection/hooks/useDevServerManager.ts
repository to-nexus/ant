import { useState, useEffect } from 'react';
import { useStore } from '@/domain/store';
import { 
  startDevServer, 
  stopDevServer, 
  getDevServerStatus, 
  getAvailablePort 
} from '@/infrastructure/http/api';

export function useDevServerManager(selectedProject: string | undefined) {
  const devServerStatus = useStore((state) => state.devServerStatus);
  const setDevServerStatus = useStore((state) => state.setDevServerStatus);
  const setDevServerLoading = useStore((state) => state.setDevServerLoading);
  const isDevServerLoading = useStore((state) => state.isDevServerLoading);
  
  const [showSetupPanel, setShowSetupPanel] = useState(false);
  const [showStatusPanel, setShowStatusPanel] = useState(false);
  const [startError, setStartError] = useState<string | undefined>();
  const [isInitialMount, setIsInitialMount] = useState(true);
  const [isInstalling, setIsInstalling] = useState(false);
  const [availablePort, setAvailablePort] = useState<number>(5173);

  // Auto-show status panel when dev server is running
  useEffect(() => {
    if (devServerStatus?.running) {
      setShowStatusPanel(true);
    }
  }, [devServerStatus?.running]);

  // Initial status check on mount
  useEffect(() => {
    if (!selectedProject || !isInitialMount) return;
    
    setIsInitialMount(false);
    
    const checkInitialStatus = async () => {
      try {
        const status = await getDevServerStatus(selectedProject);
        setDevServerStatus(status);
      } catch (error) {
        console.error('[useDevServerManager] Failed to get initial status:', error);
      }
    };
    
    checkInitialStatus();
  }, [selectedProject, isInitialMount, setDevServerStatus]);

  // Poll dev server status periodically
  useEffect(() => {
    if (!selectedProject) {
      setDevServerStatus(undefined);
      return;
    }
    
    const pollStatus = async () => {
      try {
        const status = await getDevServerStatus(selectedProject);
        setDevServerStatus(status);
        
        // Check logs for various states
        if (status.logs && status.logs.length > 0) {
          const installingLog = status.logs.find(log => 
            log.message.includes('Installing dependencies')
          );
          
          if (installingLog) {
            setIsInstalling(true);
            setShowStatusPanel(true);
            return;
          }
          
          const installSuccessLog = status.logs.find(log =>
            log.message.includes('Dependencies installed successfully')
          );
          
          if (installSuccessLog) {
            setIsInstalling(false);
          }
          
          const portErrorLog = status.logs.find(log => 
            log.type === 'stderr' && 
            log.message.includes('Port') && 
            log.message.includes('already in use')
          );
          
          if (portErrorLog) {
            setStartError(portErrorLog.message);
            setIsInstalling(false);
            setShowStatusPanel(true);
          }
          
          const installErrorLog = status.logs.find(log =>
            log.type === 'stderr' &&
            log.message.includes('Failed to install dependencies')
          );
          
          if (installErrorLog) {
            setStartError(installErrorLog.message);
            setIsInstalling(false);
            setShowStatusPanel(true);
          }
        }
      } catch (error) {
        console.error('[useDevServerManager] Failed to fetch dev server status:', error);
      }
    };
    
    // Poll every 5 seconds
    const interval = setInterval(pollStatus, 5000);
    pollStatus(); // Initial poll
    
    return () => {
      clearInterval(interval);
    };
  }, [selectedProject, setDevServerStatus]);

  const handlePlayButtonClick = async () => {
    if (!selectedProject) return;
    
    try {
      const port = await getAvailablePort(selectedProject);
      setAvailablePort(port);
      console.log(`[useDevServerManager] Available port found: ${port}`);
    } catch (error) {
      console.error('[useDevServerManager] Failed to get available port, using default:', error);
      setAvailablePort(5173);
    }
    
    setShowSetupPanel(true);
    setShowStatusPanel(false);
    setStartError(undefined);
    setIsInstalling(false);
  };

  const handleStartDevServer = async (port: number) => {
    if (!selectedProject) return;
    
    console.log(`[useDevServerManager] 🔄 Starting dev server on port ${port}, setting loading=true`);
    setDevServerLoading(true);
    setStartError(undefined);
    setIsInstalling(false);
    
    try {
      await startDevServer(selectedProject, port);
      setShowSetupPanel(false);
      setShowStatusPanel(true);
      
      setTimeout(async () => {
        try {
          const status = await getDevServerStatus(selectedProject);
          setDevServerStatus(status);
          console.log('[useDevServerManager] ✅ Dev server status polled:', status);
        } catch (pollError) {
          console.error('[useDevServerManager] Failed to poll dev server status:', pollError);
        }
      }, 1000);
    } catch (error: any) {
      console.error('Failed to start dev server:', error);
      setStartError(error.message || 'Unknown error');
      setShowSetupPanel(false);
      setShowStatusPanel(true);
    } finally {
      console.log('[useDevServerManager] ✅ Dev server start complete, setting loading=false');
      setDevServerLoading(false);
    }
  };

  const handleStopDevServer = async () => {
    if (!selectedProject) return;
    
    setDevServerLoading(true);
    try {
      await stopDevServer(selectedProject);
      setShowStatusPanel(false);
      setStartError(undefined);
      setIsInstalling(false);
      console.log('[useDevServerManager] Dev server stopped successfully');
    } catch (error: any) {
      console.error('[useDevServerManager] Failed to stop dev server:', error);
      alert(`Failed to stop dev server: ${error.message}`);
    } finally {
      setDevServerLoading(false);
    }
  };

  return {
    devServerStatus,
    isDevServerLoading,
    showSetupPanel,
    showStatusPanel,
    startError,
    isInstalling,
    availablePort,
    handlePlayButtonClick,
    handleStartDevServer,
    handleStopDevServer,
    setShowSetupPanel,
    setShowStatusPanel,
    setStartError,
    setIsInstalling
  };
}
