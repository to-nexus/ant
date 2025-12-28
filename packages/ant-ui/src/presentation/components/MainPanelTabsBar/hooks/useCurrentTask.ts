import * as React from 'react';

export function useCurrentTask(currentJobId: string | undefined, isRunning: boolean) {
  const [currentTask, setCurrentTask] = React.useState<any>(null);
  
  React.useEffect(() => {
    if (!currentJobId || !isRunning) {
      setCurrentTask(null);
      return;
    }
    
    let cancelled = false;
    const handleWorkflowUpdate = (data: any) => {
      // ✅ Filter by jobId to avoid cross-job contamination in multi-project environments.
      if (data?.jobId && data.jobId !== currentJobId) return;
      if (data.currentTask) setCurrentTask(data.currentTask);
    };

    // Dynamic import to avoid SSR issues
    (async () => {
      const { sseManager } = await import('@/infrastructure/sse/SSEManager');
      if (cancelled) return;
      sseManager.registerHandler('workflow', handleWorkflowUpdate);
    })();
    
    return () => {
      cancelled = true;
      import('@/infrastructure/sse/SSEManager').then(({ sseManager }) => {
        sseManager.unregisterHandler('workflow', handleWorkflowUpdate);
      });
    };
  }, [currentJobId, isRunning]);
  
  return currentTask;
}
