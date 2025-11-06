/**
 * useGraphLayout Hook
 * 
 * Dagre 알고리즘을 사용한 자동 레이아웃 계산
 */

import { useMemo } from 'react';
import { Node, Edge, Position } from 'reactflow';
import dagre from 'dagre';
import { WorkflowGraphMetadata, WorkflowRealtimeState, NodeImportance } from '@/types/workflow';
import { useStore } from '@/lib/store';

export function useGraphLayout(
  metadata: WorkflowGraphMetadata | null,
  realtimeState: WorkflowRealtimeState | null
) {
  const splitLayout = useStore(state => state.splitLayout);
  
  return useMemo(() => {
    if (!metadata) {
      return { nodes: [], edges: [] };
    }
    
    // 화면 분할 방향에 따라 워크플로우 방향 결정
    // horizontal (좌우 분할) → 워크플로우는 세로로 (TB)
    // vertical (상하 분할) → 워크플로우는 가로로 (LR)
    const rankdir = splitLayout === 'horizontal' ? 'TB' : 'LR';
    
    console.log('[useGraphLayout] Computing layout for', metadata.nodes.length, 'workflow nodes +', metadata.actors.length, 'actors', `(direction: ${rankdir})`);
    
    // 1. Workflow 노드를 ReactFlow 노드로 변환
    const workflowNodes: Node[] = metadata.nodes.map(node => ({
      id: node.id,
      type: node.type,
      data: {
        label: node.label,
        description: node.description,
        importance: node.importance,
        isActive: realtimeState?.currentNode === node.id,
        actors: node.interactsWithActors,
        nodeType: node.type
      },
      position: { x: 0, y: 0 }, // Dagre가 계산할 것
    }));
    
    // 2. Actor 노드를 ReactFlow 노드로 변환
    const actorNodes: Node[] = metadata.actors.map(actor => ({
      id: `actor-${actor.id}`,
      type: 'actor',
      data: {
        label: actor.label,
        actorType: actor.type,
        icon: actor.icon
      },
      position: { x: 0, y: 0 }
    }));
    
    const rfNodes = [...workflowNodes, ...actorNodes];
    
    // 3. Workflow 엣지 변환
    const workflowEdges: Edge[] = metadata.edges.map(edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.type === 'conditional' || edge.type === 'loop' ? 'smoothstep' : 'default',
      label: edge.label,
      animated: realtimeState?.previousNode === edge.source && 
                realtimeState?.currentNode === edge.target,
      style: {
        strokeWidth: 2,
        stroke: edge.type === 'error' ? '#ef4444' : 
                edge.type === 'loop' ? '#8b5cf6' :
                '#94a3b8'
      },
      markerEnd: {
        type: 'arrowclosed',
        color: edge.type === 'error' ? '#ef4444' : 
               edge.type === 'loop' ? '#8b5cf6' :
               '#94a3b8'
      }
    }));
    
    // 4. 노드-Actor 연결 엣지 생성
    const actorEdges: Edge[] = [];
    metadata.nodes.forEach(node => {
      node.interactsWithActors.forEach(actorId => {
        actorEdges.push({
          id: `${node.id}-to-actor-${actorId}`,
          source: node.id,
          target: `actor-${actorId}`,
          type: 'straight',
          animated: false,
          style: {
            strokeWidth: 1,
            stroke: '#cbd5e1',
            strokeDasharray: '5,5'
          },
          markerEnd: {
            type: 'arrow',
            color: '#cbd5e1'
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
        // Workflow 노드는 중요도별 크기
        width = getNodeWidth(node.data.importance);
        height = getNodeHeight(node.data.importance);
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
        width = getNodeWidth(node.data.importance);
        height = getNodeHeight(node.data.importance);
      }
      
      return {
        ...node,
        position: {
          x: nodeWithPosition.x - width / 2,
          y: nodeWithPosition.y - height / 2,
        },
      };
    });
    
    console.log('[useGraphLayout] Layout complete:', layoutedNodes.length, 'nodes positioned');
    
    return { nodes: layoutedNodes, edges: rfEdges };
  }, [metadata, realtimeState, splitLayout]);
}

/**
 * 노드 중요도별 너비 반환
 */
function getNodeWidth(importance: NodeImportance): number {
  switch (importance) {
    case NodeImportance.CRITICAL: return 200;
    case NodeImportance.MAJOR: return 160;
    case NodeImportance.MINOR: return 120;
    default: return 160;
  }
}

/**
 * 노드 중요도별 높이 반환
 */
function getNodeHeight(importance: NodeImportance): number {
  switch (importance) {
    case NodeImportance.CRITICAL: return 80;
    case NodeImportance.MAJOR: return 64;
    case NodeImportance.MINOR: return 48;
    default: return 64;
  }
}

