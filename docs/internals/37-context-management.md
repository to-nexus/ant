# 37. Context Management — Context Lens (크로스잡 컨텍스트)

> e2-humming-spindle 계획의 산출물. ANT의 크로스잡 컨텍스트가 어떻게 저장·증류·조립·주입되는지의 SSOT 문서.
> 관련 코드: [`core/context/`](../../packages/ant-cli/src/core/context/), [`core/executionTier/contextProfile.ts`](../../packages/ant-cli/src/core/executionTier/contextProfile.ts)

## 0. 3계층 모델 — "왜 링이 안 차는가"

| 계층 | 단위 | 관리 메커니즘 |
|---|---|---|
| **per-call** | LLM 호출 1회의 프롬프트 | 토큰링이 보여주는 것: `(input + cacheCreation + cacheRead) / model context window`. 노드가 바뀌면 새 호출 기준으로 표시가 바뀐다 |
| **in-job** | 한 잡 내부의 대화 히스토리 | `compactRun`/`compactTurns` (히스토리 예산 ~90% 시 압축, hot-tail 유지) — 이 문서의 범위 밖 |
| **cross-job** | 잡 사이에 넘어가는 맥락 | **Context Lens** (이 문서) |

**FAQ — 채팅이 아무리 길어져도 링이 차지 않는 이유**: 채팅 전사(chat.jsonl)는 구조적으로 LLM 프롬프트에 들어가지 않는다. 크로스잡 맥락은 feature.jsonl에서 증류된 **bounded** 조립물(프로파일별 4K~12K 토큰 캡)로만 주입되며, 1M급 컨텍스트 윈도우 대비 ~1%라 시각적으로 감지되지 않는다. 이는 결함이 아니라 설계다 — 대형 잡(Tier 3는 잡당 ~90-100 호출)에서 캐시가 task 경계마다 끊기므로, unbounded 채팅 주입은 토큰 비용과 context-rot 양쪽에서 해롭다.

## 1. 두 로그 — 저장은 무손실, 주입은 bounded

| 파일 | 역할 | LLM 주입 |
|---|---|---|
| `sessions/chat.jsonl` | UI SSOT — 모든 표시 이벤트 (assistant_message, thinking, chat_status, choice 카드) | **금지** (아래 Chat Clear 불변식). 예외 2곳: P1 전환기 rich tail(ask/direct), 마이그레이션 backfill |
| `sessions/feature.jsonl` | LLM 컨텍스트 SSOT | 유일한 소스 |

### feature.jsonl 라인 타입 (6종)

| 타입 | 기록 시점 | 수명 |
|---|---|---|
| `user_turn` | 잡 시작 (submit) | boundary까지. ask/inline-ask는 `ephemeral: true` |
| `user_turn_meta` | triage(intent) / decompose(executionTier) 패치 | user_turn과 동일 |
| `breadcrumb` | 잡 종료 — **파일 산출 흔적** (anchors + noun-form summary) | 반영구 (boundary 생존) |
| `assistant_turn` | 잡 종료 — **대화 흔적** (`finalText` + `digest`) — P2 | boundary까지, recency 강등 |
| `context_summary` | band-2 예산 초과 시 1회 — 체크포인트 (`summary` + `constraintLedger`) — P3 | 최신 것만 유효 |
| `boundary` | Hard Reset만 (`user_reset`; auto boundary는 retired) | 커서 |

**breadcrumb vs assistant_turn 책임 분리**: breadcrumb은 "어떤 파일을 건드렸나"(내비게이션 앵커, 반영구), assistant_turn은 "무슨 대화를 했고 무엇이 결정됐나"(referent 해석, recency 강등). 수명이 다르므로 합치지 않는다.

## 2. 증류 (write path) — 잡 종료 1회

[`core/context/assistantTurn.ts`](../../packages/ant-cli/src/core/context/assistantTurn.ts) `distillAssistantTurn` — breadcrumb과 같은 seam(code/design learn, inline-ask dispatch)에서 호출되나 BC 게이트(explain/touched=0 skip)와 **무관하게** 실행된다 (대화는 파일 안 바꿔도 맥락이다).

- `finalText`: 그 턴의 user-facing 최종 발화 — chat.jsonl에서 `assistant_message`(kind가 system_notice/rendered_payload/thinking_chunk면 제외) + `chat_status[task_response]`를 수확, tail-cap ~800tok. ask는 그래프의 `response`를 직접 사용.
- `digest` (TurnDigest): `decisions[]` / `constraints[]`(유저 워딩 인용 필수) / `outcome` / `openQuestions?`.
  - **choice_resolved 결정론 흡수**: clarify/choice 카드 응답은 이미 구조화되어 디스크에 있으므로 LLM 없이 decisions로 들어간다 (최고 신뢰 소스, 항상 선두).
  - Tier 2+ 만 소형 LLM 콜 1회(`infra/turn-digest/system.md`, 8s timeout); Tier 0/1·ask는 템플릿 추출. 실패 시 템플릿 폴백 — 증류가 learn을 막는 일은 없다.

## 3. 조립 (read path) — 3밴드 Lens

`hydrateFeatureContext` (resolve에서 잡당 1회, triage는 per-turn 재수화) → `FeatureContext`:

| 밴드 | 내용 | 소스 |
|---|---|---|
| **1 Verbatim** | 최근 K 교환: user 원문 + assistant finalText + 그 턴의 BC anchors | `exchanges[]` (user_turn ⋈ assistant_turn ⋈ breadcrumb by turnId) |
| **2 Structured** | 밴드1 밖 턴들의 digest | `digests[]` |
| **3 Compressed** | 롤링 summary + **Constraint Ledger** + (접힌) 옛 BC | `context_summary` 체크포인트 |

밴드 = 라인 타입이 아니라 **recency별 충실도**. 오버플로 캐스케이드: 밴드1 초과 → 디스크의 digest로 강등(LLM 0) → 밴드2 초과 → 체크포인트로 폴드(LLM 1회, 이후 공짜).

- **ephemeral 강등**: ask 턴은 K 트리밍 시 나이 무관 최우선 드롭, 밴드2 진입 금지.
- **마이그레이션 backfill**: assistant_turn 없는 옛 턴은 trailing 6개에 한해 chat.jsonl에서 재구성 (`backfillExchangesFromChat`) — assistant_turn이 쌓이면 0으로 수렴.

### Constraint Ledger — "채팅에서 말한 제약은 조용히 사라지지 않는다"

체크포인트의 `constraintLedger`는 **결정론적 verbatim-carry**: 이전 원장 ∪ 접힌 digest들의 constraints, dedupe만. LLM이 원장을 재작성하지 않으므로 드롭이 구조적으로 불가능하다. supersession은 삭제가 아니라 read-time 규칙("현재 지시가 이긴다")으로 처리. **주입 플로어**: lean 포함 모든 프로파일이 원장을 항상 렌더한다.

## 4. 적응 프로파일 (SSOT: `contextProfileFor(node, tierId)`)

| 프로파일 | 밴드1 | assistant 캡 | 밴드2 |
|---|---|---|---|
| rich | K=6 | 1680 chars (~600tok) | ≤12 digests |
| standard | K=3 | 840 chars | ≤8 |
| lean | K=6 (user만) | 0 (strip) | ≤1 |

| 노드 | 프로파일 | 근거 |
|---|---|---|
| triage / detect | lean | 매 턴 실행 + 마지막 intent가 핵심 신호 (rot 민감) |
| decompose | standard | 잡당 1회; 자기가 tier를 결정하므로 tier 조건 불가 |
| plan | standard (Tier 4는 lean) | Tier 3 잡당 ~22회 수신; Tier 4는 refs가 ground truth |
| direct (Tier 0/1) | rich | 대화형 rim, 1-3 호출 (전환기: P1 chat tail) |
| ask agent | rich | P1 chat tail (`buildChatTail`) — Lens 전환은 후속 |

렌더는 단일 partial [`jobs/shared/injections/context-lens.md`](../../packages/ant-cli/src/core/prompt/templates/jobs/shared/injections/context-lens.md) — Recent Exchanges / Standing Constraints / Prior Exchange Digests.

## 5. Chat Clear vs Hard Reset

| | Chat Clear (빗자루) | Hard Reset (휴지통 2-click) |
|---|---|---|
| 동작 | chat.jsonl collapse (화면만 정리) | feature.jsonl + chat.jsonl 물리 삭제 |
| ANT 기억 | **유지** | **전부 소거** |
| 유저 의도 | "스크롤 정리" | "새 출발 — 누적 맥락이 노이즈" |

**Chat Clear 불변식** (load-bearing): 컨텍스트 파이프라인은 chat.jsonl을 라이브 소싱하지 않는다 — 예외는 4곳으로 고정되며 [`tests/policy/chat-clear-invariant.test.ts`](../../packages/ant-cli/tests/policy/chat-clear-invariant.test.ts)가 강제한다. 따라서 Clear가 ANT의 기억을 건드릴 수 없다.

## 6. triage 소비-상태 판별축 (P1b — green-padding-drake RCA)

design breadcrumb에는 파생 주석 `consumption: 'pending' | 'consumed'`가 붙는다 (이후 code 잡 user_turn 존재 여부로 결정론 계산, 현재 턴 제외). triage rules.md는 실패 보고의 라우팅을 이 상태로 이분한다:

- 최신 같은-표면 스펙 **pending**(미소비) → 보고는 pending 스펙에 합류 (`rev-spec`) — 구현 전이니 "built behaviour"가 그 스펙과 무관하고, 병렬 두 번째 문서는 수동 병합을 강요한다.
- **consumed** → 기존대로 새 remediation (`gen-spec`) — high-ironing-mouse 방향 유지.

워딩락: [`tests/prompt/triage-rev-gen-discriminator.test.ts`](../../packages/ant-cli/tests/prompt/triage-rev-gen-discriminator.test.ts) (양방향).

## 7. 회귀 가드 인벤토리

| 테스트 | 잠그는 것 |
|---|---|
| `tests/parallel/worker-feature-context-propagation.test.ts` | P0 — 워커 sharedContext featureContext 전달 (code+design) |
| `tests/prompt/triage-rev-gen-discriminator.test.ts` | P1b — 소비-상태 축 양방향 + pending 마커 렌더 |
| `tests/context/chat-tail-builder.test.ts` | P1 — rich tail 수확/캡/제외 규칙 |
| `tests/prompt/recent-conversation-injection.test.ts` | P1 — ask/direct 템플릿 렌더 |
| `tests/context/assistant-turn-distill.test.ts` | P2 — 증류(수확/choice 흡수/LLM 폴백/no-throw) |
| `tests/context/lens-projection.test.ts` | P2 — 밴드 조립 + 프로파일 캡 + ephemeral 강등 + II-3 매트릭스 |
| `tests/prompt/context-lens-render.test.ts` | P2/P3 — partial 렌더 + plan 대체 + 원장 플로어 |
| `tests/context/context-summary-checkpoint.test.ts` | P3 — 체크포인트 적용/재사용(LLM 0회)/원장 verbatim-carry |
| `tests/policy/chat-clear-invariant.test.ts` | Chat Clear 불변식 (chat 읽기 4곳 고정) |

## 8. 명시적 스코프 밖

- **in-job 실행 품질 / 모델 생성 충실도** — Lens는 크로스잡 맥락만 담당.
- **멀티탭 (E2-1/E2-2)** — 별도 에픽. 기반만 확보: `assistant_turn`/`context_summary` 스키마의 `scopeId?` 필드.
- **full-job ask 경로** — triage `group==='ask'` → `__end__` 는 답변 없이 끝나는 dead path (routeToAskGraph 미배선, Phase D 미완). 실제 ask 답변은 inline-ask dispatch 채널 유일. 별도 수리 대상.
