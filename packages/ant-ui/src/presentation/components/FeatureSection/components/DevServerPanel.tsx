import { DevServerSetup } from '../../DevServerSetup';
import { DevServerStatus } from '../../DevServerStatus';

interface DevServerPanelProps {
  selectedProject: string;
  selectedFeature: string | undefined;
  showSetupPanel: boolean;
  showStatusPanel: boolean;
  availablePort: number;
  isDevServerLoading: boolean;
  startError: string | undefined;
  isInstalling: boolean;
  devServerStatus: any;
  onStart: (port: number) => void;
  onCloseSetup: () => void;
  onCloseStatus: () => void;
}

export function DevServerPanel({
  selectedProject,
  selectedFeature,
  showSetupPanel,
  showStatusPanel,
  availablePort,
  isDevServerLoading,
  startError,
  isInstalling,
  devServerStatus,
  onStart,
  onCloseSetup,
  onCloseStatus
}: DevServerPanelProps) {
  // Determine status based on devServerStatus and logs
  let displayStatus: 'installing' | 'starting' | 'running' | 'error' = 'starting';
  let displayError: string | undefined = startError;
  
  if (isInstalling) {
    displayStatus = 'installing';
  } else if (isDevServerLoading) {
    displayStatus = 'starting';
  } else if (startError) {
    displayStatus = 'error';
  } else if (devServerStatus?.running) {
    displayStatus = 'running';
  } else if (devServerStatus && !devServerStatus.running) {
    // Process not running - check logs for errors
    const logs = devServerStatus.logs || [];
    const hasError = logs.some((log: any) => 
      log.type === 'stderr' && 
      (log.message.includes('Error:') || 
       log.message.includes('error:') ||
       log.message.includes('❌'))
    );
    
    if (hasError) {
      displayStatus = 'error';
      const lastError = logs
        .filter((log: any) => log.type === 'stderr')
        .pop();
      displayError = lastError?.message || 'Dev server failed to start';
    } else {
      displayStatus = 'starting';
    }
  }

  return (
    <>
      {/* Dev Server Setup Panel */}
      {showSetupPanel && selectedProject && selectedFeature && (
        <div className="mt-2">
          <DevServerSetup
            projectId={selectedProject}
            defaultPort={availablePort}
            onStart={onStart}
            onClose={onCloseSetup}
            isStarting={isDevServerLoading}
          />
        </div>
      )}
      
      {/* Dev Server Status Panel */}
      {showStatusPanel && selectedProject && selectedFeature && (
        <div className="mt-2">
          <DevServerStatus
            status={displayStatus}
            url={devServerStatus?.url || undefined}
            errorMessage={displayError}
            onClose={onCloseStatus}
          />
        </div>
      )}
    </>
  );
}
