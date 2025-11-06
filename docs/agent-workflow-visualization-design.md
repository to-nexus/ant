# 🎨 Agent Workflow Visualization System Design

## 📌 1. 개요

### 1.1 목적
LangGraph 기반 Agent Job의 실행 흐름을 n8n 스타일로 시각화하여:
- Job 시작 전: 그래프 구조 사전 확인
- Job 실행 중: 실시간 노드 전환 모니터링
- 외부 Actor(LLM, Storage 등)와의 상호작용 추적

### 1.2 시각화 스타일
- **Flow 스타일**: 좌→우 또는 상→하 흐름
- **FSM (Finite State Machine)**: 상태 전환 명확 표현
- **자동 배치**: Dagre 알고리즘 사용

### 1.3 주요 요구사항
- ✅ 모든 내부 노드 표시 (중요도별 크기 차별화)
- ✅ Job 실행 전에도 그래프 미리 표시
- ✅ 실시간 현재 노드 상태 표시
- ✅ Session file 저장, LLM API 호출 등 외부 상호작용 시각화

---

## 📐 2. 아키텍처 개요

```
┌─────────────────────────────────────────────────────────────┐
│                         ant-ui (Frontend)                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  AgentWorkflowBoard                                  │   │
│  │  ├─ GraphMetadataLoader (선택된 agent-job 메타데이터) │   │
│  │  ├─ WorkflowCanvas (ReactFlow 기반 시각화)          │   │
│  │  └─ RealtimeStateUpdater (SSE로 현재 노드 업데이트) │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                          ↕ HTTP + SSE
┌─────────────────────────────────────────────────────────────┐
│                        ant-cli (Backend)                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  GraphMetadataService                                │   │
│  │  ├─ extractGraphStructure(agent, job)                │   │
│  │  │   → nodes, edges, actors 추출                     │   │
│  │  └─ classifyNodeImportance()                         │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  WorkflowStateService (SSE)                          │   │
│  │  ├─ broadcastCurrentNode(jobId, nodeId)             │   │
│  │  └─ broadcastNodeTransition(jobId, from, to)        │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 📊 3. 데이터 모델

### 3.1 Graph Metadata (정적 구조)

```typescript
// 전체 그래프 메타데이터
interface WorkflowGraphMetadata {
  agent: string;           // 'architect', 'code' 등
  job: string;             // 'code', 'design' 등
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  actors: ExternalActor[];
  entryNode: string;       // 시작 노드 ID
  endNodes: string[];      // 종료 노드 ID들
}

// 노드 정의
interface WorkflowNode {
  id: string;              // 'decompose', 'plan', 'execute' 등
  type: NodeType;
  label: string;           // 표시명
  description?: string;
  importance: NodeImportance;
  position?: { x: number; y: number };  // 자동 배치 후 저장 가능
  interactsWithActors: string[];  // 연결된 Actor ID들
}

enum NodeType {
  ENTRY = 'entry',         // 시작 노드
  PROCESS = 'process',     // 일반 처리 노드
  DECISION = 'decision',   // 조건 분기 노드
  END = 'end',             // 종료 노드
  CHECKPOINT = 'checkpoint' // 체크포인트 노드
}

enum NodeImportance {
  CRITICAL = 'critical',   // 핵심 노드 (크게 표시)
  MAJOR = 'major',         // 주요 노드 (보통)
  MINOR = 'minor'          // 보조 노드 (작게 표시)
}

// 엣지 (노드 간 전환)
interface WorkflowEdge {
  id: string;
  source: string;          // 시작 노드 ID
  target: string;          // 도착 노드 ID
  type: EdgeType;
  label?: string;          // 조건 표시 (예: "success", "retry")
  condition?: string;      // 조건식 설명
}

enum EdgeType {
  NORMAL = 'normal',       // 일반 전환
  CONDITIONAL = 'conditional',  // 조건부 전환
  LOOP = 'loop',           // 반복
  ERROR = 'error'          // 에러 처리
}

// 외부 Actor
interface ExternalActor {
  id: string;              // 'llm', 'vector-db', 'local-storage' 등
  type: ActorType;
  label: string;
  icon?: string;
}

enum ActorType {
  LLM = 'llm',                    // LLM API
  EMBEDDING = 'embedding',        // Embedding Model
  VECTOR_DB = 'vector-db',        // Vector Database
  LOCAL_STORAGE = 'local-storage', // Session 저장
  FILE_SYSTEM = 'file-system',    // 파일 읽기/쓰기
  TOOL = 'tool'                   // 기타 도구
}

// 노드-Actor 상호작용
interface NodeActorInteraction {
  nodeId: string;
  actorId: string;
  interactionType: InteractionType;
  description: string;
}

enum InteractionType {
  API_REQUEST = 'api-request',    // API 요청
  API_RESPONSE = 'api-response',  // API 응답
  READ = 'read',                  // 읽기
  WRITE = 'write',                // 쓰기
  QUERY = 'query',                // 쿼리
  GENERATE = 'generate'           // 생성
}
```

### 3.2 Realtime State (동적 상태)

```typescript
// 실시간 상태 (SSE로 전송)
interface WorkflowRealtimeState {
  jobId: string;
  currentNode: string | null;     // 현재 활성 노드
  previousNode: string | null;    // 이전 노드
  startedAt: string;              // Job 시작 시각
  nodeHistory: NodeHistoryEntry[]; // 노드 방문 기록
}

interface NodeHistoryEntry {
  nodeId: string;
  enteredAt: string;
  exitedAt?: string;
  duration?: number;  // ms
}
```

---

## 🔧 4. 백엔드 설계 (ant-cli)

### 4.1 GraphMetadataService

#### 책임
- LangGraph 코드 분석하여 메타데이터 추출
- 노드 중요도 자동 분류
- 외부 Actor 식별

#### 구현 위치
`packages/ant-cli/src/periphery/adapters/http/services/GraphMetadataService.ts`

#### 주요 메서드

```typescript
class GraphMetadataService {
  /**
   * Agent-Job 조합에 대한 그래프 메타데이터 추출
   */
  async extractGraphMetadata(
    agent: string, 
    job: string
  ): Promise<WorkflowGraphMetadata> {
    // 1. 해당 agent의 graph.ts 파일 로드
    // 2. StateGraph 정의 파싱
    // 3. addNode(), addEdge() 호출 추적
    // 4. 노드별 코드 분석하여 Actor 식별
    // 5. 중요도 자동 분류
  }

  /**
   * 노드 중요도 자동 분류
   * 기준:
   * - CRITICAL: entry, end, checkpoint 노드
   * - MAJOR: LLM API 호출, 파일 생성 등 주요 작업
   * - MINOR: 검증, 로깅 등 보조 작업
   */
  private classifyNodeImportance(
    nodeId: string,
    nodeCode: string
  ): NodeImportance {
    // 휴리스틱 기반 분류
    if (nodeId.includes('decompose') || nodeId.includes('execute')) {
      return NodeImportance.CRITICAL;
    }
    if (nodeCode.includes('llm.') || nodeCode.includes('generateCode')) {
      return NodeImportance.MAJOR;
    }
    return NodeImportance.MINOR;
  }

  /**
   * 노드 코드에서 외부 Actor 식별
   */
  private identifyActors(nodeCode: string): string[] {
    const actors: string[] = [];
    
    // LLM 사용 여부
    if (nodeCode.includes('llm.invoke') || nodeCode.includes('model.invoke')) {
      actors.push('llm');
    }
    
    // Embedding 사용
    if (nodeCode.includes('embeddings.') || nodeCode.includes('vectorStore')) {
      actors.push('embedding');
      actors.push('vector-db');
    }
    
    // 파일/스토리지
    if (nodeCode.includes('saveCheckpoint') || nodeCode.includes('session')) {
      actors.push('local-storage');
    }
    
    if (nodeCode.includes('fs.write') || nodeCode.includes('writeFile')) {
      actors.push('file-system');
    }
    
    return actors;
  }
}
```

### 4.2 WorkflowStateService (SSE)

#### 책임
- Job 실행 중 현재 노드 상태를 실시간 브로드캐스트

#### 구현 위치
`packages/ant-cli/src/periphery/adapters/http/services/WorkflowStateService.ts`

#### 주요 메서드

```typescript
class WorkflowStateService {
  private workflowSSE: Map<string, Set<Response>> = new Map();
  
  /**
   * 현재 노드 브로드캐스트
   */
  broadcastCurrentNode(jobId: string, nodeId: string) {
    const key = jobId;
    const clients = this.workflowSSE.get(key);
    
    if (clients) {
      const state: WorkflowRealtimeState = {
        jobId,
        currentNode: nodeId,
        previousNode: this.getPreviousNode(jobId),
        startedAt: this.getJobStartTime(jobId),
        nodeHistory: this.getNodeHistory(jobId)
      };
      
      clients.forEach(client => {
        client.write(`data: ${JSON.stringify(state)}\n\n`);
      });
    }
  }
}
```

### 4.3 LangGraph 계측 (Instrumentation)

#### 방법 1: 기존 checkpoint 활용
- `saveCheckpoint` 호출 시 현재 노드 정보 함께 브로드캐스트

#### 방법 2: LangGraph 미들웨어/리스너 추가
```typescript
// graph.ts에 추가
graph.addListener('node:enter', (nodeId) => {
  if (process.env.ANT_JOB_ID) {
    workflowStateService.broadcastCurrentNode(
      process.env.ANT_JOB_ID, 
      nodeId
    );
  }
});
```

### 4.4 API Routes

새로운 라우트 파일 생성:
`packages/ant-cli/src/periphery/adapters/http/routes/workflowRoutes.ts`

```typescript
export function createWorkflowRoutes(deps: {
  graphMetadataService: GraphMetadataService;
  workflowStateService: WorkflowStateService;
}): Router {
  const router = Router();
  
  // 그래프 메타데이터 조회
  router.get('/agents/:agent/jobs/:job/graph-metadata', async (req, res) => {
    const { agent, job } = req.params;
    const metadata = await deps.graphMetadataService.extractGraphMetadata(agent, job);
    res.json(metadata);
  });
  
  // 실시간 상태 스트림
  router.get('/jobs/:jobId/workflow/stream', (req, res) => {
    const { jobId } = req.params;
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    deps.workflowStateService.addClient(jobId, res);
    
    req.on('close', () => {
      deps.workflowStateService.removeClient(jobId, res);
    });
  });
  
  return router;
}
```

---

## 🎨 5. 프론트엔드 설계 (ant-ui)

### 5.1 라이브러리 선정

**ReactFlow** 선택 이유:
- ✅ React 네이티브 지원
- ✅ 자동 레이아웃 (Dagre)
- ✅ 커스텀 노드/엣지 지원
- ✅ 애니메이션 지원
- ✅ n8n 스타일 구현 가능

```bash
npm install reactflow dagre @types/dagre
```

### 5.2 컴포넌트 구조

```
packages/ant-ui/src/components/workflow/
├── AgentWorkflowBoard.tsx           # 기존 (컨테이너)
├── WorkflowVisualization.tsx        # 새로 추가 (메인 시각화)
├── nodes/
│   ├── WorkflowNode.tsx             # 커스텀 노드 컴포넌트
│   ├── EntryNode.tsx
│   ├── ProcessNode.tsx
│   ├── DecisionNode.tsx
│   ├── CheckpointNode.tsx
│   └── EndNode.tsx
├── actors/
│   ├── ActorNode.tsx                # Actor 노드
│   ├── LLMActorNode.tsx
│   ├── StorageActorNode.tsx
│   └── FileSystemActorNode.tsx
├── edges/
│   ├── WorkflowEdge.tsx             # 커스텀 엣지
│   ├── ConditionalEdge.tsx
│   └── AnimatedEdge.tsx             # 실행 중 애니메이션
└── hooks/
    ├── useGraphMetadata.ts          # 메타데이터 로드
    ├── useWorkflowState.ts          # SSE 실시간 상태
    └── useGraphLayout.ts            # Dagre 레이아웃
```

### 5.3 주요 컴포넌트

#### WorkflowVisualization.tsx

```typescript
export function WorkflowVisualization() {
  const selectedAgent = useStore(state => state.selectedAgent);
  const selectedWorkType = useStore(state => state.selectedWorkType);
  const currentJob = useStore(state => state.currentJob);
  
  // 1. 정적 그래프 메타데이터 로드
  const { metadata, loading } = useGraphMetadata(selectedAgent, selectedWorkType);
  
  // 2. 실시간 상태 구독 (Job 실행 중일 때만)
  const realtimeState = useWorkflowState(currentJob?.jobId);
  
  // 3. ReactFlow 노드/엣지 변환 + 레이아웃
  const { nodes, edges } = useGraphLayout(metadata, realtimeState);
  
  if (loading) {
    return <div>Loading workflow graph...</div>;
  }
  
  if (!metadata) {
    return <div>No workflow data available</div>;
  }
  
  return (
    <div className="workflow-visualization h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={customNodeTypes}
        edgeTypes={customEdgeTypes}
        fitView
        attributionPosition="bottom-left"
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}
```

#### useGraphMetadata Hook

```typescript
export function useGraphMetadata(agent: string, job: string) {
  const [metadata, setMetadata] = useState<WorkflowGraphMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  useEffect(() => {
    async function loadMetadata() {
      setLoading(true);
      setError(null);
      
      try {
        const response = await fetch(
          `/api/agents/${agent}/jobs/${job}/graph-metadata`
        );
        
        if (!response.ok) {
          throw new Error(`Failed to load graph metadata: ${response.statusText}`);
        }
        
        const data = await response.json();
        setMetadata(data);
      } catch (err) {
        console.error('Failed to load graph metadata:', err);
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    }
    
    if (agent && job) {
      loadMetadata();
    }
  }, [agent, job]);
  
  return { metadata, loading, error };
}
```

#### useWorkflowState Hook (SSE)

```typescript
export function useWorkflowState(jobId: string | undefined) {
  const [state, setState] = useState<WorkflowRealtimeState | null>(null);
  
  useEffect(() => {
    if (!jobId) {
      setState(null);
      return;
    }
    
    const eventSource = new EventSource(
      `/api/jobs/${jobId}/workflow/stream`
    );
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setState(data);
    };
    
    eventSource.onerror = (error) => {
      console.error('[WorkflowState] SSE error:', error);
      eventSource.close();
    };
    
    return () => {
      eventSource.close();
    };
  }, [jobId]);
  
  return state;
}
```

#### useGraphLayout Hook (Dagre)

```typescript
import dagre from 'dagre';
import { Node, Edge } from 'reactflow';

export function useGraphLayout(
  metadata: WorkflowGraphMetadata | null,
  realtimeState: WorkflowRealtimeState | null
) {
  return useMemo(() => {
    if (!metadata) {
      return { nodes: [], edges: [] };
    }
    
    // 1. ReactFlow 노드로 변환
    const rfNodes: Node[] = metadata.nodes.map(node => ({
      id: node.id,
      type: node.type,
      data: {
        label: node.label,
        description: node.description,
        importance: node.importance,
        isActive: realtimeState?.currentNode === node.id,
        actors: node.interactsWithActors
      },
      position: { x: 0, y: 0 }, // Dagre가 계산할 것
    }));
    
    // 2. ReactFlow 엣지로 변환
    const rfEdges: Edge[] = metadata.edges.map(edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.type,
      label: edge.label,
      animated: realtimeState?.previousNode === edge.source && 
                realtimeState?.currentNode === edge.target,
    }));
    
    // 3. Dagre 레이아웃 계산
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));
    dagreGraph.setGraph({ rankdir: 'TB' }); // Top to Bottom
    
    rfNodes.forEach(node => {
      const width = getNodeWidth(node.data.importance);
      const height = getNodeHeight(node.data.importance);
      dagreGraph.setNode(node.id, { width, height });
    });
    
    rfEdges.forEach(edge => {
      dagreGraph.setEdge(edge.source, edge.target);
    });
    
    dagre.layout(dagreGraph);
    
    // 4. 계산된 위치 적용
    const layoutedNodes = rfNodes.map(node => {
      const nodeWithPosition = dagreGraph.node(node.id);
      return {
        ...node,
        position: {
          x: nodeWithPosition.x - getNodeWidth(node.data.importance) / 2,
          y: nodeWithPosition.y - getNodeHeight(node.data.importance) / 2,
        },
      };
    });
    
    return { nodes: layoutedNodes, edges: rfEdges };
  }, [metadata, realtimeState]);
}

function getNodeWidth(importance: NodeImportance): number {
  switch (importance) {
    case NodeImportance.CRITICAL: return 200;
    case NodeImportance.MAJOR: return 160;
    case NodeImportance.MINOR: return 120;
    default: return 160;
  }
}

function getNodeHeight(importance: NodeImportance): number {
  switch (importance) {
    case NodeImportance.CRITICAL: return 80;
    case NodeImportance.MAJOR: return 64;
    case NodeImportance.MINOR: return 48;
    default: return 64;
  }
}
```

### 5.4 노드 스타일링

```typescript
// 중요도별 크기 및 스타일
const NODE_STYLES = {
  [NodeImportance.CRITICAL]: {
    width: 200,
    height: 80,
    fontSize: '16px',
    fontWeight: 'bold',
    borderWidth: 3
  },
  [NodeImportance.MAJOR]: {
    width: 160,
    height: 64,
    fontSize: '14px',
    fontWeight: 'medium',
    borderWidth: 2
  },
  [NodeImportance.MINOR]: {
    width: 120,
    height: 48,
    fontSize: '12px',
    fontWeight: 'normal',
    borderWidth: 1
  }
};

// 노드 타입별 색상 (라이트 모드)
const NODE_COLORS_LIGHT = {
  [NodeType.ENTRY]: 'bg-green-100 border-green-500 text-green-900',
  [NodeType.PROCESS]: 'bg-blue-100 border-blue-500 text-blue-900',
  [NodeType.DECISION]: 'bg-yellow-100 border-yellow-500 text-yellow-900',
  [NodeType.CHECKPOINT]: 'bg-purple-100 border-purple-500 text-purple-900',
  [NodeType.END]: 'bg-red-100 border-red-500 text-red-900'
};

// 노드 타입별 색상 (다크 모드)
const NODE_COLORS_DARK = {
  [NodeType.ENTRY]: 'bg-green-900 border-green-400 text-green-100',
  [NodeType.PROCESS]: 'bg-blue-900 border-blue-400 text-blue-100',
  [NodeType.DECISION]: 'bg-yellow-900 border-yellow-400 text-yellow-100',
  [NodeType.CHECKPOINT]: 'bg-purple-900 border-purple-400 text-purple-100',
  [NodeType.END]: 'bg-red-900 border-red-400 text-red-100'
};

// 활성 노드 스타일
const ACTIVE_NODE_STYLE = {
  border: '3px solid #10b981',  // 초록 테두리
  boxShadow: '0 0 20px rgba(16, 185, 129, 0.5)',  // 발광 효과
  animation: 'pulse 2s infinite'
};
```

#### WorkflowNode 컴포넌트

```typescript
export function WorkflowNode({ data }: { data: NodeData }) {
  const theme = useStore(state => state.theme);
  const style = NODE_STYLES[data.importance];
  const colorClass = theme === 'dark' 
    ? NODE_COLORS_DARK[data.type] 
    : NODE_COLORS_LIGHT[data.type];
  
  return (
    <div
      className={cn(
        'workflow-node rounded-lg flex flex-col items-center justify-center',
        'border transition-all duration-200',
        colorClass,
        data.isActive && 'border-green-500 shadow-lg shadow-green-500/50'
      )}
      style={{
        width: style.width,
        height: style.height,
        borderWidth: data.isActive ? 3 : style.borderWidth,
      }}
    >
      <Handle type="target" position={Position.Top} />
      
      <div className="text-center px-2">
        <div 
          className="font-semibold" 
          style={{ fontSize: style.fontSize, fontWeight: style.fontWeight }}
        >
          {data.label}
        </div>
        
        {data.isActive && (
          <div className="mt-1 text-xs text-green-600 dark:text-green-400 font-bold">
            ● Active
          </div>
        )}
      </div>
      
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
```

### 5.5 Actor 시각화

```typescript
// Actor는 별도 영역에 배치 (그래프 오른쪽 또는 하단)
const ActorNode = ({ actor, isActive }: ActorNodeProps) => {
  return (
    <div className={cn(
      'actor-node',
      'rounded-lg p-4 border-2',
      'bg-gray-50 dark:bg-gray-800',
      'border-gray-300 dark:border-gray-600',
      isActive && 'border-green-500 shadow-lg shadow-green-500/30'
    )}>
      <div className="actor-icon text-3xl mb-2">
        {getActorIcon(actor.type)}
      </div>
      <div className="actor-label text-sm font-medium text-center">
        {actor.label}
      </div>
      {isActive && (
        <div className="activity-indicator mt-2">
          <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse mx-auto" />
        </div>
      )}
    </div>
  );
};

const ACTOR_ICONS = {
  [ActorType.LLM]: '🤖',
  [ActorType.EMBEDDING]: '🧠',
  [ActorType.VECTOR_DB]: '🗄️',
  [ActorType.LOCAL_STORAGE]: '💾',
  [ActorType.FILE_SYSTEM]: '📁',
  [ActorType.TOOL]: '🔧'
};
```

---

## 🚀 6. 구현 단계

### Phase 1: 정적 그래프 표시 (1-2일)

**Backend:**
1. ✅ `GraphMetadataService` 구현
2. ✅ `/api/agents/:agent/jobs/:job/graph-metadata` 엔드포인트
3. ✅ Architect agent의 code job 메타데이터 하드코딩 (POC)

**Frontend:**
4. ✅ ReactFlow 설치 및 기본 설정
5. ✅ `WorkflowVisualization` 컴포넌트
6. ✅ 커스텀 노드 컴포넌트 (5종)
7. ✅ Dagre 자동 레이아웃
8. ✅ 중요도별 크기 차별화

**완료 기준:**
- GNB에서 Agent/Job 선택 시 정적 그래프가 표시됨
- 노드 타입별 색상 구분
- 노드 중요도별 크기 구분
- 엣지 연결 표시

### Phase 2: 실시간 상태 연동 (1-2일)

**Backend:**
9. ✅ `WorkflowStateService` 구현
10. ✅ LangGraph에 계측 추가 (node:enter 이벤트)
11. ✅ `/api/jobs/:jobId/workflow/stream` SSE 엔드포인트

**Frontend:**
12. ✅ `useWorkflowState` Hook (SSE)
13. ✅ 활성 노드 강조 표시
14. ✅ 노드 전환 애니메이션

**완료 기준:**
- Job 실행 시 현재 노드가 실시간으로 강조됨
- 노드 전환 시 엣지에 애니메이션 표시
- Job 종료 시 모든 강조 제거

### Phase 3: Actor 시각화 (1일)

**Backend:**
15. ✅ 노드 코드 분석하여 Actor 식별 로직

**Frontend:**
16. ✅ Actor 노드 컴포넌트
17. ✅ 노드-Actor 상호작용 선 표시
18. ✅ Actor 활성화 표시 (데이터 흐름)

**완료 기준:**
- LLM, Storage 등 Actor가 별도 영역에 표시됨
- 노드와 Actor 간 점선으로 연결
- 현재 노드가 Actor와 상호작용 중이면 Actor도 강조

### Phase 4: 고도화 (선택)

19. ⭕ 노드 클릭 시 상세 정보 패널
20. ⭕ 실행 히스토리 타임라인
21. ⭕ 에러 노드 시각화
22. ⭕ 줌/팬 최적화

---

## 📝 7. API 명세

### 7.1 Graph Metadata API

```
GET /api/agents/:agent/jobs/:job/graph-metadata

Parameters:
- agent: string (예: 'architect', 'code')
- job: string (예: 'code', 'design')

Response: 200 OK
{
  "agent": "architect",
  "job": "code",
  "nodes": [
    {
      "id": "decompose",
      "type": "process",
      "label": "Decompose",
      "description": "Break down specification into tasks",
      "importance": "critical",
      "interactsWithActors": ["llm"]
    },
    {
      "id": "plan",
      "type": "process",
      "label": "Plan",
      "description": "Create execution plan",
      "importance": "major",
      "interactsWithActors": ["llm", "vector-db"]
    },
    {
      "id": "execute",
      "type": "process",
      "label": "Execute",
      "description": "Generate code",
      "importance": "critical",
      "interactsWithActors": ["llm", "file-system"]
    },
    {
      "id": "checkpoint",
      "type": "checkpoint",
      "label": "Save State",
      "description": "Save execution state",
      "importance": "major",
      "interactsWithActors": ["local-storage"]
    }
  ],
  "edges": [
    {
      "id": "decompose_to_plan",
      "source": "decompose",
      "target": "plan",
      "type": "normal",
      "label": null
    },
    {
      "id": "plan_to_execute",
      "source": "plan",
      "target": "execute",
      "type": "normal",
      "label": null
    },
    {
      "id": "execute_to_checkpoint",
      "source": "execute",
      "target": "checkpoint",
      "type": "normal",
      "label": null
    },
    {
      "id": "checkpoint_to_execute",
      "source": "checkpoint",
      "target": "execute",
      "type": "loop",
      "label": "retry"
    }
  ],
  "actors": [
    {
      "id": "llm",
      "type": "llm",
      "label": "Claude API",
      "icon": "🤖"
    },
    {
      "id": "vector-db",
      "type": "vector-db",
      "label": "Vector Store",
      "icon": "🗄️"
    },
    {
      "id": "local-storage",
      "type": "local-storage",
      "label": "Session Storage",
      "icon": "💾"
    },
    {
      "id": "file-system",
      "type": "file-system",
      "label": "File System",
      "icon": "📁"
    }
  ],
  "entryNode": "decompose",
  "endNodes": ["finalize"]
}

Error Responses:
- 404: Agent or job not found
- 500: Failed to extract graph metadata
```

### 7.2 Workflow State Stream API

```
GET /api/jobs/:jobId/workflow/stream

Parameters:
- jobId: string (실행 중인 Job ID)

Response: text/event-stream
Headers:
  Content-Type: text/event-stream
  Cache-Control: no-cache
  Connection: keep-alive

Stream Data (SSE format):
data: {
  "jobId": "job-123",
  "currentNode": "execute",
  "previousNode": "plan",
  "startedAt": "2025-11-06T12:00:00Z",
  "nodeHistory": [
    {
      "nodeId": "decompose",
      "enteredAt": "2025-11-06T12:00:00Z",
      "exitedAt": "2025-11-06T12:00:15Z",
      "duration": 15000
    },
    {
      "nodeId": "plan",
      "enteredAt": "2025-11-06T12:00:15Z",
      "exitedAt": "2025-11-06T12:01:00Z",
      "duration": 45000
    },
    {
      "nodeId": "execute",
      "enteredAt": "2025-11-06T12:01:00Z",
      "exitedAt": null,
      "duration": null
    }
  ]
}

Error Responses:
- 404: Job not found
- Connection automatically closes when job completes
```

---

## ✅ 8. 성공 기준

### 8.1 기능 요구사항
1. ✅ GNB에서 Agent/Job 선택 시 즉시 그래프 표시
2. ✅ Job 실행 전에도 정적 그래프 확인 가능
3. ✅ Job 실행 중 현재 노드가 실시간으로 강조 표시
4. ✅ 노드 크기로 중요도 구분 가능
5. ✅ LLM, Storage 등 외부 Actor 시각적으로 식별
6. ✅ 노드 간 전환 관계 명확히 표현

### 8.2 비기능 요구사항
1. ✅ 다크모드 완벽 지원
2. ✅ 반응형 레이아웃 (MainPanel 크기 변경 대응)
3. ✅ 성능: 100개 이상 노드도 부드럽게 렌더링
4. ✅ SSE 연결 안정성 (자동 재연결)

### 8.3 사용자 경험
1. ✅ 직관적인 시각 표현 (n8n 스타일)
2. ✅ 현재 진행 상황 한눈에 파악 가능
3. ✅ 로딩 상태 명확히 표시
4. ✅ 에러 발생 시 적절한 피드백

---

## 🔍 9. 참고 자료

### 9.1 기술 스택
- **ReactFlow**: https://reactflow.dev/
- **Dagre**: https://github.com/dagrejs/dagre
- **LangGraph**: https://js.langchain.com/docs/langgraph

### 9.2 디자인 참고
- **n8n**: https://n8n.io/
- **Prefect**: https://www.prefect.io/
- **Airflow**: https://airflow.apache.org/

### 9.3 프로젝트 파일
- Agent 정의: `packages/ant-cli/src/agents/`
- Graph 정의: `packages/ant-cli/src/agents/*/graph/`
- 기존 UI: `packages/ant-ui/src/components/workflow/`

---

## 📅 10. 개발 일정 (예상)

| Phase | 작업 내용 | 예상 기간 | 담당 |
|-------|---------|---------|-----|
| Phase 1 | 정적 그래프 표시 | 1-2일 | - |
| Phase 2 | 실시간 상태 연동 | 1-2일 | - |
| Phase 3 | Actor 시각화 | 1일 | - |
| Phase 4 | 고도화 (선택) | 1-2일 | - |
| **Total** | | **3-7일** | |

---

## 📌 11. 추가 고려사항

### 11.1 확장성
- 새로운 Agent 추가 시 메타데이터만 추가하면 자동 시각화
- 새로운 Actor 타입 추가 용이
- 커스텀 노드 타입 확장 가능

### 11.2 유지보수성
- 타입 정의 명확 (TypeScript)
- 컴포넌트 단위 테스트 가능
- 설정 파일로 스타일 커스터마이징

### 11.3 미래 개선사항
- 그래프 실행 히스토리 저장 및 재생
- 노드별 성능 메트릭 표시
- A/B 테스트를 위한 그래프 비교
- 에러 분석 및 디버깅 도구

---

**문서 버전**: 1.0  
**최종 수정일**: 2025-11-06  
**작성자**: AI Assistant  
**상태**: 설계 완료, 구현 대기

