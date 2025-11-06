/**
 * Workflow Visualization Types (Frontend)
 * 
 * 백엔드 타입과 동일한 구조 유지
 */

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

export interface WorkflowRealtimeState {
  jobId: string;
  currentNode: string | null;
  previousNode: string | null;
  startedAt: string;
  endedAt?: string;  // Job 종료 시간
  isCompleted: boolean;  // Job 완료 여부
  nodeHistory: NodeHistoryEntry[];
  activeActors: string[];  // 현재 통신 중인 Actor IDs
}

export interface NodeHistoryEntry {
  nodeId: string;
  enteredAt: string;
  exitedAt?: string;
  duration?: number;
}

