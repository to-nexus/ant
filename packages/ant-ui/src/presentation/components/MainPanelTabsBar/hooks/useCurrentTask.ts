import * as React from 'react';

export function useCurrentTask(currentJobId: string | undefined, isRunning: boolean) {
  const [currentTask, setCurrentTask] = React.useState<any>(null);
  
  React.useEffect(() => {
    if (!currentJobId || !isRunning) {
      setCurrentTask(null);
      return;
    }
    
    // Dynamic import to avoid SSR issues
    import('@/infrastructure/sse/SSEManager').then(({ sseManager }) => {
      const handleWorkflowUpdate = (data: any) => {
        if (data.currentTask) {
          setCurrentTask(data.currentTask);
        }
      };
      
      sseManager.registerHandler('workflow', handleWorkflowUpdate);
      
      return () => {
        sseManager.unregisterHandler('workflow', handleWorkflowUpdate);
      };
    });
  }, [currentJobId, isRunning]);
  
  return currentTask;
}
