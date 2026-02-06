/**
 * Workflow Visualization Types
 * 
 * 타입 정의: LangGraph 시각화를 위한 메타데이터 구조
 */

export enum NodeType {
  ENTRY = 'entry',         // 시작 노드
  PROCESS = 'process',     // 일반 처리 노드
  DECISION = 'decision',   // 조건 분기 노드
  END = 'end',             // 종료 노드
  CHECKPOINT = 'checkpoint' // 체크포인트 노드
}

export enum NodeImportance {
  CRITICAL = 'critical',   // 핵심 노드 (크게 표시)
  MAJOR = 'major',         // 주요 노드 (보통)
  MINOR = 'minor'          // 보조 노드 (작게 표시)
}

export enum EdgeType {
  NORMAL = 'normal',       // 일반 전환
  CONDITIONAL = 'conditional',  // 조건부 전환
  LOOP = 'loop',           // 반복
  ERROR = 'error'          // 에러 처리
}

export enum ActorType {
  LLM = 'llm',                    // LLM API
  EMBEDDING = 'embedding',        // Embedding Model
  VECTOR_DB = 'vector-db',        // Vector Database
  LOCAL_STORAGE = 'local-storage', // Session 저장
  FILE_SYSTEM = 'file-system',    // Workspace 파일 읽기/쓰기
  CODE_REPO = 'code-repo',        // 실제 코드 저장소
  TOOL = 'tool'                   // 기타 도구
}

export enum InteractionType {
  API_REQUEST = 'api-request',    // API 요청
  API_RESPONSE = 'api-response',  // API 응답
  READ = 'read',                  // 읽기
  WRITE = 'write',                // 쓰기
  QUERY = 'query',                // 쿼리
  GENERATE = 'generate'           // 생성
}

// 노드 정의
export interface WorkflowNode {
  id: string;              // 'decompose', 'plan', 'execute' 등
  type: NodeType;
  label: string;           // 표시명
  description?: string;
  importance: NodeImportance;
  position?: { x: number; y: number };  // 자동 배치 후 저장 가능
  interactsWithActors: string[];  // 연결된 Actor ID들
}

// 엣지 (노드 간 전환)
export interface WorkflowEdge {
  id: string;
  source: string;          // 시작 노드 ID
  target: string;          // 도착 노드 ID
  type: EdgeType;
  label?: string;          // 조건 표시 (예: "success", "retry")
  condition?: string;      // 조건식 설명
}

// 외부 Actor
export interface ExternalActor {
  id: string;              // 'llm', 'vector-db', 'local-storage' 등
  type: ActorType;
  label: string;
  icon?: string;
}

// 노드-Actor 상호작용
export interface NodeActorInteraction {
  nodeId: string;
  actorId: string;
  interactionType: InteractionType;
  description: string;
}

// 전체 그래프 메타데이터
export interface WorkflowGraphMetadata {
  agent: string;           // 'architect', 'code' 등
  job: string;             // 'code', 'design' 등
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  actors: ExternalActor[];
  entryNode: string;       // 시작 노드 ID
  endNodes: string[];      // 종료 노드 ID들
}

// Workflow realtime state types — re-exported from canonical source
export type { WorkflowRealtimeState, NodeHistoryEntry } from '../../../../core/ports/stateStore';

