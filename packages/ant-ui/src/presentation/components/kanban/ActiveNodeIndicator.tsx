/**
 * ActiveNodeIndicator Component
 * 
 * Task Board의 In Progress 카드 아래에 표시되는
 * 현재 활성 노드 및 Actor 정보
 * 
 * Refactored for parallel execution:
 * - Uses activeNodes[] instead of currentNode
 * - Shows multiple active nodes with task names
 */

import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { WorkflowRealtimeState } from '@/domain/models/workflow';
import { useStore } from '@/domain/store';

interface ActiveNodeIndicatorProps {
  displayedState: WorkflowRealtimeState | null;
}

function ActiveNodeIndicatorComponent({ displayedState }: ActiveNodeIndicatorProps) {
  const { t } = useTranslation('kanban');
  const isRunning = useStore(state => state.isRunning);
  const isStopping = useStore(state => state.isStopping);
  
  const shouldShow = isRunning && !isStopping;
  
  if (!shouldShow || !displayedState?.activeNodes?.length) {
    return null;
  }
  
  const formatNodeName = (nodeId: string): string => {
    return nodeId
      .split(/(?=[A-Z])/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };
  
  return (
    <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
      <div className="flex flex-col gap-1.5">
        {/* Active Nodes (one per worker) */}
        {displayedState.activeNodes.map(node => (
          <div key={node.workerId} className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
              </div>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {t('activeNode.node')}
              </span>
            </div>
            <span className="text-xs text-blue-600 dark:text-blue-400 font-semibold">
              {formatNodeName(node.nodeId)}
            </span>
            {node.taskName && node.taskName !== 'unknown' && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                ({node.taskName})
              </span>
            )}
          </div>
        ))}
        
        {/* Active Actors */}
        {displayedState.activeActors && displayedState.activeActors.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
              </div>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {t('activeNode.actors')}
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

export const ActiveNodeIndicator = memo(ActiveNodeIndicatorComponent);
