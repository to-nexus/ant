/**
 * WorkflowVisualization Component
 * 
 * LangGraph 워크플로우 시각화 메인 컴포넌트
 * ReactFlow + Dagre 기반
 */

import { useCallback } from 'react';
import * as React from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  NodeTypes
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useStore } from '@/lib/store';
import { useGraphMetadata, useWorkflowState, useGraphLayout } from './hooks';
import { WorkflowNode, ActorNode } from './nodes';
import { NodeType } from '@/types/workflow';

// 커스텀 노드 타입 매핑
const nodeTypes: NodeTypes = {
  [NodeType.ENTRY]: WorkflowNode,
  [NodeType.PROCESS]: WorkflowNode,
  [NodeType.DECISION]: WorkflowNode,
  [NodeType.CHECKPOINT]: WorkflowNode,
  [NodeType.END]: WorkflowNode,
  actor: ActorNode  // Actor 노드 추가
};

export function WorkflowVisualization() {
  const selectedAgent = useStore(state => state.selectedAgent);
  const selectedWorkType = useStore(state => state.selectedWorkType);
  const currentJob = useStore(state => state.currentJob);
  const theme = useStore(state => state.theme);
  const splitLayout = useStore(state => state.splitLayout);
  
  // 1. 정적 그래프 메타데이터 로드
  const { metadata, loading, error } = useGraphMetadata(selectedAgent, selectedWorkType);
  
  // 2. 실시간 상태 구독 (Job 실행 중일 때)
  const realtimeState = useWorkflowState(currentJob?.jobId);
  
  // 3. ReactFlow 노드/엣지 변환 + 레이아웃
  const { nodes, edges } = useGraphLayout(metadata, realtimeState);
  
  // ReactFlow instance for fitView
  const [reactFlowInstance, setReactFlowInstance] = React.useState<any>(null);
  
  // 메타데이터 로드 완료 or 레이아웃 변경시 fitView 자동 실행
  React.useEffect(() => {
    if (reactFlowInstance && nodes.length > 0) {
      // 약간의 딜레이를 주어 DOM 업데이트 후 fitView
      setTimeout(() => {
        reactFlowInstance.fitView({ padding: 0.1, duration: 400 });
      }, 50);
    }
  }, [reactFlowInstance, nodes.length, splitLayout]);
  
  // ReactFlow 이벤트 핸들러
  const onNodesChange = useCallback(() => {
    // Phase 1에서는 노드 변경 불가 (read-only)
  }, []);
  
  const onEdgesChange = useCallback(() => {
    // Phase 1에서는 엣지 변경 불가 (read-only)
  }, []);
  
  const onInit = useCallback((instance: any) => {
    setReactFlowInstance(instance);
  }, []);
  
  // 로딩 상태
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading workflow graph...</p>
        </div>
      </div>
    );
  }
  
  // 에러 상태
  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center max-w-md">
          <div className="text-red-500 dark:text-red-400 text-4xl mb-4">⚠️</div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Failed to Load Workflow
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {error.message}
          </p>
        </div>
      </div>
    );
  }
  
  // 메타데이터 없음
  if (!metadata || nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center max-w-md">
          <div className="text-gray-400 dark:text-gray-600 text-6xl mb-4">🔄</div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            No Workflow Available
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Select an agent and job to view the workflow graph.
          </p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="workflow-visualization h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onInit={onInit}
        fitView
        attributionPosition="bottom-left"
        minZoom={0.1}
        maxZoom={2}
        defaultEdgeOptions={{
          animated: false,
          style: { strokeWidth: 2 }
        }}
      >
        <Background 
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1}
          color={theme === 'dark' ? '#374151' : '#e5e7eb'}
        />
        <Controls 
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg"
        />
        <MiniMap 
          nodeColor={(node) => {
            if (node.data.isActive) return '#10b981'; // green-500
            switch (node.type) {
              case NodeType.ENTRY: return '#22c55e';    // green
              case NodeType.PROCESS: return '#3b82f6';  // blue
              case NodeType.DECISION: return '#eab308'; // yellow
              case NodeType.CHECKPOINT: return '#a855f7'; // purple
              case NodeType.END: return '#ef4444';      // red
              default: return '#94a3b8';                // gray
            }
          }}
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg"
        />
      </ReactFlow>
    </div>
  );
}

