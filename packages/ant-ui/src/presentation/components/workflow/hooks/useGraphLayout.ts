/**
 * useGraphLayout Hook
 * 
 * Dagre 알고리즘을 사용한 자동 레이아웃 계산
 */

import { useMemo } from 'react';
import { Node, Edge, Position } from 'reactflow';
import dagre from 'dagre';
import { WorkflowGraphMetadata, WorkflowRealtimeState, NodeImportance } from '@/domain/models/workflow';
import { useStore } from '@/domain/store';

// Edge 스타일 헬퍼
const getEdgeStyle = (edgeType: string, isActive: boolean, theme: 'light' | 'dark') => {
  const baseStroke = theme === 'dark' ? '#64748b' : '#475569'; // slate-500/700
  const errorStroke = theme === 'dark' ? '#ef4444' : '#dc2626'; // red-500/600
  const loopStroke = theme === 'dark' ? '#8b5cf6' : '#7c3aed'; // violet-500/600
  const activeStroke = '#10b981'; // emerald-500
  
  return {
    strokeWidth: isActive ? 3 : 2,
    stroke: edgeType === 'error' ? errorStroke : 
            edgeType === 'loop' ? loopStroke :
            isActive ? activeStroke : baseStroke
  };
};

const getEdgeLabelStyle = (theme: 'light' | 'dark') => ({
  fill: theme === 'dark' ? '#f1f5f9' : '#1e293b', // slate-100/800
  fontWeight: 500,
  fontSize: 11
});

export function useGraphLayout(
  metadata: WorkflowGraphMetadata | null,
  realtimeState: WorkflowRealtimeState | null,
  config?: any  // ✅ config 추가 (Job 실행 전 LLM 정보용)
) {
  const splitLayout = useStore(state => state.splitLayout);
  const theme = useStore(state => state.theme);
  
  return useMemo(() => {
    if (!metadata) {
      return { nodes: [], edges: [] };
    }
    
    // ✅ LLM 정보는 config에서만 가져옴 (realtimeState에 llmInfo 없음)
    const llmInfo = config ? {
      provider: config.llmProvider,
      model: config.llmModel
    } : null;
    
    // 화면 분할 방향에 따라 워크플로우 방향 결정
    // horizontal (좌우 분할) → 워크플로우는 세로로 (TB)
    // vertical (상하 분할) → 워크플로우는 가로로 (LR)
    const rankdir = splitLayout === 'horizontal' ? 'TB' : 'LR';
    
    // 1. Workflow 노드를 ReactFlow 노드로 변환
    const workflowNodes: Node[] = metadata.nodes.map(node => {
      const isActive = realtimeState?.currentNode === node.id;
      
      // ✅ Track active node
      if (isActive) {
        // console.log('[useGraphLayout] 🟢 ACTIVE NODE:', node.id); // ✅ Too verbose
      }
      
      return {
        id: node.id,
        type: node.type,
        data: {
          label: node.label,
          description: node.description,
          importance: node.importance,
          isActive,
          actors: node.interactsWithActors,
          nodeType: node.type,
          llmInfo
        },
        position: { x: 0, y: 0 },
      };
    });
    
    // 2. Actor 노드를 ReactFlow 노드로 변환
    const actorNodes: Node[] = metadata.actors.map(actor => ({
      id: `actor-${actor.id}`,
      type: 'actor',
      data: {
        label: actor.label,
        actorType: actor.type,
        actorId: actor.id,  // 실제 정보 조회용
        icon: actor.icon,
        isActive: realtimeState?.activeActors?.includes(actor.id) || false,
        llmInfo: actor.id === 'llm' ? llmInfo : null  // ✅ LLM Actor에 정보 전달
      },
      position: { x: 0, y: 0 }
    }));
    
    const rfNodes = [...workflowNodes, ...actorNodes];
    
    // 3. Workflow 엣지 변환
    const workflowEdges: Edge[] = metadata.edges.map(edge => {
      const isActive = realtimeState?.previousNode === edge.source && 
                       realtimeState?.currentNode === edge.target;
      const edgeStyle = getEdgeStyle(edge.type, isActive, theme);
      
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: edge.type === 'conditional' || edge.type === 'loop' ? 'smoothstep' : 'default',
        label: edge.label,
        animated: isActive,
        style: edgeStyle,
        labelStyle: getEdgeLabelStyle(theme),
        labelBgStyle: { 
          fill: theme === 'dark' ? '#1e293b' : '#ffffff', 
          fillOpacity: 0.95,
          stroke: theme === 'dark' ? '#334155' : '#cbd5e1',
          strokeWidth: 1
        },
        labelBgPadding: [6, 8] as [number, number],
        labelBgBorderRadius: 4,
        markerEnd: {
          type: 'arrowclosed',
          color: edgeStyle.stroke
        }
      };
    });
    
    // 4. 노드-Actor 연결 엣지 생성
    const actorEdges: Edge[] = [];
    metadata.nodes.forEach(node => {
      node.interactsWithActors.forEach(actorId => {
        // 현재 노드가 활성화되고 Actor가 활성화되어 있으면 animated
        const isActiveInteraction = 
          realtimeState?.currentNode === node.id && 
          realtimeState?.activeActors?.includes(actorId);
        
        const actorStroke = isActiveInteraction 
          ? '#10b981' 
          : theme === 'dark' ? '#64748b' : '#64748b';
        
        actorEdges.push({
          id: `${node.id}-to-actor-${actorId}`,
          source: node.id,
          target: `actor-${actorId}`,
          type: 'straight',
          animated: isActiveInteraction,
          style: {
            strokeWidth: isActiveInteraction ? 2 : 1.5,
            stroke: actorStroke,
            strokeDasharray: '5,5'
          },
          markerEnd: {
            type: 'arrow',
            color: actorStroke
          }
        });
      });
    });
    
    const rfEdges = [...workflowEdges, ...actorEdges];
    
    // 5. Dagre 레이아웃 계산
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));
    dagreGraph.setGraph({ 
      rankdir,        // 'TB' (vertical split) or 'LR' (horizontal split)
      ranksep: 80,    // 주 방향 간격 (TB: 세로, LR: 가로)
      nodesep: 60,    // 부 방향 간격 (TB: 가로, LR: 세로)
      edgesep: 20     // 엣지 간 간격
    });
    
    // 노드 크기 설정
    rfNodes.forEach(node => {
      let width, height;
      if (node.type === 'actor') {
        // Actor 노드는 원형 (100x100)
        width = 100;
        height = 100;
      } else {
        // Workflow 노드는 모두 동일 크기
        width = NODE_WIDTH;
        height = NODE_HEIGHT;
      }
      dagreGraph.setNode(node.id, { width, height });
    });
    
    // 엣지 설정
    rfEdges.forEach(edge => {
      dagreGraph.setEdge(edge.source, edge.target);
    });
    
    // 레이아웃 계산 실행
    dagre.layout(dagreGraph);
    
    // 6. 계산된 위치 적용
    const layoutedNodes = rfNodes.map(node => {
      const nodeWithPosition = dagreGraph.node(node.id);
      let width, height;
      
      if (node.type === 'actor') {
        width = 100;
        height = 100;
      } else {
        width = NODE_WIDTH;
        height = NODE_HEIGHT;
      }
      
      return {
        ...node,
        position: {
          x: nodeWithPosition.x - width / 2,
          y: nodeWithPosition.y - height / 2,
        },
      };
    });
    
    return { nodes: layoutedNodes, edges: rfEdges };
  }, [metadata, realtimeState, splitLayout, theme, config]);
}

/**
 * 모든 노드 동일 크기
 */
const NODE_WIDTH = 160;
const NODE_HEIGHT = 64;

