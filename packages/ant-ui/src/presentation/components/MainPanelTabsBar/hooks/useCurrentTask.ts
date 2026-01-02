import * as React from 'react';
import type { HandlerId } from '@/infrastructure/sse/SSEManager';

export function useCurrentTask(currentJobId: string | undefined, isRunning: boolean) {
  const [currentTask, setCurrentTask] = React.useState<any>(null);
  
  // ✅ CRITICAL: 핸들러 ID를 ref로 관리하여 비동기 cleanup 문제 해결
  const handlerIdRef = React.useRef<HandlerId | null>(null);
  
  React.useEffect(() => {
    if (!currentJobId || !isRunning) {
      setCurrentTask(null);
      return;
    }
    
    // ✅ CRITICAL: 이전 핸들러가 있으면 즉시 해제 (비동기 cleanup 문제 방지)
    if (handlerIdRef.current !== null) {
      import('@/infrastructure/sse/SSEManager').then(({ sseManager }) => {
        if (handlerIdRef.current !== null) {
          sseManager.unregisterHandlerById(handlerIdRef.current);
          handlerIdRef.current = null;
        }
      });
    }
    
    const handleWorkflowUpdate = (data: any) => {
      // ✅ Filter by jobId to avoid cross-job contamination in multi-project environments.
      if (data?.jobId && data.jobId !== currentJobId) return;
      if (data.currentTask) setCurrentTask(data.currentTask);
    };

    // Dynamic import to avoid SSR issues
    // ✅ ID 기반 등록으로 정확한 해제 보장
    import('@/infrastructure/sse/SSEManager').then(({ sseManager }) => {
      const id = sseManager.registerHandlerWithId('workflow', handleWorkflowUpdate);
      handlerIdRef.current = id;
    });
    
    return () => {
      // ✅ Cleanup: ID 기반 해제 (비동기지만 ref로 정확한 핸들러 식별)
      const idToRemove = handlerIdRef.current;
      if (idToRemove !== null) {
        import('@/infrastructure/sse/SSEManager').then(({ sseManager }) => {
          sseManager.unregisterHandlerById(idToRemove);
        });
        handlerIdRef.current = null;
      }
    };
  }, [currentJobId, isRunning]);
  
  return currentTask;
}
