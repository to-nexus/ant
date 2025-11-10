/**
 * ActiveNodeIndicator Component
 * 
 * Task Board의 In Progress 카드 아래에 표시되는
 * 현재 활성 노드 및 Actor 정보
 * 
 * ⚠️ CRITICAL: WorkflowVisualization과 displayedState를 공유
 * → 중복 SSE 연결 방지 (각각 useWorkflowState 호출하면 2개 연결 생성!)
 */

import { memo } from 'react';
import { WorkflowRealtimeState } from '@/domain/models/workflow';
import { useStore } from '@/domain/store';

interface ActiveNodeIndicatorProps {
  displayedState: WorkflowRealtimeState | null;
}

function ActiveNodeIndicatorComponent({ displayedState }: ActiveNodeIndicatorProps) {
  // ✅ Store에서 직접 필요한 값만 구독
  const isRunning = useStore(state => state.isRunning);
  const isStopping = useStore(state => state.isStopping);
  
  // 🔍 DEBUG
  console.log('[ActiveNodeIndicator] Debug:', {
    isRunning,
    isStopping,
    hasDisplayedState: !!displayedState,
    currentNode: displayedState?.currentNode,
    currentTask: displayedState?.currentTask?.name
  });
  
  // ✅ UI 정책: 실행 중이고 중단 중이 아닐 때만 표시
  const shouldShow = isRunning && !isStopping;
  
  if (!shouldShow || !displayedState || !displayedState.currentNode) {
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
            {formatNodeName(displayedState.currentNode)}
          </span>
        </div>
        
        {/* Active Actors */}
        {displayedState.activeActors && displayedState.activeActors.length > 0 && (
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
              {displayedState.activeActors.map(formatNodeName).join(', ')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ✅ CRITICAL: React.memo로 감싸서 부모의 재렌더링으로부터 격리
// ActiveNodeIndicator는 props가 없으므로, store의 값이 변경될 때만 재렌더링됨
export const ActiveNodeIndicator = memo(ActiveNodeIndicatorComponent);

