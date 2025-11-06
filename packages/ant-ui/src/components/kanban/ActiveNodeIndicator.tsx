/**
 * ActiveNodeIndicator Component
 * 
 * Task Board의 In Progress 카드 아래에 표시되는
 * 현재 활성 노드 및 Actor 정보
 */

import { useWorkflowState } from '../workflow/hooks';
import { useStore } from '@/lib/store';

export function ActiveNodeIndicator() {
  const currentJob = useStore(state => state.currentJob);
  const isRunning = useStore(state => state.isRunning);
  
  // 실시간 워크플로우 상태 구독
  const workflowState = useWorkflowState(currentJob?.jobId);
  
  // Job이 실행 중이 아니거나 워크플로우 상태가 없으면 표시 안 함
  if (!isRunning || !workflowState || !workflowState.currentNode) {
    return null;
  }
  
  // 노드 이름을 사람이 읽기 쉽게 변환
  const formatNodeName = (nodeId: string): string => {
    return nodeId
      .split(/(?=[A-Z])/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };
  
  return (
    <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
      <div className="flex flex-col gap-1.5">
        {/* Current Node */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <div className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
            </div>
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
              Node:
            </span>
          </div>
          <span className="text-xs text-blue-600 dark:text-blue-400 font-semibold">
            {formatNodeName(workflowState.currentNode)}
          </span>
        </div>
        
        {/* Active Actors */}
        {workflowState.activeActors && workflowState.activeActors.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
              </div>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                Actors:
              </span>
            </div>
            <span className="text-xs text-purple-600 dark:text-purple-400 font-semibold">
              {workflowState.activeActors.map(formatNodeName).join(', ')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

