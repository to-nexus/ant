# Spec-driven 엔지니어링

이 문서는 매니페스토입니다. 왜 Ant이 "vibe coding"을 1급 워크플로로
거부하는지, 대신 무엇을 하는지를 설명합니다.

## Vibe-coding 루프

대부분의 AI 코딩 도구는 같은 루프 위에 서 있습니다:

```
prompt → code → "이게 아니라..." → code' → "여전히 틀려" → code'' → ...
```

스펙은 사용자 머릿속에 있습니다. 에이전트는 마지막 메시지로 그걸
추측합니다. 합의된 산출물은 어디에도 없습니다. 버그는 위반("디자인
시스템 토큰 `spacing.4` 대로 16px gap이어야 하는데 12px") 이 아니라
느낌("레이아웃이 이상해 보여")으로 보고됩니다.

이 방식은 프로토타입, 데모, 토이 프로젝트에선 동작합니다. 진짜
엔지니어링은 못 버팁니다. 만들어내는 것:

- **반복 사이의 drift.** 에이전트는 세 턴 전에 뭘 했는지 잊습니다.
  당신도 잊습니다.
- **검증 부재.** "변경이 뭘 깼나?" 는 코드를 돌려보고 봐야만 답이
  나옵니다. 테스트할 컨트랙트가 없습니다.
- **암묵 지식 병목.** 만들어야 할 것을 아는 유일한 사람은 prompt하는
  본인. 두 번째 엔지니어를 끼우는 순간 다 다시 설명해야 합니다.

vibe-coding 도구로 의미 있는 feature를 ship하려 해본 사람은 이걸
체감합니다. 약 2,000줄 생성된 코드 즈음에 벽에 부딪히고, 그 벽은
구조적 — 더 prompting해도 못 뚫습니다.

## Spec-driven은 이렇게 생겼습니다

Ant의 루프:

```
PRD                  ← planner 에이전트가 작성을 도움
 │
 ▼
시스템 설계           ← architect.design 이 PRD에서 생성
 │
 ▼
코드                 ← architect.code 가 설계대로 구현
 │
 ▼
검증                 ← architect 가 코드를 설계 대비 검증
 │
 ▼  (변경 시 반복)
```

스펙이 **명시적, 영속적, 감사 가능**합니다. 매 잡이 상위 산출물을
구속력 있는 컨텍스트로 읽습니다. 코드 잡이 끝나면 검증 단계가
결과가 스펙과 일치함을 입증합니다. 무언가를 바꾸면 합의된 것을
잃지 않고 delta만 재생성합니다.

구체적으로:

- PRD는 `plan/prd.md` 에 살고 재생성 가능. 수정하면 design과 code에
  파급이 흐름.
- 시스템 설계는 `architecture/system/*.md` + API 컨트랙트
  `architecture/spec/`. 이는 코드 잡이 존중해야 할 *불변 컨트랙트*.
- 코드는 `codebase/`. 변경은 feature task가 만들고 verification task가
  입증.
- 각 단계의 산출물이 다음 단계의 입력. 단계를 빼면 체인이 깨짐 —
  검증가능성을 잃음.

## 이 루프가 주는 것

| Vibe-coding 증상                                                | Spec-driven이 대신 하는 것                                                          |
|-----------------------------------------------------------------|-------------------------------------------------------------------------------------|
| "세 턴 전에 뭘 만들었는지 까먹음."                              | PRD와 시스템 설계가 영속 산출물. 다시 읽으면 됨.                                    |
| "두 번째 사람을 루프에 끼우기 어려움."                          | 그 사람도 같은 산출물을 읽음.                                                        |
| "변경이 뭘 깼는지 모르겠음."                                     | verification task가 typecheck/build/test를 스펙 대비 실행.                           |
| "에이전트가 이미 고친 버그를 자꾸 다시 만듦."                    | verification gate가 회귀를 ship 전에 잡음.                                           |
| "리팩터가 무서움 — 에이전트가 이전 동작을 잊을까 봐."            | 시스템 설계는 리팩터 동안 불변. 구현만 움직임.                                       |
| "토큰이나 디자인 시스템 primitive 생성이 안정적이지 않음."       | 디자인 토큰은 명시적 `design-system` task type, 자체 prompt 가짐.                    |

## 언제 spec-driven이 *아닌* 것이 맞나

Spec-driven 루프가 항상 옳다고 우기면 거짓말입니다.

- **버려질 프로토타입**: 내일 버릴 거면 PRD 단계는 오버헤드. Tier 1
  (OneShot) 한 줄 디렉티브로 ship.
- **작은 diff**: 버튼 색 바꾸는 데 PRD는 필요 없음. Ant은 자동으로
  낮은 tier (Reflex / OneShot / Exploratory) 로 라우팅.
- **순수 탐색**: 뭘 원하는지 아직 모를 땐 vibe coding이 더 빠름.
  결과를 scaffolding으로 보고, 신경 쓰기 시작할 때 스펙으로 다시 적기.

5-tier 실행 모델이 자동으로 적절한 격식 수준을 고릅니다. Spec-driven은
스펙트럼의 *상단*이지 *유일한* 끝이 아닙니다. 풀 매트릭스는 영문
[execution-tiers](../../concepts/execution-tiers.md).

## Ant이 스펙을 강제하는 방법

세 메커니즘:

1. **Resolved Action Context (RAC)** — 매 잡은 명시적 `refs` (권위
   입력) + `context` (구속력 있는 배경) 집합 위에 빌드. LLM에게는
   이름 붙은 슬롯으로 노출되며, 디스크에서 glob-walk 되지 않음.
   "실수로" scope를 넓힐 수 없음.
2. **Verification task** — Tier 3+ 잡은 최소 한 개의 `verification`
   task를 포함. 스펙을 다시 읽고 gate (typecheck, build, smoke) 실행.
   실패한 gate는 violation을 고치는 `error` task를 produce 후 재검증.
3. **State machine, free-form orchestration 아님** — 매 에이전트가
   LangGraph StateGraph로 실행. phase (resolve, triage, decompose,
   plan, execute, check, learn) 가 명시적. 각 phase의 prompt는 그
   역할에 제한.

올바른 산출물이 안 만들어지면 잡은 fail. 그게 핵심.

## 다음으로 읽을 것

- [architecture](architecture.md) — 누가 각 phase를 돌리나.
- [design-input-channels](design-input-channels.md) — 디자인 입력 3채널.
- 영문 [agents](../../concepts/agents.md), [jobs](../../concepts/jobs.md),
  [execution-tiers](../../concepts/execution-tiers.md).
- 영문 [internals/14-code-job.md](../../internals/14-code-job.md) — 코드
  잡 상태 머신 deep dive.
