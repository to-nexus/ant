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
`ANT_SUBAGENT_MAX_REPORT_CHARS=16000`, `ANT_SUBAGENT_MAX_CONCURRENT=3` per
ownerKey, `ANT_SUBAGENT_TIMEOUT_MS=300000`, `ANT_SUBAGENT_JOIN_TIMEOUT_MS`,
`ANT_SUBAGENT_MAX_PENDING_AGE_MS`, `ANT_SUBAGENT_MAX_TOKENS=8192`; SSOT
[`config.ts`](../../packages/ant-cli/src/agents/common/subagent/config.ts)).

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
  code/design **plan** seal은 join하지 않는다 — 같은 ownerKey로 execute가 이어받아
  드레인/join하므로 태스크 단위 배리어는 유지된다.
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
| 타임아웃 / 라운드 소진 / 절단 | `[partial] …` (`partial`) | |
| 잡 stop | `[partial] aborted` (`aborted`) | `shouldAbort=isJobAborted` 라운드 폴링 + stream signal |
| crash/중단 후 resume | 히스토리의 launch-ack 고아 감지 → `[SUBAGENT REPORT <id> — LOST]` 주입 | 마커가 pairing SSOT(자기멱등). **ack 본문은 마커 리터럴을 포함하면 안 됨** |
| 동시성 초과 | launch 거부 (error tool_result) | |

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
- FE: `SubagentCard`(스피너/state별 터미널, report 있을 때만 클릭) +
  `SubagentReportOverlay`(ChatPanel history 컨테이너 `absolute inset-0`, 기존
  마크다운 파이프라인, Escape/닫기). 오버레이 open 상태는 `chatSlice`
  (`openSubagentReportCardId`) — Virtuoso 가상화로 카드가 unmount돼도 생존.
  `aggregateChatStatuses` FAMILIES에 subagent_* 추가 금지.

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
join-and-chat-status(라우터 플래그/카드 본문). FE:
`packages/ant-ui/tests/chat/subagent*.test.tsx`.
