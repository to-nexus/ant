# Output Tag Matrix — LLM 응답 태그 처리 SSOT

## 개요

LLM 이 emit 하는 모든 canonical `<tag>` 의 처리 정책을 4 축 MECE 매트릭스로 고정한다. 이 문서는 단일 진실의 원천 (SSOT) — 등록된 모든 태그가 정확히 1개 셀에 매핑되며, 코드 측 [`OutputTagRegistry`](../../packages/ant-cli/src/core/streaming/OutputTagRegistry.ts) 가 이 표를 1:1 로 인코딩한다.

**핵심 원칙**:
- 새 태그 추가 시 (a) 이 매트릭스에 행 추가, (b) `OutputTagRegistry` 에 entry 추가 — 두 곳만 건드린다.
- 산발 파서 (`extractPlanText` 류) 신설 금지. registry 의 `extract` hook 만 사용.
- 채팅 렌더링 / 스트림 파싱 / 영속 / 디스크 쓰기는 분리 책임 — registry 의 hook 만 read.

## 4축 MECE 분류

태그 의미는 4 개의 직교 축으로 정확히 1 개 셀에 매핑된다. 같은 셀에 두 태그가 들어가면 의미 충돌 — 등록 거부.

### Axis A · Intent (LLM 이 무엇을 표현하는가)

| 값 | 의미 |
|---|---|
| `artifact` | 디스크 또는 sealed state 로 가는 산출물 |
| `narrative` | 사용자 directive 에 대한 답변/요약/제안 |
| `control` | 그래프 흐름 제어 (work-blocking 또는 완료 신호) |
| `decision` | 사후 라우팅에 쓰이는 단발 분류 결정 |
| `metadata` | UI 카드 / 내부 상태로만 가는 부수 정보 |

### Axis B · Processing (스트림 파이프에서의 처리)

| 값 | 의미 |
|---|---|
| `stream-action` | [`XMLStreamParser`](../../packages/ant-cli/src/core/streaming/parsers/XMLStreamParser.ts) 가 스트림 중 action 으로 분기 |
| `consumed-formatted` | [`SpecialTagTransformer`](../../packages/ant-cli/src/core/streaming/transformers/SpecialTagTransformer.ts) 가 채팅 텍스트로 변환 후 consume |
| `consumed-suppressed` | SpecialTagTransformer 가 silent consume (UI 표면 0) |
| `post-stream` | 스트림 종료 후 별도 extractor 가 본문 잘라 state 로 |

### Axis C · Persistence (영속 surface)

| 값 | 의미 |
|---|---|
| `disk-file` | 파일시스템 (`FileRenderer` / `FileRegistry`) |
| `sealed-state` | LangGraph state.* 채널 |
| `chat-line` | `chat.jsonl` 의 라인 (`type` + `kind` 조합) |
| `kanban` | task queue UI |
| `card-only` | 라이브 카드 (placeholder, plan_generating 같은 progressive) — `chat.jsonl` 영속 없음 |
| `none` | 영속 0 (silent state mutation 만) |

### Axis D · Blocking (그래프 흐름에 미치는 효과)

| 값 | 의미 |
|---|---|
| `blocking` | 노드 진행을 멈추고 사용자 입력을 기다림 |
| `terminal` | 현재 task 완료 신호 |
| `non-blocking` | 작업 진행과 병행 |

## 매트릭스 (등록된 모든 태그)

| 태그 | A · Intent | B · Processing | C · Persistence | D · Blocking | 발신 노드 (대표) |
|---|---|---|---|---|---|
| `<file>` | artifact | stream-action | disk-file | non-blocking | execute / docGen |
| `<append>` | artifact | stream-action | disk-file | non-blocking | docGen |
| `<edit>` | artifact | stream-action | disk-file | non-blocking | execute |
| `<delete>` | artifact | stream-action | disk-file | non-blocking | execute |
| `<plan>` | artifact | stream-action + post-stream | sealed-state + card-only | non-blocking | plan |
| `<reply>` | narrative | consumed-formatted (`kind=directive_reply`) | chat-line | non-blocking | plan / docGen / execute / direct / generate / ask |
| `<done>` | control | consumed-formatted | chat-line (terminal notice) | terminal | execute / docGen / direct |
| `<clarify>` | control | post-stream + card-only | chat-line + card | blocking | docGen / generate |
| `<executionTier>` | decision | consumed-formatted + post-stream | sealed-state + chat-line | non-blocking | decompose |
| `<domain>` | decision | consumed-suppressed + post-stream | sealed-state | non-blocking | detect / decompose |
| `<gameArtTier>` | decision | consumed-suppressed + post-stream | sealed-state | non-blocking | detect / decompose |
| `<gameContentTier>` | decision | consumed-suppressed + post-stream | sealed-state | non-blocking | detect / decompose |
| `<techTier>` | decision | consumed-suppressed + post-stream | sealed-state | non-blocking | detect / decompose |
| `<tasks>` | metadata | stream-action (`task_added`) | kanban | non-blocking | decompose |
| `<references>` | metadata | consumed-formatted | chat-line | non-blocking | decompose / learn |
| `<detect>` | metadata | consumed-formatted | chat-line | non-blocking | detect / decompose-final |
| `<learn_command>` | metadata | consumed-formatted | chat-line | non-blocking | learn |
| `<thinking>` | metadata | stream-action (`thinking`) | chat-line (`assistant_thinking`) | non-blocking | 모든 LLM 노드 |
| `<boundary>` | metadata | consumed-suppressed | sealed-state | non-blocking | detect 내부 |
| `<directHints>` | metadata | consumed-suppressed | sealed-state | non-blocking | detect 내부 |
| `<specClarify>` | metadata | consumed-suppressed | sealed-state | non-blocking | detect 내부 |
| `<lesson>` | metadata | post-stream | sealed-state | non-blocking | learn |
| `<triage>` | metadata | stream-action (wrapper) | sealed-state | non-blocking | triage |

**태그 밖 free text** 는 등록 셀이 없다. `XMLStreamParser` 가 unhandled-text-policy 로 처리:
- Phase 1 (현재): `chat-line` 의 `kind=legacy` 로 영속 (관찰)
- Phase 2 (목표): silent drop 또는 thinking 강등

## 첫 토큰 규율 (First-Token Discipline)

**Invariant**: LLM 응답의 첫 non-whitespace 토큰은 반드시 `<` (등록된 태그의 시작) 이다.

이는 [`output-tag-policy.md`](../../packages/ant-cli/src/core/prompt/templates/jobs/shared/injections/output-tag-policy.md) partial 이 모든 LLM 노드에 always-on 으로 주입하는 1급 contract.

**근거**: 태그 밖 free text 는 영속 surface 가 없거나 (Phase 2), 의미 라벨 없이 섞이는 (Phase 1) anti-pattern. narrative 가 필요하면 처음부터 `<reply>` 안에 쓴다.

## Cross-Axis Nesting 금지

**Invariant**: 다른 intent axis 의 태그는 nested 될 수 없다.

- artifact 안에 narrative / control / decision / metadata 금지
- narrative 안에 artifact / control / decision / metadata 금지
- control / decision / metadata 도 동일

같은 axis 안 nesting 만 registry 가 명시적으로 허용 — 현재 유일한 사례: `<tasks>` ⊃ `<task>`.

`XMLStreamParser` 는 cross-axis nested 발견 시 outer-tag 본문 안에서 literal text 로 처리 (parse-fail 대신 silent linearize) + 개발-모드 console.warn (prompt drift 시그널).

## 코드 SSOT — 정책 1 곳, 소비자 N 곳

이 매트릭스는 `OutputTagRegistry.ts` 한 파일에 1:1 로 인코딩된다. 소비자는 hook 만 read.

| 책임 | 위치 | registry 와의 관계 |
|---|---|---|
| 태그 등록 (이름/패턴/4축/contract/extract/transform/chatLineKind) | `OutputTagRegistry.ts` | **SSOT** |
| 채팅 렌더링 라우팅 | `SpecialTagTransformer.ts` | registry walk → `transform` 호출 |
| 스트림 파싱 (인크리멘털) | `XMLStreamParser.ts` | registry 에서 stream-action enum read, unhandled-text-policy read |
| 채팅 영속 (SSE / Redis / chat.jsonl) | `LLMResponseService.ts` / `ChatService` | registry 에서 `chatLineKind` read |
| 디스크 쓰기 | `FileRenderer.ts` / `FileRegistry.ts` | (artifact 태그만 — 등록 패턴 불필요) |
| LangGraph state mutation | 각 노드 | registry 의 `extract` 호출 결과 사용 |

**산발 함수 금지**: 새 post-stream extractor 를 별도 파일로 만들지 않는다. registry entry 의 `extract` hook 안에 둔다.

## 발신 노드별 contract

각 발신 노드의 prompt rules 는 `output-tag-policy.md` partial 에 의존하고, variant 에는 **node-specific 보강만** 둔다 (SBS 원칙 — 게이트 axis 에서만 specific).

| 노드 | 사용 가능한 태그 (대표) | variant 보강 contract |
|---|---|---|
| design plan | `<plan>` `<reply>` `<thinking>` | "`<plan>` 은 봉인 JSON. 접근 전략 narrative 는 `<reply>` 1 회." |
| design docGen (spec) | `<file>` `<append>` `<reply>` `<done>` `<clarify>` `<thinking>` | "spec 본문은 반드시 `<file>` 안. 결정 요약은 `<reply>` 한 번." |
| design docGen (system / ui-design / game-art-design) | 위와 동일 | variant 별 본문 포맷만 보강 |
| code execute | `<file>` `<edit>` `<delete>` `<reply>` `<done>` `<thinking>` | task-type 별 보강 |
| code direct | `<reply>` `<done>` `<thinking>` (Tier 0/1) | "Tier 0 답변은 `<reply>` 1 회." |
| code decompose | `<tasks>` `<task>` `<executionTier>` `<techTier>` `<boundary>` `<directHints>` `<thinking>` | decompose-specific |
| code detect | `<detect>` `<domain>` `<gameArtTier>` `<gameContentTier>` `<techTier>` | detect-specific |
| design detect | `<detect>` `<domain>` `<gameArtTier>` `<gameContentTier>` `<techTier>` `<specClarify>` | detect-specific |
| design decompose | `<tasks>` `<task>` `<executionTier>` `<techTier>` | decompose-specific |
| planner generate | `<file>` `<reply>` `<clarify>` `<done>` `<thinking>` | explain mode 는 `<reply>` 만 |
| ask / inline-ask | `<reply>` `<done>` `<thinking>` | — |
| triage | `<triage>` `<thinking>` | — |
| learn | `<learn_command>` `<lesson>` `<references>` | — |

## 추가/변경 절차

1. **이 매트릭스에 행 추가** — 4축 axis 결정 (한 셀만 차지하는지 검증).
2. **`OutputTagRegistry` 에 entry 추가** — `name` / `pattern` / `axis` / `transform?` / `extract?` / `chatLineKind?` / `promptContract`.
3. **회귀 테스트 통과** — `tests/output-tag-matrix.test.ts` 가 매트릭스와 registry 의 1:1 동치, promptContract 누락 0, axis 충돌 0 강제.
4. **(필요 시) 발신 노드 variant rules.md** — node-specific 보강만. universal contract 재서술 금지.

**금지 패턴**:
- 산발 파서 함수 신설 (`extractFooTag.ts` 류) — registry entry 의 `extract` 안에 둔다.
- 같은 태그를 두 모듈에 등록 — registry 한 곳만.
- 노드 prompt 에서 태그 사용 contract 재서술 — partial 에 흡수.
- `code/nodes/plan/rules.md` 의 "pre-tag prose 가 사용자에게 보임" 류 anti-pattern — first-token discipline 정면 위배.

## 경계

- 프롬프트 시스템 / 자동 주입: [`13-prompt-system.md`](13-prompt-system.md)
- 문서 제약 → 프롬프트 매트릭스: [`36-prompt-document-constraint-map.md`](36-prompt-document-constraint-map.md)
- 채팅 / SSE 시스템: [`31-chat-system.md`](31-chat-system.md)
- 통합 대화 상태 (CONV_KEYS): [`34-conversations.md`](34-conversations.md)
- 노드 그래프 레이아웃: [`NODE_GRAPH_LAYOUT.md`](NODE_GRAPH_LAYOUT.md)
