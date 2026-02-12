/**
 * WorkflowNode Component
 * 
 * 범용 워크플로우 노드 컴포넌트
 * NodeType과 NodeImportance에 따라 스타일 적용
 */

import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Handle, Position } from 'reactflow';
import { Settings } from 'lucide-react';
import { NodeType, NodeImportance, ActiveWorkerNode } from '@/domain/models/workflow';
import { useStore } from '@/domain/store';
import { cn } from '@/shared/utils/design-system';
import { getActorInfoList } from '@/shared/utils/actor-utils';

interface NodeData {
  label: string;
  description?: string;
  importance: NodeImportance;
  isActive?: boolean;
  workers?: ActiveWorkerNode[];  // Workers currently active on this node
  nodeType: NodeType;
  actors?: string[];  // Actor IDs
  isExpanded?: boolean;  // 확장 상태
  llmInfo?: { provider: string; model: string };  // ✅ 백엔드에서 받은 실제 LLM 정보
}

interface WorkflowNodeProps {
  data: NodeData;
}

// 노드 타입별 색상 (라이트 모드)
const NODE_COLORS_LIGHT: Record<NodeType, string> = {
  [NodeType.ENTRY]: 'bg-green-100 border-green-500 text-green-900',
  [NodeType.PROCESS]: 'bg-blue-100 border-blue-500 text-blue-900',
  [NodeType.DECISION]: 'bg-yellow-100 border-yellow-500 text-yellow-900',
  [NodeType.CHECKPOINT]: 'bg-purple-100 border-purple-500 text-purple-900',
  [NodeType.END]: 'bg-red-100 border-red-500 text-red-900'
};

// 노드 타입별 색상 (다크 모드)
const NODE_COLORS_DARK: Record<NodeType, string> = {
  [NodeType.ENTRY]: 'dark:bg-green-900 dark:border-green-400 dark:text-green-100',
  [NodeType.PROCESS]: 'dark:bg-blue-900 dark:border-blue-400 dark:text-blue-100',
  [NodeType.DECISION]: 'dark:bg-yellow-900 dark:border-yellow-400 dark:text-yellow-100',
  [NodeType.CHECKPOINT]: 'dark:bg-purple-900 dark:border-purple-400 dark:text-purple-100',
  [NodeType.END]: 'dark:bg-red-900 dark:border-red-400 dark:text-red-100'
};

// 노드 크기
const NODE_SIZE = {
  collapsed: {
    width: 160,
    height: 64,
    fontSize: '14px',
    fontWeight: '600',
    borderWidth: 2
  },
  expanded: {
    width: 360,
    height: 120,
    fontSize: '14px',
    fontWeight: '600',
    borderWidth: 3
  }
};

export const WorkflowNode = memo(({ data }: WorkflowNodeProps) => {
  const { t } = useTranslation('kanban');
  const splitLayout = useStore(state => state.splitLayout);
  const isExpanded = data.isExpanded || false;
  const size = isExpanded ? NODE_SIZE.expanded : NODE_SIZE.collapsed;
  const colorClass = `${NODE_COLORS_LIGHT[data.nodeType]} ${NODE_COLORS_DARK[data.nodeType]}`;
  
  const actorInfoList = getActorInfoList(data.actors || [], data.llmInfo);
  
  // ✅ Track isActive changes
  useEffect(() => {
    if (data.isActive) {
      // console.log('[WorkflowNode] ⭐ NODE ACTIVE:', data.label); // ✅ Too verbose
    }
  }, [data.isActive, data.label]);
  
  // 화면 분할 방향에 따라 Handle 위치 변경
  const targetPosition = splitLayout === 'horizontal' ? Position.Top : Position.Left;
  const sourcePosition = splitLayout === 'horizontal' ? Position.Bottom : Position.Right;
  
  if (isExpanded) {
    // 확장된 상태
    return (
      <div
        className={cn(
          'workflow-node rounded-lg border transition-all duration-300 relative',
          colorClass,
          'shadow-xl',
          data.isActive && 'ring-4 ring-green-500 ring-opacity-50'
        )}
        style={{
          width: size.width,
          borderWidth: size.borderWidth,
          zIndex: 1000  // 최상위 depth
        }}
      >
        <Handle 
          type="target" 
          position={targetPosition}
          className="!bg-gray-400 dark:!bg-gray-600"
        />
        
        {/* Expanded Content */}
        <div className="p-4 space-y-3">
          {/* Title */}
          <div className="text-center">
            <div 
              className="font-semibold"
              style={{ fontSize: size.fontSize }}
            >
              {data.label}
            </div>
            {data.isActive && (
              <div className="mt-2 flex items-center gap-2">
                <Settings className="w-4 h-4 text-green-600 dark:text-green-400 animate-spin" />
                <span className="text-xs text-green-600 dark:text-green-400 font-bold">
                  {t('workflow.active')}
                </span>
              </div>
            )}
          </div>
          
          {/* Description */}
          {data.description && (
            <div className="text-xs opacity-80 leading-relaxed">
              {data.description}
            </div>
          )}
          
          {/* Linked Actors */}
          {actorInfoList.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold opacity-70">{t('workflow.linkedActors')}</div>
              <div className="flex flex-wrap gap-2">
                {actorInfoList.map((actor) => (
                  <div 
                    key={actor.id}
                    className="text-xs px-2 py-1 rounded bg-black/5 dark:bg-white/5 flex items-center gap-1.5"
                  >
                    <span>{actor.icon}</span>
                    <span className="font-medium">{actor.displayName}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        
        <Handle 
          type="source" 
          position={sourcePosition}
          className="!bg-gray-400 dark:!bg-gray-600"
        />
      </div>
    );
  }
  
  // 접힌 상태 (기본)
  return (
    <div
      className={cn(
        'workflow-node rounded-lg flex flex-col items-center justify-center relative',
        'border transition-all duration-200 cursor-pointer hover:shadow-lg',
        colorClass,
        data.isActive && 'ring-4 ring-green-500 ring-opacity-50 shadow-lg shadow-green-500/50'
      )}
      style={{
        width: size.width,
        height: size.height,
        borderWidth: data.isActive ? 3 : size.borderWidth,
        zIndex: 1  // 기본 z-index, 확장 시 1000으로 변경
      }}
    >
      <Handle 
        type="target" 
        position={targetPosition}
        className="!bg-gray-400 dark:!bg-gray-600"
      />
      
      <div className="text-center px-2 w-full">
        <div 
          className="truncate" 
          style={{ 
            fontSize: size.fontSize, 
            fontWeight: size.fontWeight 
          }}
          title={data.label}
        >
          {data.label}
        </div>
        
        {data.isActive && (
          <div className="mt-2 flex items-center gap-1.5">
            <Settings className="w-4 h-4 text-green-600 dark:text-green-400 animate-spin" />
            <span className="text-xs text-green-600 dark:text-green-400 font-bold">
              {t('workflow.active')}
            </span>
          </div>
        )}
      </div>
      
      {/* Task label badges for parallel workers — column layout for readability */}
      {data.isActive && data.workers && data.workers.length > 0 && (
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 translate-y-full flex flex-col items-center gap-0.5">
          {data.workers.map((w) => (
            <span key={w.workerId}
              className="text-[10px] bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 px-1.5 py-0.5 rounded-full whitespace-nowrap shadow-sm">
              {w.taskName}
            </span>
          ))}
        </div>
      )}
      
      <Handle 
        type="source" 
        position={sourcePosition}
        className="!bg-gray-400 dark:!bg-gray-600"
      />
    </div>
  );
});

WorkflowNode.displayName = 'WorkflowNode';

