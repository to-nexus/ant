/**
 * ActorNode Component
 * 
 * External Actor 노드 (LLM, Vector DB, File System 등)
 * 워크플로우 노드와 다른 디자인으로 구분
 */

import React, { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { Settings } from 'lucide-react';
import { ActorType } from '@/types/workflow';
import { useStore } from '@/lib/store';
import { cn } from '@/lib/design-system';
import { getActorInfo } from '@/lib/actor-utils';

interface ActorNodeData {
  label: string;
  actorType: ActorType;
  actorId?: string;  // Actor ID (실제 정보 조회용)
  icon?: string;
  isActive?: boolean;  // Actor 활성화 상태 (통신 중)
  isExpanded?: boolean;  // 확장 상태
}

interface ActorNodeProps {
  data: ActorNodeData;
}

// Actor 타입별 색상 (라이트 모드)
const ACTOR_COLORS_LIGHT: Record<ActorType, string> = {
  [ActorType.LLM]: 'bg-purple-50 dark:bg-purple-900/20 border-purple-300 dark:border-purple-700',
  [ActorType.VECTOR_DB]: 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700',
  [ActorType.LOCAL_STORAGE]: 'bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700',
  [ActorType.FILE_SYSTEM]: 'bg-orange-50 dark:bg-orange-900/20 border-orange-300 dark:border-orange-700',
  [ActorType.CODE_REPO]: 'bg-cyan-50 dark:bg-cyan-900/20 border-cyan-300 dark:border-cyan-700',
  [ActorType.TOOL]: 'bg-gray-50 dark:bg-gray-900/20 border-gray-300 dark:border-gray-700',
  [ActorType.EMBEDDING]: 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-300 dark:border-indigo-700',
};

// Actor 타입별 색상 (다크 모드)
const ACTOR_COLORS_DARK: Record<ActorType, string> = {
  [ActorType.LLM]: 'dark:bg-purple-900/20 dark:border-purple-700',
  [ActorType.VECTOR_DB]: 'dark:bg-blue-900/20 dark:border-blue-700',
  [ActorType.LOCAL_STORAGE]: 'dark:bg-green-900/20 dark:border-green-700',
  [ActorType.FILE_SYSTEM]: 'dark:bg-orange-900/20 dark:border-orange-700',
  [ActorType.CODE_REPO]: 'dark:bg-cyan-900/20 dark:border-cyan-700',
  [ActorType.TOOL]: 'dark:bg-gray-900/20 dark:border-gray-700',
  [ActorType.EMBEDDING]: 'dark:bg-indigo-900/20 dark:border-indigo-700',
};

export const ActorNode = memo(({ data }: ActorNodeProps) => {
  const { splitLayout, selectedProject, selectedFeature } = useStore();
  const [isExpanded, setIsExpanded] = React.useState(data.isExpanded || false);
  
  // Actor 정보 조회
  const baseActorInfo = data.actorId ? getActorInfo(data.actorId) : null;
  
  // 실제 경로로 details 동적 생성
  const actorInfo = React.useMemo(() => {
    if (!baseActorInfo) return null;
    
    // local-storage와 file-system의 경우 실제 경로로 치환
    if (data.actorId === 'local-storage' && selectedProject && selectedFeature) {
      return {
        ...baseActorInfo,
        details: `./workspace/${selectedProject}/${selectedFeature}/outputs/session.json`
      };
    }
    
    if (data.actorId === 'file-system' && selectedProject && selectedFeature) {
      return {
        ...baseActorInfo,
        details: `./workspace/${selectedProject}/${selectedFeature}/outputs/`
      };
    }
    
    if (data.actorId === 'code-repo' && selectedProject && selectedFeature) {
      // TODO: config에서 localPath 가져오기 (지금은 placeholder)
      return {
        ...baseActorInfo,
        details: `~/dev/${selectedProject}` // config.localPath
      };
    }
    
    return baseActorInfo;
  }, [baseActorInfo, data.actorId, selectedProject, selectedFeature]);
  
  const colorClass = `${ACTOR_COLORS_LIGHT[data.actorType]} ${ACTOR_COLORS_DARK[data.actorType]}`;
  
  // 화면 분할 방향에 따라 Handle 위치 변경
  const targetPosition = splitLayout === 'horizontal' ? Position.Top : Position.Left;
  
  // LOCAL_STORAGE와 VECTOR_DB는 DB 모양 (실린더)
  const isDatabase = data.actorType === ActorType.LOCAL_STORAGE || data.actorType === ActorType.VECTOR_DB;
  
  // 확장된 상태
  if (isExpanded && actorInfo) {
    // Storage 계열 (DB 모양)은 DB 형태 유지하며 확장
    if (isDatabase) {
      return (
        <div
          className={cn(
            'actor-node flex flex-col items-center justify-start relative cursor-pointer',
            'border-2 border-dashed transition-all duration-300 shadow-xl p-4',
            colorClass
          )}
          style={{
            width: 280,
            minHeight: 200,
            borderRadius: '50% / 10%',
            borderBottomLeftRadius: '50% / 40%',
            borderBottomRightRadius: '50% / 40%',
            zIndex: 1000  // 최상위 depth
          }}
          onClick={() => setIsExpanded(false)}
        >
          <Handle type="target" position={Position.Left} className="!bg-gray-400 dark:!bg-gray-600" />
          <Handle type="source" position={Position.Right} className="!bg-gray-400 dark:!bg-gray-600" />
          
          {/* Top ellipse (enlarged) */}
          <div 
            className={cn(
              'absolute top-0 left-0 right-0 border-2 border-dashed',
              colorClass
            )}
            style={{
              height: '30px',
              borderRadius: '50%',
              borderBottom: 'none',
            }}
          />
          
          <div className="space-y-3 pt-8 w-full">
            {/* Title with Gear Icon */}
            <div className="text-center">
              <div className="text-3xl mb-2 relative inline-block">
                {actorInfo.icon}
                {data.isActive && (
                  <div className="absolute -top-1 -right-1">
                    <Settings className="w-5 h-5 text-green-500 animate-spin" />
                  </div>
                )}
              </div>
              <div className="font-semibold text-sm text-gray-900 dark:text-white">{actorInfo.displayName}</div>
            </div>
            
            {/* Details */}
            <div className="space-y-2 text-xs text-gray-800 dark:text-gray-200">
              <div>
                <div className="font-semibold opacity-70 mb-1">Provider:</div>
                <div className="opacity-90">{actorInfo.provider}</div>
              </div>
              <div>
                <div className="font-semibold opacity-70 mb-1">Model/System:</div>
                <div className="opacity-90">{actorInfo.model}</div>
              </div>
              {actorInfo.details && (
                <div>
                  <div className="font-semibold opacity-70 mb-1">Details:</div>
                  <div className="opacity-90 break-all">{actorInfo.details}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }
    
    // 원형 Actor는 아주 둥근 모서리 사각형으로 확장
    return (
      <div
        className={cn(
          'actor-node border-2 transition-all duration-300 shadow-xl p-4 relative',
          colorClass,
          'cursor-pointer'
        )}
        style={{
          width: 280,
          borderRadius: '32px',  // 아주 둥근 모서리
          zIndex: 1000  // 최상위 depth
        }}
        onClick={() => setIsExpanded(false)}
      >
        <Handle type="target" position={Position.Left} className="!bg-gray-400 dark:!bg-gray-600" />
        <Handle type="source" position={Position.Right} className="!bg-gray-400 dark:!bg-gray-600" />

        <div className="space-y-3">
          {/* Title with Gear Icon */}
          <div className="text-center">
            <div className="text-3xl mb-2 relative inline-block">
              {actorInfo.icon}
              {data.isActive && (
                <div className="absolute -top-1 -right-1">
                  <Settings className="w-5 h-5 text-green-500 animate-spin" />
                </div>
              )}
            </div>
            <div className="font-semibold text-sm text-gray-900 dark:text-white">{actorInfo.displayName}</div>
          </div>

          {/* Details */}
          <div className="space-y-2 text-xs text-gray-800 dark:text-gray-200">
            <div>
              <div className="font-semibold opacity-70 mb-1">Provider:</div>
              <div className="opacity-90">{actorInfo.provider}</div>
            </div>
            <div>
              <div className="font-semibold opacity-70 mb-1">Model/System:</div>
              <div className="opacity-90">{actorInfo.model}</div>
            </div>
            {actorInfo.details && (
              <div>
                <div className="font-semibold opacity-70 mb-1">Details:</div>
                <div className="opacity-90 break-all">{actorInfo.details}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
  
  // 접힌 상태 (기본) - DB 모양
  if (isDatabase) {
    return (
      <div
        className={cn(
          'actor-node flex flex-col items-center justify-center relative cursor-pointer',
          'border-2 border-dashed transition-all duration-200 hover:shadow-lg',
          colorClass,
          data.isActive && 'ring-4 ring-green-500 ring-opacity-50 shadow-lg shadow-green-500/50 animate-pulse'
        )}
        style={{
          width: 120,
          height: 80,
          borderRadius: '50% / 10%',
          borderBottomLeftRadius: '50% / 40%',
          borderBottomRightRadius: '50% / 40%',
          zIndex: 1
        }}
        onClick={() => setIsExpanded(true)}
      >
        <Handle type="target" position={targetPosition} className="!bg-gray-400 dark:!bg-gray-600" />
        <Handle type="source" position={Position.Right} className="!bg-gray-400 dark:!bg-gray-600" />
        
        {/* Top ellipse (compact) */}
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
        
        <div className="text-2xl mb-1 relative inline-block">
          {data.icon || actorInfo?.icon}
          {data.isActive && (
            <div className="absolute -top-0.5 -right-0.5">
              <Settings className="w-4 h-4 text-green-500 animate-spin" />
            </div>
          )}
        </div>
        <div className="text-xs font-medium text-center px-2 leading-tight text-gray-900 dark:text-white">
          {data.label}
        </div>
      </div>
    );
  }
  
  // 접힌 상태 (기본) - 원형
  return (
    <div
      className={cn(
        'actor-node rounded-full flex flex-col items-center justify-center relative',
        'border-2 transition-all duration-200 cursor-pointer hover:shadow-lg',
        colorClass,
        data.isActive && 'ring-4 ring-green-500 ring-opacity-50 shadow-lg shadow-green-500/50 animate-pulse'
      )}
      style={{
        width: 100,
        height: 100,
        zIndex: 1
      }}
      onClick={() => setIsExpanded(true)}
    >
      <Handle type="target" position={targetPosition} className="!bg-gray-400 dark:!bg-gray-600" />
      <Handle type="source" position={Position.Right} className="!bg-gray-400 dark:!bg-gray-600" />
      
      <div className="text-2xl mb-1 relative inline-block">
        {data.icon || actorInfo?.icon}
        {data.isActive && (
          <div className="absolute -top-0.5 -right-0.5">
            <Settings className="w-4 h-4 text-green-500 animate-spin" />
          </div>
        )}
      </div>
      <div className="text-xs font-medium text-center px-2 leading-tight text-gray-900 dark:text-white">
        {data.label}
      </div>
    </div>
  );
});

ActorNode.displayName = 'ActorNode';
