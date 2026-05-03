# 34. Conversations Record — 통합 대화 상태

## 개요

모든 에이전트 그래프의 대화 데이터를 단일 `conversations: Record<string, ConversationMessage[]>` 필드로 통합.
키 규약 `level:id` 형식으로 세션 레벨과 노드 레벨 대화를 구분한다.

## 구조

```typescript
// packages/ant-cli/src/agents/common/graph/conversations.ts
type ConversationLevel = 'session' | 'node';
type ConversationKey = `${ConversationLevel}:${string}`;

interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | MessageContentBlock[];  // session은 string, node는 string|ContentBlock[]
  timestamp?: string;                       // session 레벨에서 사용
  metadata?: { ... };                       // session 레벨에서 사용
}
```

## 키 상수 (CONV_KEYS)

| 키 | 레벨 | 설명 | 생산자 | 소비자 |
|---|---|---|---|---|
| `session:main` | session | 사용자-에이전트 의미적 대화 (cross-run) | planner resolve/generate, visual resolve/direct | planner generate (compaction), triage (sessionDigest) |
| `node:execute` | node | Code job execute 도구 루프 | code execute, code tool | code execute, code checkTaskStatus |
| `node:plan` | node | **code + design 공유**: plan↔tool 도구 루프. Code 는 항상 사용. Design 은 `intentGroup ∈ {design-spec, design-system-design}` 일 때만 사용 (ui-design / game-art-design 은 dispatcher-only path 로 NODE_PLAN 미사용) | code plan, code tool, design plan, design tool | code plan, design plan |
| `node:docGen` | node | Design job docGen 도구 루프 | design docGen, design tool | design docGen, design checkTaskStatus |
| `node:generate` | node | Planner generate 도구 루프 | planner generate, planner tool | planner generate |
| `node:agent` | node | Ask job 에이전트 루프 | ask agent, ask tool | ask agent |
| `node:direct` | node | Code job direct ReAct 루프 | code direct | code direct |

**Design tool 노드 분기**: `state._activePhase === 'plan'` 이면 NODE_PLAN, 아니면 NODE_DOCGEN 으로 라우팅한다. plan↔tool 과 docGen↔tool 두 루프가 동일 물리 tool 노드를 공유하지만 conv 키는 분리된다. 자세한 그래프 구조는 [15-design-job.md](./15-design-job.md) 참고.

## LangGraph Annotation

```typescript
// ResolvableFields (annotationHelpers.ts)
conversations: Annotation<Conversations>({
  reducer: conversationsReducer,  // shallow merge: { ...prev, ...next }
  default: () => ({}),
})
```

Shallow merge reducer로 동작하여, 노드가 자기 키만 반환하면 다른 키는 보존된다:
```typescript
return { conversations: { [CONV_KEYS.NODE_EXECUTE]: updatedMessages } };
// → session:main, node:plan 등 기존 키 유지
```

## 헬퍼 함수

- `getConv(convs, key)` — 타입 안전 읽기 (없으면 빈 배열)
- `setConv(key, entries)` — 반환 값 빌더
- `isSessionEntry(msg)` / `isNodeMessage(msg)` — 타입 가드

## 세션 파일 저장 형식

```json
{
  "state": {
    "conversations": {
      "session:main": [ { "role": "user", "content": "...", "timestamp": "..." } ],
      "node:generate": [ { "role": "user", "content": "..." } ]
    }
  }
}
```

Legacy 호환: resolve 노드에서 `sessionData.state.conversation` (배열) 형식도 fallback으로 읽음.

## sessionDigest

Triage 프롬프트에 최근 세션 대화 맥락을 주입하여 오탐을 방지한다:
- `buildSessionDigest(entries)` — 최근 2-3턴을 truncate하여 compact string 생성
- 각 에이전트 resolve에서 `conversations[session:main]`으로부터 도출
- Triage base.md의 `{{#if hasSessionDigest}}` 섹션에 삽입
