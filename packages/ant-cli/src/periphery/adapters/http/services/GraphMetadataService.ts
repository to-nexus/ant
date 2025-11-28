/**
 * GraphMetadataService
 * 
 * LangGraph 구조를 런타임에 분석하여 시각화 메타데이터 추출
 * 
 * Phase 2: 실제 Graph 인스턴스 분석 (Dynamic)
 * 
 * 책임:
 * - Agent-Job 조합의 실제 그래프 구조 추출
 * - 노드 중요도 자동 분류
 * - 외부 Actor 식별
 */

import {
  WorkflowGraphMetadata,
  WorkflowNode,
  WorkflowEdge,
  ExternalActor,
  NodeType,
  NodeImportance,
  EdgeType,
  ActorType
} from '../types/workflow';

// 실제 Graph 빌더 함수들을 직접 import
import { buildCodeGraph } from '../../../../agents/architect/graph/code/graph';
import { buildDesignGraph } from '../../../../agents/architect/graph/design/graph';
import { buildLearnGraph } from '../../../../agents/architect/graph/learn/graph';

/**
 * 공통 Actor 정의
 */
const COMMON_ACTORS = {
  llm: {
    id: 'llm',
    type: ActorType.LLM,
    label: 'LLM API',
    icon: '🤖'
  },
  embedding: {
    id: 'embedding-model',
    type: ActorType.EMBEDDING,
    label: 'Embedding Model',
    icon: '🧠'
  },
  vectorDb: {
    id: 'vector-db',
    type: ActorType.VECTOR_DB,
    label: 'Vector DB',
    icon: '🗄️'
  },
  localStorage: {
    id: 'local-storage',
    type: ActorType.LOCAL_STORAGE,
    label: 'Session Storage',
    icon: '💾'
  },
  fileSystem: {
    id: 'file-system',
    type: ActorType.FILE_SYSTEM,
    label: 'Workspace Files',
    icon: '📁'
  },
  codeRepo: {
    id: 'code-repo',
    type: ActorType.CODE_REPO,
    label: 'Code Repository',
    icon: '💻'
  },
  tool: {
    id: 'tool',
    type: ActorType.TOOL,
    label: 'Build Tools',
    icon: '🔧'
  }
} as const;

/**
 * Actor 매핑 (실제 Port 사용 기반)
 */
const ACTOR_MAPPINGS: Record<string, { actors: string[]; description?: string }> = {
  // Architect Code
  'architect:code:resolve': {
    actors: [COMMON_ACTORS.fileSystem.id, COMMON_ACTORS.vectorDb.id, COMMON_ACTORS.localStorage.id],
    description: 'Load context and resolve dependencies via RAG'
  },
  'architect:code:plan': {
    actors: [COMMON_ACTORS.llm.id],
    description: 'Create implementation plan'
  },
  'architect:code:decompose': {
    actors: [COMMON_ACTORS.llm.id],
    description: 'Break down into tasks'
  },
  'architect:code:codeGen': {
    actors: [COMMON_ACTORS.llm.id],
    description: 'Generate code with LLM reasoning'
  },
  'architect:code:tool': {
    actors: [COMMON_ACTORS.codeRepo.id, COMMON_ACTORS.tool.id],
    description: 'Execute tools (read/write files, run commands)'
  },
  'architect:code:writeFiles': {
    actors: [COMMON_ACTORS.codeRepo.id, COMMON_ACTORS.fileSystem.id],
    description: 'Write generated code to repository'
  },
  'architect:code:validate': {
    actors: [COMMON_ACTORS.codeRepo.id, COMMON_ACTORS.tool.id],
    description: 'Check code quality'
  },
  'architect:code:installDeps': {
    actors: [COMMON_ACTORS.codeRepo.id, COMMON_ACTORS.tool.id],
    description: 'Install dependencies'
  },
  'architect:code:runtimeValidate': {
    actors: [COMMON_ACTORS.codeRepo.id, COMMON_ACTORS.tool.id],
    description: 'Run tests and build'
  },
  'architect:code:enforce': {
    actors: [COMMON_ACTORS.llm.id],
    description: 'Fix violations'
  },
  'architect:code:checkTaskStatus': {
    actors: [],
    description: 'Check if more tasks remain'
  },
  'architect:code:learn': {
    actors: [COMMON_ACTORS.embedding.id, COMMON_ACTORS.localStorage.id],
    description: 'Store learnings to memory'
  },
  
  // Architect Design
  'architect:design:resolve': {
    actors: [COMMON_ACTORS.vectorDb.id, COMMON_ACTORS.localStorage.id],
    description: 'Load context and artifacts via RAG'
  },
  'architect:design:decompose': {
    actors: [COMMON_ACTORS.llm.id],
    description: 'Break down design requirements into tasks'
  },
  'architect:design:plan': {
    actors: [COMMON_ACTORS.llm.id],
    description: 'Create design plan'
  },
  'architect:design:execute': {
    actors: [COMMON_ACTORS.llm.id],
    description: 'Generate design document'
  },
  'architect:design:writeFiles': {
    actors: [COMMON_ACTORS.fileSystem.id],
    description: 'Write design document to file'
  },
  'architect:design:checkTaskStatus': {
    actors: [],
    description: 'Check task completion and route to next'
  },
  'architect:design:learn': {
    actors: [COMMON_ACTORS.embedding.id, COMMON_ACTORS.localStorage.id],
    description: 'Store learnings and finalize'
  },
  
  // Architect Learn
  'architect:learn:decompose': {
    actors: [COMMON_ACTORS.llm.id],
    description: 'Analyze learning request and determine action'
  },
  'architect:learn:resolve': {
    actors: [COMMON_ACTORS.fileSystem.id, COMMON_ACTORS.codeRepo.id],
    description: 'Execute learning action (index/read files)'
  },
  'architect:learn:store': {
    actors: [COMMON_ACTORS.embedding.id, COMMON_ACTORS.vectorDb.id],
    description: 'Store learnings in vector DB'
  }
};

export class GraphMetadataService {
  
  /**
   * Agent-Job 조합에 대한 그래프 메타데이터 추출
   * 
   * Phase 2: 실제 Graph 인스턴스에서 동적 추출
   */
  async extractGraphMetadata(agent: string, job: string): Promise<WorkflowGraphMetadata> {
    try {
      // 1. Graph 빌더 함수 가져오기
      const graphBuilder = this.getGraphBuilder(agent, job);
      if (!graphBuilder) {
        console.warn(`[GraphMetadataService] No graph builder for ${agent}/${job}`);
        return this.getEmptyMetadata(agent, job);
      }
      
      // 2. Graph 인스턴스 생성
      const compiledGraph = graphBuilder();
      
      // 3. Graph 구조 분석
      const { nodes, edges } = this.analyzeGraphStructure(compiledGraph, agent, job);
      
      // 4. Actor 수집
      const actorSet = new Set<string>();
      for (const node of nodes) {
        for (const actorId of node.interactsWithActors) {
          actorSet.add(actorId);
        }
      }
      
      const actors = Array.from(actorSet)
        .map(id => {
          const actor = Object.values(COMMON_ACTORS).find(a => a.id === id);
          return actor || null;
        })
        .filter(Boolean) as ExternalActor[];
      
      // 5. Entry/End 노드 식별
      const entryNode = nodes.find(n => n.type === NodeType.ENTRY)?.id || nodes[0]?.id || '__start__';
      const endNodes = nodes.filter(n => n.type === NodeType.END).map(n => n.id);
      
      return {
        agent,
        job,
        nodes,
        edges,
        actors,
        entryNode,
        endNodes: endNodes.length > 0 ? endNodes : [nodes[nodes.length - 1]?.id].filter(Boolean)
      };
    } catch (error) {
      console.error(`[GraphMetadataService] Failed to extract metadata for ${agent}/${job}:`, error);
      return this.getEmptyMetadata(agent, job);
    }
  }
  
  /**
   * Graph 빌더 함수 반환
   */
  private getGraphBuilder(agent: string, job: string): (() => any) | null {
    const key = `${agent}:${job}`;
    
    switch (key) {
      case 'architect:code':
        return buildCodeGraph;
      case 'architect:design':
        return buildDesignGraph;
      case 'architect:learn':
        return buildLearnGraph;
      default:
        return null;
    }
  }
  
  /**
   * Graph 구조 분석
   * 
   * LangGraph의 compiled graph는 다음 구조를 가짐:
   * - nodes: Map<string, Function>
   * - edges: Array<[source, target]> 또는 내부 구조
   */
  private analyzeGraphStructure(
    compiledGraph: any,
    agent: string,
    job: string
  ): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
    const nodes: WorkflowNode[] = [];
    const edges: WorkflowEdge[] = [];
    
    try {
      // LangGraph의 내부 구조 탐색
      // StateGraph가 compile되면 CompiledStateGraph가 반환됨
      const graphNodes = compiledGraph.nodes || compiledGraph._nodes || new Map();
      
      // 노드 추출
      const nodeEntries = graphNodes instanceof Map ? Array.from(graphNodes.keys()) : Object.keys(graphNodes);
      
      for (const nodeId of nodeEntries) {
        if (nodeId === '__start__' || nodeId === '__end__') continue;
        
        const nodeType = this.inferNodeType(nodeId, job);
        const importance = this.inferNodeImportance(nodeId);
        
        // Actor 매핑 조회
        const mappingKey = `${agent}:${job}:${nodeId}`;
        const mapping = ACTOR_MAPPINGS[mappingKey];
        
        nodes.push({
          id: nodeId,
          type: nodeType,
          label: this.formatLabel(nodeId),
          description: mapping?.description,
          importance,
          interactsWithActors: mapping?.actors || []
        });
      }
      
      // 엣지 추출 시도
      // LangGraph는 내부적으로 엣지 정보를 다양한 방식으로 저장
      const edgesList = this.extractEdges(compiledGraph, nodeEntries);
      edges.push(...edgesList);
      
    } catch (error) {
      console.warn('[GraphMetadataService] Graph structure analysis failed:', error);
    }
    
    return { nodes, edges };
  }
  
  /**
   * 엣지 추출
   */
  private extractEdges(compiledGraph: any, nodeIds: string[]): WorkflowEdge[] {
    const edges: WorkflowEdge[] = [];
    
    try {
      // 방법 1: _edges 배열
      if (Array.isArray(compiledGraph._edges)) {
        for (const edge of compiledGraph._edges) {
          if (Array.isArray(edge) && edge.length >= 2) {
            const [source, target] = edge;
            edges.push({
              id: `${source}_to_${target}`,
              source,
              target,
              type: EdgeType.NORMAL
            });
          }
        }
      }
      
      // ✅ 방법 2: builder를 통한 엣지 추출
      if (compiledGraph.builder) {
        // ✅ builder.edges - 정적 엣지 (addEdge)
        if (Array.isArray(compiledGraph.builder.edges)) {
          for (const [source, target] of compiledGraph.builder.edges) {
            if (source !== '__start__' && target !== '__end__') {
              edges.push({
                id: `${source}_to_${target}`,
                source,
                target,
                type: EdgeType.NORMAL
              });
            }
          }
        } else if (compiledGraph.builder.edges && typeof compiledGraph.builder.edges[Symbol.iterator] === 'function') {
          // edges가 iterable이지만 배열은 아닌 경우 (Set, Map.entries() 등)
          for (const edge of compiledGraph.builder.edges) {
            if (Array.isArray(edge) && edge.length >= 2) {
              const [source, target] = edge;
              if (source !== '__start__' && target !== '__end__') {
                edges.push({
                  id: `${source}_to_${target}`,
                  source,
                  target,
                  type: EdgeType.NORMAL
                });
              }
            }
          }
        }
        
        // ✅ builder.branches - 조건부 엣지 (addConditionalEdges)
        if (compiledGraph.builder.branches && typeof compiledGraph.builder.branches === 'object') {
          for (const [sourceNode, branchInfo] of Object.entries(compiledGraph.builder.branches)) {
            if (typeof branchInfo === 'object' && branchInfo) {
              // branchInfo는 { condition: Branch } 형태
              // Branch 객체는 { path: ..., ends: { condition1: target1, ... } } 형태
              
              for (const [key, value] of Object.entries(branchInfo)) {
                if (value && typeof value === 'object' && 'ends' in value) {
                  // value는 Branch 객체
                  const branch = value as any;
                  
                  if (branch.ends && typeof branch.ends === 'object') {
                    // ends는 { condition → target } 매핑
                    for (const [condition, target] of Object.entries(branch.ends)) {
                      if (typeof target === 'string' && target !== '__end__') {
                        edges.push({
                          id: `${sourceNode}_to_${target}_${condition}`,
                          source: sourceNode,
                          target,
                          type: EdgeType.CONDITIONAL,
                          label: condition
                        });
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      
      // 방법 3: channels를 통한 연결 추론 (fallback)
      if (edges.length === 0 && nodeIds.length > 1) {
        // 순차적 연결 추론 (fallback)
        for (let i = 0; i < nodeIds.length - 1; i++) {
          edges.push({
            id: `${nodeIds[i]}_to_${nodeIds[i + 1]}`,
            source: nodeIds[i],
            target: nodeIds[i + 1],
            type: EdgeType.NORMAL
          });
        }
      }
    } catch (error) {
      console.warn('[GraphMetadataService] Edge extraction failed:', error);
    }
    
    return edges;
  }
  
  /**
   * 노드 타입 추론
   */
  private inferNodeType(nodeId: string, job: string): NodeType {
    if (nodeId === 'resolve') return NodeType.ENTRY;
    if (nodeId === 'learn' || nodeId === 'store') return NodeType.END;
    if (nodeId === 'decompose' || nodeId === 'validate' || nodeId.includes('check')) return NodeType.DECISION;
    return NodeType.PROCESS;
  }
  
  /**
   * 노드 중요도 추론
   */
  private inferNodeImportance(nodeId: string): NodeImportance {
    if (/^(resolve|decompose|execute|store)$/i.test(nodeId)) return NodeImportance.CRITICAL;
    if (/^(plan|learn|validate|enforce)$/i.test(nodeId)) return NodeImportance.MAJOR;
    return NodeImportance.MINOR;
  }
  
  /**
   * 라벨 포맷팅
   */
  private formatLabel(id: string): string {
    return id
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim();
  }
  
  /**
   * 빈 메타데이터 반환
   */
  private getEmptyMetadata(agent: string, job: string): WorkflowGraphMetadata {
    return {
      agent,
      job,
      nodes: [],
      edges: [],
      actors: [],
      entryNode: '__start__',
      endNodes: []
    };
  }
}
