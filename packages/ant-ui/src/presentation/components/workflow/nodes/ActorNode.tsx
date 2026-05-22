/**
 * ActorNode Component
 * 
 * External Actor 노드 (LLM, Vector DB, File System 등)
 * 워크플로우 노드와 다른 디자인으로 구분
 */

import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Handle, Position } from 'reactflow';
import { ActorType } from '@/domain/models/workflow';
import { useStore } from '@/domain/store';
import { cn } from '@/shared/utils/design-system';
import { getActorInfo } from '@/shared/utils/actor-utils';
import { getDisplayPath } from '@/shared/utils/workspace-path';
import { fetchProjectConfig, type ProjectConfig } from '@/infrastructure/http/api/config';

interface ActorNodeData {
  label: string;
  actorType: ActorType;
  actorId?: string;  // Actor ID (실제 정보 조회용)
  icon?: string;
  isActive?: boolean;  // Actor 활성화 상태 (통신 중)
  isExpanded?: boolean;  // 확장 상태
  llmInfo?: { provider: string; model: string };  // ✅ 백엔드에서 받은 실제 LLM 정보
}

interface ActorNodeProps {
  data: ActorNodeData;
}

// Aurora-tokenized surface — actor type differentiation comes from icon + label,
// not from per-type tints. ActorType is retained on the interface for domain
// continuity and may be used by future variants.
void ActorType;

export const ActorNode = memo(({ data }: ActorNodeProps) => {
  const { selectedProject, selectedFeature } = useStore();
  const { t } = useTranslation('kanban');
  const [isExpanded, setIsExpanded] = React.useState(data.isExpanded || false);
  const [config, setConfig] = React.useState<ProjectConfig | null>(null);

  // Fetch config for localPath (code-repo). Uses fetchProjectConfig SSOT so
  // split-host deployments resolve through API_BASE() with credentials —
  // a hardcoded relative `/api/...` would hit the SPA origin (e.g. ant.crosstoken.io)
  // and 401 against the marketing site instead of the API server.
  React.useEffect(() => {
    if (!selectedProject) return;
    fetchProjectConfig(selectedProject)
      .then(setConfig)
      .catch(() => setConfig(null));
  }, [selectedProject]);
  
  // ✅ Actor 정보 조회 (LLM인 경우 data.llmInfo 사용)
  // llmInfo는 이미 useGraphLayout에서 realtimeState 또는 config로부터 설정됨
  const baseActorInfo = data.actorId ? getActorInfo(data.actorId, data.llmInfo || undefined) : null;
  
  // 실제 경로로 details 동적 생성
  const actorInfo = React.useMemo(() => {
    if (!baseActorInfo) return null;
    
    // local-storage: 세션 파일 경로 (중앙화된 경로 사용)
    if (data.actorId === 'local-storage' && selectedProject && selectedFeature) {
      return {
        ...baseActorInfo,
        details: getDisplayPath(selectedProject, selectedFeature, 'sessions/')
      };
    }
    
    // file-system: 산출물 디렉토리 경로 (architecture/visual/meta/evals 도메인 그룹)
    if (data.actorId === 'file-system' && selectedProject && selectedFeature) {
      return {
        ...baseActorInfo,
        details: getDisplayPath(selectedProject, selectedFeature, 'architecture/ • visual/ • meta/evals/')
      };
    }
    
    // code-repo: config의 localPath 사용 (변경 없음)
    if (data.actorId === 'code-repo' && config) {
      return {
        ...baseActorInfo,
        details: config.localPath || `~/dev/${selectedProject}`
      };
    }
    
    return baseActorInfo;
  }, [baseActorInfo, data.actorId, selectedProject, selectedFeature, config]);
  
  // Fixed LR — workflow is full-pane, edges flow left → right.
  const targetPosition = Position.Left;

  // LOCAL_STORAGE와 VECTOR_DB는 DB 모양 (실린더)
  const isDatabase = data.actorType === ActorType.LOCAL_STORAGE || data.actorType === ActorType.VECTOR_DB;

  // Aurora running-state borderglow (matches WorkflowNode running signal).
  const runningGlowShadow =
    '0 0 0 2px var(--violet-500), 0 0 24px var(--shadow-glow-aurora)';

  // Common surface style — auto theme-flips via aurora-tokens.css.
  const baseSurface: React.CSSProperties = {
    background: 'var(--bg-surface)',
    color: 'var(--text-1)',
  };

  // 확장된 상태
  if (isExpanded && actorInfo) {
    // Storage 계열 (DB 모양)은 DB 형태 유지하며 확장
    if (isDatabase) {
      const expandedDbStyle: React.CSSProperties = {
        ...baseSurface,
        width: 280,
        minHeight: 200,
        borderRadius: '50% / 10%',
        borderBottomLeftRadius: '50% / 40%',
        borderBottomRightRadius: '50% / 40%',
        border: data.isActive ? '2px solid transparent' : '2px dashed var(--border-1)',
        boxShadow: data.isActive
          ? `var(--shadow-lg, 0 10px 30px rgba(0,0,0,0.18)), ${runningGlowShadow}`
          : 'var(--shadow-lg, 0 10px 30px rgba(0,0,0,0.18))',
        zIndex: 1000,
      };

      return (
        <div
          className="actor-node flex flex-col items-center justify-start relative cursor-pointer transition-all duration-300 p-4"
          style={expandedDbStyle}
          onClick={() => setIsExpanded(false)}
        >
          <Handle type="target" position={Position.Left} style={{ background: 'var(--border-1)' }} />
          <Handle type="source" position={Position.Right} style={{ background: 'var(--border-1)' }} />

          {/* Top ellipse (enlarged) */}
          <div
            className="absolute top-0 left-0 right-0"
            style={{
              height: '30px',
              borderRadius: '50%',
              border: '2px dashed var(--border-1)',
              borderBottom: 'none',
              background: 'var(--bg-surface)',
            }}
          />

          <div className="space-y-3 pt-8 w-full">
            {/* Title */}
            <div className="text-center">
              <div className="text-3xl mb-2 inline-block">
                {actorInfo.icon}
              </div>
              <div className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>
                {actorInfo.displayName}
              </div>
            </div>

            {/* Details */}
            <div className="space-y-2 text-xs" style={{ color: 'var(--text-2)' }}>
              <div>
                <div className="font-semibold mb-1" style={{ color: 'var(--text-3)' }}>
                  {t('workflow.provider')}
                </div>
                <div style={{ color: 'var(--text-2)' }}>
                  {data.actorId === 'llm' && !data.llmInfo ? (
                    <span className="italic" style={{ color: 'var(--text-3)' }}>{t('workflow.loadingText')}</span>
                  ) : (
                    actorInfo.provider
                  )}
                </div>
              </div>
              <div>
                <div className="font-semibold mb-1" style={{ color: 'var(--text-3)' }}>
                  {t('workflow.modelSystem')}
                </div>
                <div style={{ color: 'var(--text-2)' }}>
                  {data.actorId === 'llm' && !data.llmInfo ? (
                    <span className="italic" style={{ color: 'var(--text-3)' }}>{t('workflow.loadingText')}</span>
                  ) : (
                    actorInfo.model
                  )}
                </div>
              </div>
              {actorInfo.details && (
                <div>
                  <div className="font-semibold mb-1" style={{ color: 'var(--text-3)' }}>
                    {t('workflow.details')}
                  </div>
                  <div className="break-all" style={{ color: 'var(--text-2)' }}>{actorInfo.details}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    // 원형 Actor는 아주 둥근 모서리 사각형으로 확장
    const expandedCircularStyle: React.CSSProperties = {
      ...baseSurface,
      width: 280,
      borderRadius: '32px',
      border: data.isActive ? '2px solid transparent' : '2px solid var(--border-1)',
      boxShadow: data.isActive
        ? `var(--shadow-lg, 0 10px 30px rgba(0,0,0,0.18)), ${runningGlowShadow}`
        : 'var(--shadow-lg, 0 10px 30px rgba(0,0,0,0.18))',
      zIndex: 1000,
    };

    return (
      <div
        className="actor-node transition-all duration-300 p-4 relative cursor-pointer"
        style={expandedCircularStyle}
        onClick={() => setIsExpanded(false)}
      >
        <Handle type="target" position={Position.Left} style={{ background: 'var(--border-1)' }} />
        <Handle type="source" position={Position.Right} style={{ background: 'var(--border-1)' }} />

        <div className="space-y-3">
          {/* Title */}
          <div className="text-center">
            <div className="text-3xl mb-2 inline-block">
              {actorInfo.icon}
            </div>
            <div className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>
              {actorInfo.displayName}
            </div>
          </div>

          {/* Details */}
          <div className="space-y-2 text-xs" style={{ color: 'var(--text-2)' }}>
            <div>
              <div className="font-semibold mb-1" style={{ color: 'var(--text-3)' }}>
                {t('workflow.provider')}
              </div>
              <div style={{ color: 'var(--text-2)' }}>{actorInfo.provider}</div>
            </div>
            <div>
              <div className="font-semibold mb-1" style={{ color: 'var(--text-3)' }}>
                {t('workflow.modelSystem')}
              </div>
              <div style={{ color: 'var(--text-2)' }}>{actorInfo.model}</div>
            </div>
            {actorInfo.details && (
              <div>
                <div className="font-semibold mb-1" style={{ color: 'var(--text-3)' }}>
                  {t('workflow.details')}
                </div>
                <div className="break-all" style={{ color: 'var(--text-2)' }}>{actorInfo.details}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 접힌 상태 (기본) - DB 모양
  if (isDatabase) {
    const collapsedDbStyle: React.CSSProperties = {
      ...baseSurface,
      width: 120,
      height: 80,
      borderRadius: '50% / 10%',
      borderBottomLeftRadius: '50% / 40%',
      borderBottomRightRadius: '50% / 40%',
      border: data.isActive ? '2px solid transparent' : '2px dashed var(--border-1)',
      boxShadow: data.isActive ? runningGlowShadow : 'none',
      zIndex: 1,
    };

    return (
      <div
        className={cn(
          'actor-node flex flex-col items-center justify-center relative cursor-pointer',
          'transition-all duration-200'
        )}
        style={collapsedDbStyle}
        onClick={() => setIsExpanded(true)}
      >
        <Handle type="target" position={targetPosition} style={{ background: 'var(--border-1)' }} />
        <Handle type="source" position={Position.Right} style={{ background: 'var(--border-1)' }} />

        {/* Top ellipse (compact) */}
        <div
          className="absolute top-0 left-0 right-0"
          style={{
            height: '20px',
            borderRadius: '50%',
            border: '2px dashed var(--border-1)',
            borderBottom: 'none',
            background: 'var(--bg-surface)',
          }}
        />

        <div className="text-2xl mb-1 inline-block">
          {data.icon || actorInfo?.icon}
        </div>
        <div
          className="text-xs font-medium text-center px-2 leading-tight"
          style={{ color: 'var(--text-1)' }}
        >
          {data.label}
        </div>
      </div>
    );
  }

  // 접힌 상태 (기본) - 원형
  const collapsedCircularStyle: React.CSSProperties = {
    ...baseSurface,
    width: 100,
    height: 100,
    border: data.isActive ? '2px solid transparent' : '2px solid var(--border-1)',
    boxShadow: data.isActive ? runningGlowShadow : 'none',
    zIndex: 1,
  };

  return (
    <div
      className={cn(
        'actor-node rounded-full flex flex-col items-center justify-center relative',
        'transition-all duration-200 cursor-pointer'
      )}
      style={collapsedCircularStyle}
      onClick={() => setIsExpanded(true)}
    >
      <Handle type="target" position={targetPosition} style={{ background: 'var(--border-1)' }} />
      <Handle type="source" position={Position.Right} style={{ background: 'var(--border-1)' }} />

      <div className="text-2xl mb-1 inline-block">
        {data.icon || actorInfo?.icon}
      </div>
      <div
        className="text-xs font-medium text-center px-2 leading-tight"
        style={{ color: 'var(--text-1)' }}
      >
        {data.label}
      </div>
    </div>
  );
});

ActorNode.displayName = 'ActorNode';
