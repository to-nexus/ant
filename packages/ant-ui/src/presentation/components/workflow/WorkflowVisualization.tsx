/**
 * WorkflowVisualization Component
 * 
 * LangGraph 워크플로우 시각화 메인 컴포넌트
 * ReactFlow + Dagre 기반
 */

import { useCallback } from 'react';
import * as React from 'react';
import './workflow-controls.css';
import ReactFlow, {
  Background,
  Controls,
  BackgroundVariant,
  NodeTypes,
  Node as RFNode
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useStore } from '@/domain/store';
import { WorkflowRealtimeState } from '@/domain/models/workflow';
import { useGraphMetadata, useGraphLayout } from './hooks';
import { WorkflowNode, ActorNode } from './nodes';
import { NodeType } from '@/domain/models/workflow';

import { fetchProjectConfig } from '@/infrastructure/http/api';

// 커스텀 노드 타입 매핑
const nodeTypes: NodeTypes = {
  [NodeType.ENTRY]: WorkflowNode,
  [NodeType.PROCESS]: WorkflowNode,
  [NodeType.DECISION]: WorkflowNode,
  [NodeType.CHECKPOINT]: WorkflowNode,
  [NodeType.END]: WorkflowNode,
  actor: ActorNode  // Actor 노드 추가
};

interface WorkflowVisualizationProps {
  workflowState: WorkflowRealtimeState | null;  // ✅ App에서 전달받음 (AgentWorkflowBoard를 통해)
}

export function WorkflowVisualization({ workflowState }: WorkflowVisualizationProps) {
  const selectedProject = useStore(state => state.selectedProject);
  const selectedFeature = useStore(state => state.selectedFeature);
  const selectedAgent = useStore(state => state.selectedAgent);
  const selectedJobType = useStore(state => state.selectedJobType);
  const currentJobId = useStore(state => state.currentJobId);
  const userStoppedJobId = useStore(state => state.userStoppedJobId);
  const theme = useStore(state => state.theme);
  const splitLayout = useStore(state => state.splitLayout);
  
  // ✅ Track workflowState changes
  React.useEffect(() => {
    if (workflowState?.currentNode) {
      // console.log('[WorkflowViz] 🎯 Current node:', workflowState.currentNode); // ✅ Too verbose
    }
  }, [workflowState?.currentNode]);
  
  // ✅ Track terminal bar height for workflow controls positioning
  React.useEffect(() => {
    const updateControlsPosition = () => {
      // Find the terminal bar element
      const terminalBar = document.querySelector('[data-terminal-bar]') as HTMLElement;
      if (terminalBar) {
        const terminalHeight = terminalBar.offsetHeight;
        // Update CSS variable for controls positioning
        document.documentElement.style.setProperty('--terminal-offset', `${terminalHeight + 10}px`);
      } else {
        // Default offset when terminal is collapsed
        document.documentElement.style.setProperty('--terminal-offset', '10px');
      }
    };
    
    // Initial update
    updateControlsPosition();
    
    // Watch for terminal resize with ResizeObserver
    const terminalBar = document.querySelector('[data-terminal-bar]') as HTMLElement;
    if (terminalBar) {
      const resizeObserver = new ResizeObserver(updateControlsPosition);
      resizeObserver.observe(terminalBar);
      
      return () => {
        resizeObserver.disconnect();
      };
    }
    
    // Fallback: periodic check
    const interval = setInterval(updateControlsPosition, 500);
    return () => clearInterval(interval);
  }, []);
  
  // ✅ Fetch config to get LLM info (for non-running jobs)
  const [config, setConfig] = React.useState<any>(null);
  React.useEffect(() => {
    if (selectedProject) {
      fetchProjectConfig(selectedProject)
        .then(data => setConfig(data))
        .catch(() => setConfig(null));
    }
  }, [selectedProject]);
  
  // 1. 정적 그래프 메타데이터 로드 (Hooks는 항상 호출되어야 함)
  const { metadata, loading, error } = useGraphMetadata(selectedAgent, selectedJobType);
  
  // 2. ReactFlow 노드/엣지 변환 + 레이아웃
  // ✅ workflowState 사용: App에서 전달받은 단일 SSE 상태
  // ✅ config 전달: Job 실행 전에도 LLM 정보 표시
  const { nodes: baseNodes, edges } = useGraphLayout(metadata, workflowState, config);
  
  // ReactFlow instance for fitView
  const [reactFlowInstance, setReactFlowInstance] = React.useState<any>(null);
  
  // Expanded node/actor state
  const [expandedNodeId, setExpandedNodeId] = React.useState<string | null>(null);
  
  // 4. 확장 상태를 노드 데이터에 추가 + z-index 설정
  const nodes = React.useMemo(() => 
    baseNodes.map(node => ({
      ...node,
      data: {
        ...node.data,
        isExpanded: node.id === expandedNodeId
      },
      zIndex: node.id === expandedNodeId ? 1000 : 1  // ReactFlow 노드 래퍼의 z-index
    })),
    [baseNodes, expandedNodeId]
  );
  
  // 메타데이터 로드 완료 or 레이아웃 변경시 fitView 자동 실행
  React.useEffect(() => {
    if (reactFlowInstance && nodes.length > 0) {
      // 약간의 딜레이를 주어 DOM 업데이트 후 fitView
      setTimeout(() => {
        reactFlowInstance.fitView({ padding: 0.1, duration: 400 });
      }, 50);
    }
  }, [reactFlowInstance, nodes.length, splitLayout]);
  
  // ✅ 활성 노드로 자동 포커스 + 줌인
  React.useEffect(() => {
    if (!reactFlowInstance || !workflowState?.currentNode) return;
    
    const currentNodeId = workflowState.currentNode;
    const node = reactFlowInstance.getNode(currentNodeId);
    
    if (!node) {
      console.log(`[WorkflowVisualization] Node ${currentNodeId} not found in graph`);
      return;
    }
    
    // console.log(`[WorkflowVisualization] 🎯 Focusing on displayed node: ${currentNodeId}`); // ✅ Too verbose
    
    // 노드 중심으로 이동 + 적절한 줌 레벨
    // position은 노드의 좌측 상단이므로 노드 크기의 절반을 더해서 중심을 구함
    const nodeWidth = node.width || 150;
    const nodeHeight = node.height || 60;
    const centerX = node.position.x + nodeWidth / 2;
    const centerY = node.position.y + nodeHeight / 2;
    
    // 부드러운 애니메이션으로 이동 + 줌인 (1.3배)
    reactFlowInstance.setCenter(centerX, centerY, {
      zoom: 1.3,
      duration: 800  // 800ms 애니메이션
    });
  }, [reactFlowInstance, workflowState?.currentNode]);
  
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
  
  // 노드/Actor 클릭 핸들러 (확장/축소 토글)
  const onNodeClick = useCallback((_event: React.MouseEvent, node: RFNode) => {
    // 같은 노드/Actor를 다시 클릭하면 축소, 다른 것을 클릭하면 확장
    setExpandedNodeId(prev => prev === node.id ? null : node.id);
  }, []);
  
  // ========================================
  // 조건부 렌더링 (모든 Hooks 호출 후)
  // ========================================
  
  // Workspace & Feature 선택 필수 체크
  if (!selectedProject || !selectedFeature) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center max-w-md">
          <div className="text-gray-400 dark:text-gray-600 text-6xl mb-4">🔄</div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            No Workspace or Feature Selected
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Select a workspace and feature to view the agent workflow graph.
          </p>
        </div>
      </div>
    );
  }
  
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
    <div className="workflow-visualization h-full w-full bg-gray-50 dark:bg-gray-900">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
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
          color={theme === 'dark' ? '#374151' : '#cbd5e1'}
        />
        <Controls 
          showInteractive={false}
          className="workflow-controls"
        />
      </ReactFlow>
    </div>
  );
}

