# 43 — Explore Subagent Pipeline

> Origin: local-caring-board RCA Track 2 (2026-07-15). A flat execute conversation
> carrying both evidence-gathering and authoring burned its recursion budget in a
> re-verification loop. The structural fix: parents delegate read-heavy
> investigation to async, in-process, read-only child LLMs and receive distilled
> reports.

## Surface

`explore(goal, hints?)` is an always-on tool in every job with a tool loop:

| Job | Parent phases | Child tool set (`TOOL_SETS.subagent*`) |
|---|---|---|
| code | plan / execute / decompose-inline / direct | `read_file, list_files, search_code, read_state` |
| design | plan / execute | `read_file, list_files, search_code, read_source_doc` |
| plan (planner) | plan / execute | `read_file, list_files, search_code` |
| ask | agent | ant-source + workspace readers |

detect / learn / visual are excluded (no tool loops / no delegation value).
There is **no enable flag** — only env tunables (`ANT_SUBAGENT_MAX_ROUNDS=12`,
`ANT_SUBAGENT_MAX_REPORT_CHARS=16000` (inline interface budget),
`ANT_SUBAGENT_MAX_REPORT_PERSIST_CHARS=100000` (card/drill-down ceiling),
`ANT_SUBAGENT_MAX_CONCURRENT=3` per
ownerKey, `ANT_SUBAGENT_TIMEOUT_MS=300000`, `ANT_SUBAGENT_JOIN_TIMEOUT_MS`,
`ANT_SUBAGENT_MAX_PENDING_AGE_MS`, `ANT_SUBAGENT_MAX_TOKENS=8192`,
`ANT_SUBAGENT_REASK_MAX_TOKENS=4096`; SSOT
[`config.ts`](../../packages/ant-cli/src/agents/common/subagent/config.ts)).

## Report compaction / decompaction

`ANT_SUBAGENT_MAX_REPORT_CHARS` 는 자식의 탐색 예산이 아니라 **부모-자식
인터페이스 크기**다 (리포트는 부모 tool_result 에 잔류해 이후 매 라운드
재과금). 3단 체계:

1. **자식 self-bound (주 메커니즘)** — `explore-system.md` 가
   `{{reportBudgetChars}}` 로 수치 예산을 고지, 자식이 스스로 압축.
2. **compaction (안전망)** — 초과 시 blind-cut 이 아니라
   [`compactReport.ts`](../../packages/ant-cli/src/agents/common/subagent/compactReport.ts):
   리드(lead-with-answer) + **전문 전체의 헤딩 아웃라인(char offset 포함)** +
   드릴다운 고지. 헤딩 <2 이면 head+tail 폴백. compaction 은 회복 가능한 전달
   압축이므로 `[partial]`/`state:'partial'` 을 만들지 **않는다** (partial 은
   라운드 소진/타임아웃 전용).
3. **decompaction** — 전문은
   [`reportStore.ts`](../../packages/ant-cli/src/agents/common/subagent/reportStore.ts)
   (프로세스-로컬, FIFO 30, registry 독트린 동일 — resume 시 소실은 graceful
   miss) 에 보존되고, 부모는 **`subagent_report(id, offset?, maxChars?)`**
   도구(모든 explore 노출 preset 에 동반, 자식 셋에는 미포함)로 섹션 점프 또는
   순차 페이징해 전문을 완독. 채팅 카드 metadata 는 전문을 영속해 인간
   드릴다운(오버레이)도 무손실.

## Async pipeline (SSOT: `agents/common/subagent/`)

```
parent tool_use: explore ─▶ handlers/explore.ts ─▶ seam.launch() → launch-ack (즉시)
                                      │ registry entry {promise, ownerKey, delivered}
                                      ▼
                    SubagentRunner (callLLMWithToolLoop 재사용, silentChatCards,
                    자체 maxRounds/timeout, never-throw → error-shaped report)
                                      │ settle {report, usage, modelId}
        ┌─────────────────────────────┘
        ▼ DRAIN — 매 툴 라운드 경계
  createToolNode (공장 레벨, 5개 툴노드 루프 공통) 또는
  callLLMWithToolLoop.betweenRounds (decompose) / direct 루프 인라인:
  tool_result user 메시지에 "[SUBAGENT REPORT <id>]" 블록 append
  + foldSubagentUsage → 명시 채널 delta (unreturned-channel-drop 클래스 방어)
        ▼ JOIN — phase 종료 배리어
  부모가 최종응답(<done>/seal)을 내려는데 pending 존재 → done 보류,
  joinAll(타임아웃) await → 리포트 주입 → 같은 노드 재진입 (1 super-step)
```

- **ownerKey** = `${jobId}:${workerScopeKey}` (`worker-N#task-K#pC` | `_main_`) —
  병렬 태스크 워커 간 격리. 태스크 완료 시 `checkTaskStatus`(serial+worker,
  code+design)가 `clearOwner`로 잔존 entry를 drop (serial `_main_` 공유로 인한
  cross-task 오배송 차단).
- **Join 사이트**: code execute done 분기(라우터 무변경 — no-tools+no-done 재진입
  규칙 재사용), design execute done 분기(drainFinalize보다 선행), planner execute
  finalization(`_subagentJoinRedo` 채널 + 라우터 self 엣지), ask agent
  finalization(동일 패턴), decompose `beforeFinalReturn`, direct 루프 인라인.
- **plan seal의 리포트 처리 (sage-causing-rover C1/C2)**:
  - design plan **seal 시점**: `drainSettledReportsAtSeal` — **settled** 리포트만
    non-blocking 수거(`collectCompleted`, `joinAll` 미사용) 후 plan LLM을 in-node
    1회 재구동해 findings 반영/재-seal. **pending** 자식은 대기하지 않고 같은
    ownerKey로 execute가 이어받는다(기존 계약 유지). code plan seal은 종전대로
    join하지 않는다.
  - design plan **fallthrough**(no `<plan>`, no toolCalls): `joinOwedReportsIntoHistory`
    가 joined history를 반환하고 plan 노드가 **같은 노드 호출 안에서** 루프를
    재구동한다(code twin 패리티). 옛 delta-반환은 `routeAfterPlan`이 tool 노드가
    클리어한 `toolCalls: []`를 보고 execute로 오라우팅해 — `collectCompleted`가
    이미 registry entry를 삭제한 뒤라 — 주입된 NODE_PLAN을 영영 읽지 않는
    수집-후-폐기 결함이었다.
- **cycleSeq 표류 sweep (C3)**: 태스크 transient 재진입은 `cycleSeq` INCR로
  ownerKey를 바꾼다. `TaskWorker`가 픽업 시 `clearOwnerByTaskPrefix`로 이전
  cycle 의 잔존 entry를 sweep — 고아 ack는 페어링 스캔이 LOST 1회로 수렴시킨다.
- **수용된 트레이드오프 (C4)**: execute가 breaker 경로(무응답·recursion drain·
  no-output)로 checkTaskStatus에 도달하면 join 없이 `clearOwner`가 entry를
  drop한다(`⚠️ Dropped N undelivered` 로그 지문). 비정상 종료 경로에서 리포트는
  stale이므로 의도된 동작.
- **Depth-1**: 자식 도구목록에 explore 부재(1차) + seam이 childCtx에서
  `subagent: undefined` strip(2차). 자식은 chat 완전 침묵(noop reporter +
  `silentChatCards`).
- **RAC**: code 자식 read는 부모와 동일한 `computeRacScope`+`decideRacGate`
  클로저를 통과 — RAC read 게이트 2-site(decompose 인라인 + code tool 노드)
  대칭 불변 유지.

## Failure semantics (runner never throws)

| 모드 | 리포트 | 비고 |
|---|---|---|
| LLM/툴 에러 | `Exploration failed: … re-issue or read directly` (`error`) | 부모 LLM이 복구 결정 |
| 타임아웃 / 라운드 소진 | `[partial] …` (`partial`) | 절단은 여기 속하지 않음 — 위 compaction 섹션 (`done` 유지) |
| **퇴화 (반복 루프)** | 3단 방어: (1) 최종 라운드가 tools 유지 + `toolChoice:'none'` (strip 금지 — 선언 삭제가 GLM 퇴화 생성원인, sage-causing-rover RCA), (2) in-stream 반복 브레이커(`StreamRepetitionTracker`, `core/utils/textRepetition.ts`)가 라운드를 조기 절단(토큰캡 대신 ~수백 토큰), (3) **1회 교정 재요청** — 축적 증거(`finalMessages`) 위에 교정노트 + `toolChoice:'none'` + 축소캡(`ANT_SUBAGENT_REASK_MAX_TOKENS`=4096), 단일 deadline(`subagentTimeoutMs`) 안. 성공 시 `[partial]`(비전수 명시), 재퇴화 시 실패고지(`error`) + 원문은 store/카드 보존 | 재요청은 verbatim 재시도가 아니라 실패 사유를 명시(lapis-oaring-drain 교훈) |
| 잡 stop | `[partial] aborted` (`aborted`) | `shouldAbort=isJobAborted` 라운드 폴링 + stream signal |
| crash/중단 후 resume | 히스토리의 launch-ack 고아 감지 → `[SUBAGENT REPORT <id> — LOST]` 주입 | 마커가 pairing SSOT(자기멱등). **ack 본문은 마커 리터럴을 포함하면 안 됨** |
| 동시성 초과 | launch 거부 (error tool_result) | |

### 전달 계측 — `subagent_drain` (sage-causing-rover 2차 정황)

모든 전달 seam(`createToolNode` 드레인 / `maybeJoinSubagents` join / design plan
seal-drain)이 `log-{jobId}.json`에 `subagent_drain` 이벤트를 기록한다
(`drainTrace.ts`): `{site, ownerKey, deliveredIds, deliveredStates,
orphanCount, pendingCount, phase}`. 리포트 미전달 재발 시 세션 번들만으로 기전
판별이 가능하다. 콘솔 로그 지문과의 대응:

| 콘솔 지문 | site |
|---|---|
| `📨 [Tool] Drained N subagent report(s)` | `tool-drain` |
| `🔀 [Subagent] Join delivered N report(s)` | `join` |
| `🔀 [DesignPlan] N subagent report(s) settled at seal time` | `seal-drain` |
| `⚠️ [checkTaskStatus] Dropped N undelivered …` | (C4 drop — 이벤트 없음) |

`subagent_report` 도구는 이제 **모든** non-empty 리포트를 store에 보존하며
(FIFO 30이 누수 가드), 미스 메시지는 원인을 단정하지 않는다("아직 실행 중일 수
있음" 포함 — 옛 "이미 완결됐다" 단정이 sage에서 부모를 오도했다).

Registry(`registry.ts`)는 promise 핸들을 담는 **단일 프로세스 런타임 상태**로,
Redis SSOT 미러가 아니다(jobAbort.ts와 동급 — Unified Distributed System 원칙
무관). 체크포인트 스키마 무변경: 내구 프로토콜은 대화 내 ack↔marker 페어링이다.

## Tokens / billing / model

- 자식 usage는 registry entry에 buffer만 — **드레인/join 사이트(노드 컨텍스트)**
  에서 `accumulateTokenUsage({modelId})`로 fold 후 명시 채널 delta 반환.
  `currentPhaseTokenUsage`(부모 컨텍스트 게이지)는 의도적으로 미기록 — 자식은
  별도 대화라 링에 합산하면 왜곡. 워커 링(`sub-N`)은 미도입(사용자 확정).
- 자식 모델: `createLLMClient(_, _, {jobType, nodeType:'subagent'})` —
  `llmModels[job].subagent ?? llmModels[job].default` (BE-only 슬롯, 피커 미노출).

## Chat / UI contract

- `ChatStatusType`: `subagent_running`(progress — pending-card 채널, 새로고침
  내성 스피너) + `subagent_report`(터미널 — **리포트 본문을 metadata로 영속**,
  plan 카드와 동일 패턴). `LLMResponseService.PROGRESS_STATUS_TYPES` +
  `TOOLS_WITH_DEDICATED_STATUS('explore')` 등록.
- Emit: `ChatAPIClient.subagentStart/Progress/Complete` — launch 카드 1장에
  cardId fold. 자식 내부 툴콜 카드는 없다.
- FE: `SubagentCard`(스피너/state별 터미널, report 있을 때만 클릭) → 클릭 시
  `openReportEditorTab`(uiSlice)이 메인패널 **에디터 탭**을 민팅한다:
  `editor:report:{cardId}`(`makeReportEditorTabId`), `kind:'virtual'` /
  `readOnly:true` / `status:'ready'`(스트리밍 퍼지 면제) / `source:'report'`,
  본문은 `tab.content`. 렌더는 plan/design 프리뷰와 공유하는
  `VirtualDocumentViewer`(마크다운 파이프라인). 별도 오버레이 컴포넌트나
  `chatSlice` open 플래그는 없다 — 탭 배열이 유일한 상태.
  `aggregateChatStatuses` FAMILIES에 subagent_* 추가 금지.
- 탭 액션 정책은 `getEditorTabActionPolicy` 단일 소스. **핀/언핀은 real 탭 전용**
  (path-keyed 전용 슬롯 ↔ 공유 프리뷰 슬롯 마이그레이션이므로 두 스토어 액션이
  `kind !== 'real'`로 가드). virtual 탭의 `pinned:true`는 "프리뷰 슬롯 아님"
  마커일 뿐이라 핀 토글을 노출하지 않으며, 닫기를 억제해서도 안 된다
  (스트리밍 중인 virtual 탭만 예외 — 버퍼 싱크가 재생성/재포커스한다).
- 라이프사이클: 피처/프로젝트 전환은 `applyIdentityTransition`이 `editorTabs`를
  비운다. 채팅 클리어/하드리셋(`events_cleared`)은 백킹 카드가 사라지므로
  virtual 탭을 전부 닫는다 (real 파일 탭은 chat-backed 아니므로 보존).

## Prompt SSOT

- 위임 전략: [`jobs/shared/injections/explore-delegation.md`](../../packages/ant-cli/src/core/prompt/templates/jobs/shared/injections/explore-delegation.md)
  — 단일 partial, explore가 노출되는 19개 노드 템플릿에서 `{{> }}` include
  (resolver 미경유 — 결정적 배선).
- 자식 시스템: [`jobs/shared/subagent/explore-system.md`](../../packages/ant-cli/src/core/prompt/templates/jobs/shared/subagent/explore-system.md).

## Regression guards

`packages/ant-cli/tests/subagent/` — registry(격리/이중드레인/상한/joinAll),
runner(never-throw/partial/절단), explore-handler + 카탈로그 핀(depth-1,
read-only 자식셋, 4잡 노출), drain-and-orphan(마커 페어링/자기멱등/**ack에 마커
리터럴 금지**), drain-toolnode(리포트 위치/hookUpdates-무시 buildReturn에서도
토큰 delta 생존), token-fold(per-model 귀속/미선언 채널 가드/게이지 무접촉),
tool-loop-options(drain/join 훅/abort/bounded extension),
join-and-chat-status(라우터 플래그/카드 본문),
tool-loop-final-round(최종 라운드 tools 유지 + `toolChoice:'none'` + in-stream
브레이커), runner-reask(교정 재요청 1회 한정/재퇴화 폴백),
design-plan-join(C1 in-node 소비/C2 non-blocking seal-drain/C3 prefix sweep).
어댑터 매핑: `tests/llm/tool-choice-and-stop.test.ts` (3사 tool_choice + OpenAI
`stop`), 브레이커 휴리스틱: `tests/utils/textRepetition.test.ts`. FE:
`packages/ant-ui/tests/chat/subagent*.test.tsx`.
