/**
 * Workflow Visualization Types (Frontend)
 * 
 * Shared types (WorkflowRealtimeState, etc.) from @ant/shared.
 * FE-only types (enums, graph metadata) defined here.
 */

// ============================================
// Shared Types (canonical source: @ant/shared)
// ============================================

export type {
  TaskInfo,
  NodeHistoryEntry,
  ActiveWorkerNode,
  WorkflowRealtimeState,
} from '@ant/shared';

// ============================================
// FE-only: Workflow Graph Visualization
// ============================================

export enum NodeType {
  ENTRY = 'entry',
  PROCESS = 'process',
  DECISION = 'decision',
  END = 'end',
  CHECKPOINT = 'checkpoint'
}

export enum NodeImportance {
  CRITICAL = 'critical',
  MAJOR = 'major',
  MINOR = 'minor'
}

export enum EdgeType {
  NORMAL = 'normal',
  CONDITIONAL = 'conditional',
  LOOP = 'loop',
  ERROR = 'error'
}

export enum ActorType {
  LLM = 'llm',
  EMBEDDING = 'embedding',
  VECTOR_DB = 'vector-db',
  LOCAL_STORAGE = 'local-storage',
  FILE_SYSTEM = 'file-system',
  CODE_REPO = 'code-repo',
  TOOL = 'tool'
}

export interface WorkflowNode {
  id: string;
  type: NodeType;
  label: string;
  description?: string;
  importance: NodeImportance;
  position?: { x: number; y: number };
  interactsWithActors: string[];
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  label?: string;
  condition?: string;
}

export interface ExternalActor {
  id: string;
  type: ActorType;
  label: string;
  icon?: string;
}

export interface WorkflowGraphMetadata {
  agent: string;
  job: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  actors: ExternalActor[];
  entryNode: string;
  endNodes: string[];
}
