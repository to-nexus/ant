/**
 * ActorNode Component
 * 
 * External Actor 노드 (LLM, Vector DB, File System 등)
 * 워크플로우 노드와 다른 디자인으로 구분
 */

import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { ActorType } from '@/types/workflow';
import { useStore } from '@/lib/store';
import { cn } from '@/lib/design-system';

interface ActorNodeData {
  label: string;
  actorType: ActorType;
  icon?: string;
}

interface ActorNodeProps {
  data: ActorNodeData;
}

// Actor 타입별 색상 (라이트 모드)
const ACTOR_COLORS_LIGHT: Record<ActorType, string> = {
  [ActorType.LLM]: 'bg-purple-50 border-purple-400 text-purple-900',
  [ActorType.EMBEDDING]: 'bg-indigo-50 border-indigo-400 text-indigo-900',
  [ActorType.VECTOR_DB]: 'bg-cyan-50 border-cyan-400 text-cyan-900',
  [ActorType.LOCAL_STORAGE]: 'bg-amber-50 border-amber-400 text-amber-900',
  [ActorType.FILE_SYSTEM]: 'bg-lime-50 border-lime-400 text-lime-900',
  [ActorType.TOOL]: 'bg-orange-50 border-orange-400 text-orange-900'
};

// Actor 타입별 색상 (다크 모드)
const ACTOR_COLORS_DARK: Record<ActorType, string> = {
  [ActorType.LLM]: 'dark:bg-purple-950 dark:border-purple-500 dark:text-purple-100',
  [ActorType.EMBEDDING]: 'dark:bg-indigo-950 dark:border-indigo-500 dark:text-indigo-100',
  [ActorType.VECTOR_DB]: 'dark:bg-cyan-950 dark:border-cyan-500 dark:text-cyan-100',
  [ActorType.LOCAL_STORAGE]: 'dark:bg-amber-950 dark:border-amber-500 dark:text-amber-100',
  [ActorType.FILE_SYSTEM]: 'dark:bg-lime-950 dark:border-lime-500 dark:text-lime-100',
  [ActorType.TOOL]: 'dark:bg-orange-950 dark:border-orange-500 dark:text-orange-100'
};

export const ActorNode = memo(({ data }: ActorNodeProps) => {
  const theme = useStore(state => state.theme);
  const splitLayout = useStore(state => state.splitLayout);
  const colorClass = `${ACTOR_COLORS_LIGHT[data.actorType]} ${ACTOR_COLORS_DARK[data.actorType]}`;
  
  // 화면 분할 방향에 따라 Handle 위치 변경
  const targetPosition = splitLayout === 'horizontal' ? Position.Top : Position.Left;
  
  // LOCAL_STORAGE와 VECTOR_DB는 DB 모양 (실린더)
  const isDatabase = data.actorType === ActorType.LOCAL_STORAGE || data.actorType === ActorType.VECTOR_DB;
  
  if (isDatabase) {
    return (
      <div
        className={cn(
          'actor-node flex flex-col items-center justify-center relative',
          'border-2 border-dashed transition-all duration-200 shadow-md',
          colorClass
        )}
        style={{
          width: 100,
          height: 100,
          borderRadius: '50% / 10%',
          borderBottomLeftRadius: '50% / 40%',
          borderBottomRightRadius: '50% / 40%',
        }}
      >
        <Handle 
          type="target" 
          position={targetPosition}
          className="!bg-gray-400 dark:!bg-gray-600 !border-2 !border-white dark:!border-gray-800"
        />
        
        {/* Top ellipse */}
        <div 
          className={cn(
            'absolute top-0 left-0 right-0 border-2 border-dashed',
            colorClass
          )}
          style={{
            height: '20px',
            borderRadius: '50%',
            borderBottom: 'none',
          }}
        />
        
        <div className="text-center px-2 pt-3">
          {data.icon && (
            <div className="text-2xl mb-1">{data.icon}</div>
          )}
          <div 
            className="text-xs font-semibold leading-tight"
            style={{ 
              fontSize: '11px',
            }}
          >
            {data.label}
          </div>
        </div>
      </div>
    );
  }
  
  // 기타 Actor는 원형
  return (
    <div
      className={cn(
        'actor-node rounded-full flex items-center justify-center',
        'border-2 border-dashed transition-all duration-200 shadow-md',
        colorClass
      )}
      style={{
        width: 100,
        height: 100,
      }}
    >
      <Handle 
        type="target" 
        position={targetPosition}
        className="!bg-gray-400 dark:!bg-gray-600 !border-2 !border-white dark:!border-gray-800"
      />
      
      <div className="text-center px-2">
        {data.icon && (
          <div className="text-2xl mb-1">{data.icon}</div>
        )}
        <div 
          className="text-xs font-semibold leading-tight"
          style={{ 
            fontSize: '11px',
          }}
        >
          {data.label}
        </div>
      </div>
    </div>
  );
});

ActorNode.displayName = 'ActorNode';

