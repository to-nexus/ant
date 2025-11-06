/**
 * WorkflowNode Component
 * 
 * 범용 워크플로우 노드 컴포넌트
 * NodeType과 NodeImportance에 따라 스타일 적용
 */

import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { NodeType, NodeImportance } from '@/types/workflow';
import { useStore } from '@/lib/store';
import { cn } from '@/lib/design-system';

interface NodeData {
  label: string;
  description?: string;
  importance: NodeImportance;
  isActive?: boolean;
  nodeType: NodeType;
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

// 중요도별 크기
const NODE_SIZES: Record<NodeImportance, { width: number; height: number; fontSize: string; fontWeight: string; borderWidth: number }> = {
  [NodeImportance.CRITICAL]: {
    width: 200,
    height: 80,
    fontSize: '16px',
    fontWeight: 'bold',
    borderWidth: 3
  },
  [NodeImportance.MAJOR]: {
    width: 160,
    height: 64,
    fontSize: '14px',
    fontWeight: '600',
    borderWidth: 2
  },
  [NodeImportance.MINOR]: {
    width: 120,
    height: 48,
    fontSize: '12px',
    fontWeight: 'normal',
    borderWidth: 1
  }
};

export const WorkflowNode = memo(({ data }: WorkflowNodeProps) => {
  const theme = useStore(state => state.theme);
  const splitLayout = useStore(state => state.splitLayout);
  const size = NODE_SIZES[data.importance];
  const colorClass = `${NODE_COLORS_LIGHT[data.nodeType]} ${NODE_COLORS_DARK[data.nodeType]}`;
  
  // 화면 분할 방향에 따라 Handle 위치 변경
  // horizontal (좌우 분할) → 워크플로우 세로 (TB) → Top/Bottom handles
  // vertical (상하 분할) → 워크플로우 가로 (LR) → Left/Right handles
  const targetPosition = splitLayout === 'horizontal' ? Position.Top : Position.Left;
  const sourcePosition = splitLayout === 'horizontal' ? Position.Bottom : Position.Right;
  
  return (
    <div
      className={cn(
        'workflow-node rounded-lg flex flex-col items-center justify-center',
        'border transition-all duration-200',
        colorClass,
        data.isActive && 'ring-4 ring-green-500 ring-opacity-50 shadow-lg shadow-green-500/50'
      )}
      style={{
        width: size.width,
        height: size.height,
        borderWidth: data.isActive ? 3 : size.borderWidth,
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
          <div className="mt-1 text-xs text-green-600 dark:text-green-400 font-bold animate-pulse">
            ● Active
          </div>
        )}
        
        {data.description && !data.isActive && (
          <div 
            className="mt-0.5 text-xs opacity-70 truncate"
            title={data.description}
          >
            {data.description}
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
});

WorkflowNode.displayName = 'WorkflowNode';

