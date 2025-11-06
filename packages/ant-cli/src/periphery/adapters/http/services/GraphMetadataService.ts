/**
 * GraphMetadataService
 * 
 * LangGraph 구조를 분석하여 시각화 메타데이터 추출
 * 
 * 책임:
 * - Agent-Job 조합의 그래프 구조 추출
 * - 노드 중요도 자동 분류
 * - 외부 Actor 식별
 * 
 * 개선사항:
 * - 공통 Actor 정의 추출
 * - Helper 메서드로 중복 제거
 * - 타입 안정성 강화
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

/**
 * 공통 Actor 정의 (모든 Agent에서 재사용)
 */
const COMMON_ACTORS = {
  llm: {
    id: 'llm',
    type: ActorType.LLM,
    label: 'Claude API',
    icon: '🤖'
  },
  vectorDb: {
    id: 'vector-db',
    type: ActorType.VECTOR_DB,
    label: 'Vector Store',
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
    label: 'File System',
    icon: '📁'
  },
  tool: {
    id: 'tool',
    type: ActorType.TOOL,
    label: 'Build Tools',
    icon: '🔧'
  }
} as const;

export class GraphMetadataService {
  
  /**
   * Agent-Job 조합에 대한 그래프 메타데이터 추출
   * 
   * Phase 1: 하드코딩된 메타데이터 반환 (POC)
   * Phase 2: 실제 코드 분석으로 전환
   */
  async extractGraphMetadata(agent: string, job: string): Promise<WorkflowGraphMetadata> {
    console.log(`[GraphMetadataService] Extracting metadata for ${agent}/${job}`);
    
    // Phase 1: 하드코딩된 메타데이터
    const metadataKey = `${agent}:${job}`;
    
    switch (metadataKey) {
      case 'architect:code':
        return this.getArchitectCodeMetadata();
      case 'architect:design':
        return this.getArchitectDesignMetadata();
      case 'architect:learn':
        return this.getArchitectLearnMetadata();
      default:
        console.warn(`[GraphMetadataService] No metadata found for ${agent}/${job}`);
        return this.getEmptyMetadata(agent, job);
    }
  }
  
  /**
   * 빈 메타데이터 반환 (fallback)
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
  
  /**
   * 노드 생성 헬퍼
   */
  private createNode(
    id: string,
    type: NodeType,
    label: string,
    options: {
      description?: string;
      importance?: NodeImportance;
      actors?: string[];
    } = {}
  ): WorkflowNode {
    return {
      id,
      type,
      label,
      description: options.description,
      importance: options.importance || NodeImportance.MAJOR,
      interactsWithActors: options.actors || []
    };
  }
  
  /**
   * 엣지 생성 헬퍼
   */
  private createEdge(
    source: string,
    target: string,
    type: EdgeType = EdgeType.NORMAL,
    label?: string
  ): WorkflowEdge {
    return {
      id: `${source}_to_${target}`,
      source,
      target,
      type,
      label
    };
  }
  
  /**
   * Architect Code Job 메타데이터
   * 
   * 실제 packages/ant-cli/src/agents/architect/graph/code/graph.ts 구조 기반
   */
  private getArchitectCodeMetadata(): WorkflowGraphMetadata {
    const nodes: WorkflowNode[] = [
      // Entry
      this.createNode('resolve', NodeType.ENTRY, 'Resolve', {
        description: 'Load context and artifacts',
        importance: NodeImportance.CRITICAL,
        actors: [COMMON_ACTORS.localStorage.id]
      }),
      
      // Core workflow
      this.createNode('decompose', NodeType.PROCESS, 'Decompose', {
        description: 'Break down spec into tasks',
        importance: NodeImportance.CRITICAL,
        actors: [COMMON_ACTORS.llm.id, COMMON_ACTORS.localStorage.id]
      }),
      this.createNode('plan', NodeType.PROCESS, 'Plan', {
        description: 'Create execution plan for current task',
        importance: NodeImportance.CRITICAL,
        actors: [COMMON_ACTORS.llm.id, COMMON_ACTORS.vectorDb.id]
      }),
      this.createNode('execute', NodeType.PROCESS, 'Execute', {
        description: 'Generate code based on plan',
        importance: NodeImportance.CRITICAL,
        actors: [COMMON_ACTORS.llm.id]
      }),
      this.createNode('writeFiles', NodeType.PROCESS, 'Write Files', {
        description: 'Write generated code to filesystem',
        importance: NodeImportance.MAJOR,
        actors: [COMMON_ACTORS.fileSystem.id]
      }),
      
      // Validation chain
      this.createNode('validate', NodeType.DECISION, 'Validate', {
        description: 'Static validation (ellipsis, excessive deletion)',
        importance: NodeImportance.MAJOR
      }),
      this.createNode('installDeps', NodeType.PROCESS, 'Install Dependencies', {
        description: 'Install required packages',
        importance: NodeImportance.MAJOR,
        actors: [COMMON_ACTORS.tool.id]
      }),
      this.createNode('runtimeValidate', NodeType.DECISION, 'Runtime Validate', {
        description: 'Build and test code',
        importance: NodeImportance.MAJOR,
        actors: [COMMON_ACTORS.tool.id]
      }),
      
      // Error handling
      this.createNode('enforce', NodeType.PROCESS, 'Enforce', {
        description: 'Handle validation errors',
        importance: NodeImportance.MAJOR
      }),
      
      // Task management
      this.createNode('checkTaskStatus', NodeType.DECISION, 'Check Task Status', {
        description: 'Determine next task or completion',
        importance: NodeImportance.CRITICAL,
        actors: [COMMON_ACTORS.localStorage.id]
      }),
      
      // End
      this.createNode('learn', NodeType.END, 'Learn', {
        description: 'Store learnings and finalize',
        importance: NodeImportance.CRITICAL,
        actors: [COMMON_ACTORS.vectorDb.id, COMMON_ACTORS.localStorage.id]
      })
    ];
    
    const edges: WorkflowEdge[] = [
      // Main flow
      this.createEdge('__start__', 'resolve'),
      this.createEdge('resolve', 'decompose'),
      this.createEdge('decompose', 'plan'),
      this.createEdge('plan', 'execute'),
      this.createEdge('execute', 'writeFiles'),
      this.createEdge('writeFiles', 'validate'),
      
      // Validation branches
      this.createEdge('validate', 'enforce', EdgeType.CONDITIONAL, 'has violations'),
      this.createEdge('validate', 'installDeps', EdgeType.CONDITIONAL, 'valid'),
      this.createEdge('installDeps', 'runtimeValidate'),
      
      // Runtime validation branches
      this.createEdge('runtimeValidate', 'enforce', EdgeType.CONDITIONAL, 'has errors'),
      this.createEdge('runtimeValidate', 'checkTaskStatus', EdgeType.CONDITIONAL, 'passed'),
      
      // Retry loop
      this.createEdge('enforce', 'plan', EdgeType.LOOP, 'retry'),
      
      // Task completion branches
      this.createEdge('checkTaskStatus', 'plan', EdgeType.LOOP, 'next task'),
      this.createEdge('checkTaskStatus', 'learn', EdgeType.CONDITIONAL, 'all done')
    ];
    
    const actors: ExternalActor[] = [
      COMMON_ACTORS.llm,
      COMMON_ACTORS.vectorDb,
      COMMON_ACTORS.localStorage,
      COMMON_ACTORS.fileSystem,
      COMMON_ACTORS.tool
    ];
    
    return {
      agent: 'architect',
      job: 'code',
      nodes,
      edges,
      actors,
      entryNode: 'resolve',
      endNodes: ['learn']
    };
  }
  
  /**
   * Architect Design Job 메타데이터
   * 
   * 실제 packages/ant-cli/src/agents/architect/graph/design/graph.ts 구조 기반
   */
  private getArchitectDesignMetadata(): WorkflowGraphMetadata {
    const nodes: WorkflowNode[] = [
      this.createNode('resolve', NodeType.ENTRY, 'Resolve', {
        description: 'Load context and artifacts',
        importance: NodeImportance.CRITICAL,
        actors: [COMMON_ACTORS.localStorage.id]
      }),
      this.createNode('plan', NodeType.PROCESS, 'Plan', {
        description: 'Create design plan',
        importance: NodeImportance.MAJOR,
        actors: [COMMON_ACTORS.llm.id]
      }),
      this.createNode('execute', NodeType.PROCESS, 'Execute', {
        description: 'Generate design document',
        importance: NodeImportance.CRITICAL,
        actors: [COMMON_ACTORS.llm.id, COMMON_ACTORS.fileSystem.id]
      }),
      this.createNode('learn', NodeType.END, 'Learn', {
        description: 'Store learnings',
        importance: NodeImportance.MAJOR,
        actors: [COMMON_ACTORS.vectorDb.id]
      })
    ];
    
    const edges: WorkflowEdge[] = [
      this.createEdge('__start__', 'resolve'),
      this.createEdge('resolve', 'plan'),
      this.createEdge('plan', 'execute'),
      this.createEdge('execute', 'learn')
    ];
    
    const actors: ExternalActor[] = [
      COMMON_ACTORS.llm,
      COMMON_ACTORS.vectorDb,
      COMMON_ACTORS.localStorage,
      COMMON_ACTORS.fileSystem
    ];
    
    return {
      agent: 'architect',
      job: 'design',
      nodes,
      edges,
      actors,
      entryNode: 'resolve',
      endNodes: ['learn']
    };
  }
  
  /**
   * Architect Learn Job 메타데이터
   * 
   * 실제 packages/ant-cli/src/agents/architect/graph/learn/graph.ts 구조 기반
   */
  private getArchitectLearnMetadata(): WorkflowGraphMetadata {
    const nodes: WorkflowNode[] = [
      this.createNode('resolve', NodeType.ENTRY, 'Resolve', {
        description: 'Identify learning targets',
        importance: NodeImportance.MAJOR
      }),
      this.createNode('store', NodeType.END, 'Store', {
        description: 'Store learnings in vector DB',
        importance: NodeImportance.CRITICAL,
        actors: [COMMON_ACTORS.vectorDb.id, COMMON_ACTORS.fileSystem.id]
      })
    ];
    
    const edges: WorkflowEdge[] = [
      this.createEdge('__start__', 'resolve'),
      this.createEdge('resolve', 'store')
    ];
    
    const actors: ExternalActor[] = [
      COMMON_ACTORS.vectorDb,
      COMMON_ACTORS.fileSystem
    ];
    
    return {
      agent: 'architect',
      job: 'learn',
      nodes,
      edges,
      actors,
      entryNode: 'resolve',
      endNodes: ['store']
    };
  }
}
