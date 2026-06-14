# 41. Task Priority & Band System (code job)

> SSOT 코드: [`graph/code/state.ts`](../../packages/ant-cli/src/agents/architect/graph/code/state.ts) (`TASK_PRIORITY` 맵 + 헬퍼), [`state.priorityGuide.ts`](../../packages/ant-cli/src/agents/architect/graph/code/state.priorityGuide.ts) (프롬프트 가이드 렌더).
> 3축 모델의 권위 기술은 `CLAUDE.md` §"Three-Axis Task Modeling SSOT" — 이 문서는 그 위에서 **우선순위 숫자 체계**만 다룬다.

## 3축 복습 (type / band / priority)

task 는 **type + band** 로 정의된다.

| Axis | 관찰자 | 결정 |
|---|---|---|
| `task.type` | LLM | 행동 모드 (feature / error / verification / seam / ui / design-system / test-code / doc / setup / explain) |
| `task.band` | Orchestrator | type 안의 스케줄링 위치 — **feature**(foundation/platform/integration) 와 **setup**(root) 에만 존재 |
| `task.priority` | TaskQueue | 정렬 키 (낮을수록 먼저). **의미 비교 금지** — `TaskQueue.push()` 정렬과 `deriveBandFromPriority` 만 숫자를 읽는다 |

## 우선순위 SSOT — `TASK_PRIORITY` (type → band → window)

평면 상수는 폐기됐다. 단일 정규화 맵이 모든 윈도우 경계를 소유한다 (1차 키 = `TaskType`, 2차 키 = band, `default` = `band===undefined`):

| type | band | window | 예상 fan-out | 배리어 역할 |
|---|---|---|---|---|
| setup | root | 100 | 1 | root-first; `blocksUi/Testgen/Doc` |
| setup | default | 101–189 | 0–N | 동상 |
| design-system | — (TYPE) | 200–219 | 1–~20 | foundation phase (classify=type) |
| feature | foundation | 220–259 | 여럿 | `hasPreFeatureWork` 생성 |
| feature | platform | 260–299 | 0–N (런타임별) | `hasPrePlatformWork` 생성 |
| feature | default | 300–599 | 다수(bulk) | integration gate 생성; foundation+platform 소비 |
| feature | integration | 600–649 | 소수 | integration gate 소비 |
| ui | — | 650–749 | 다수 | preUi 소비 |
| seam | — | 750–799 | ref-모듈당 1 | post-ui 실행 |
| test-code | — | 800–849 | 0–N | preTestgen 소비; `blocksDoc` |
| doc | — | 850–899 | 0–N | preDoc 소비 |
| error | — | 900–999 | 0–N | 반응형 |
| verification | — | 1000 | 1 | terminal gate |

윈도우는 연속·비중첩이며 회귀 가드 [`tests/policy/priority-constants.test.ts`](../../packages/ant-cli/tests/policy/priority-constants.test.ts) 가 단조성·`min≤max`·lane-offset 안전을 잠근다.

### 공개 헬퍼 (phase 코드는 숫자 직접 접근 금지 — 헬퍼만)

- `windowFor(type, band?) → {min,max}` — band 없으면 type `default`. 미상/`explain` 타입은 ordinary feature 윈도우로 폴백.
- `basePriorityFor(type, band?) → number` — 윈도우 base. **누락 priority 의 type별 기본값** (옛 단일 magic number 대체).
- `deriveBandFromPriority(priority) → TaskBand | undefined` — `TASK_PRIORITY` 맵 **역조회**. priority→band 변환의 **유일한 phase 사이트** ([`decompose/responseParser.ts`](../../packages/ant-cli/src/agents/architect/graph/code/nodes/decompose/responseParser.ts)).
- `VERIFICATION_PRIORITY` — verification 단일점(1000), 맵에서 파생.

### 엄격 파생 (의도된 동작)

design-system `[200,219]` 와 feature.foundation `[220,259]` 는 **별개 윈도우**다. `deriveBandFromPriority` 는 `[220,259]` 만 foundation 으로 파생한다 (엄격). design-system 은 TYPE 이므로 band 파생이 호출되지 않으며, 윈도우 안의 stray feature priority 는 `undefined`(ordinary)로 안전 강등된다.

### lane-mode offset 불변식

batchSplit lane-mode child priority = `parentPriority + offset` (부모는 윈도우 base 에서 emit, slice 가 위로 쌓임). `MAX_LANE_OFFSET = 39` 는 **가장 좁은 lane-fanning 윈도우**(feature foundation/platform, `max-min=39`)에 맞춰진 상한이며, [`batchSplit/process.ts`](../../packages/ant-cli/src/agents/architect/graph/code/tasks/_shared/batchSplit/process.ts) 가 offset 을 이 값으로 clamp 해 child 가 윈도우를 넘지 못하게 한다.

## 프롬프트 단일 소스 — `renderPriorityBandGuide()`

band 표는 손으로 베끼지 않는다. `renderPriorityBandGuide()` 가 `TASK_PRIORITY` 를 순회해 LLM-facing 표를 렌더하고, `decompose/variants/default/base.md` 가 `{{{priorityBandGuide}}}` 로 주입한다. 같은 함수를 회귀 테스트가 소비하므로 숫자가 drift 할 수 없다.

## 우선순위 권위 — code-job 단일 권위자

모든 code intent(`gen-code-sys` / `gen-code-spec` / `gen-code-directive` / `rev-code`)는 **동일 canonical band** 를 쓴다. 옛 `gen-code-spec` 자유-우선순위 특례(`isPriorityFromSpec`)는 제거됐다.

소스 문서(스펙/시스템 설계/directive)의 작업 순서는 **band 내부 상대 우선순위의 참고**일 뿐이다. band 배치는 의존성 분류를 따른다 — 공통/기반은 소스의 어느 위치든 foundation·platform 으로 추출해 앞단에, feature/ui/error 는 각자 band 에. 소스의 t1…tn 을 priority 숫자에 1:1 복사하지 않는다.

## design-job doc 우선순위는 별개 축

design job 은 모든 task 를 `type:'doc'` 로 emit 하고 우선순위 band(tokens 100–199 / assets 200–299 / spec 300+)로 스케줄링을 구분한다. 이 축은 code-job `TASK_PRIORITY` 와 **직교**하며 [`tasks/doc/hooks/scheduling.ts`](../../packages/ant-cli/src/agents/architect/graph/code/tasks/doc/hooks/scheduling.ts) 의 `DESIGN_DOC_BANDS` 가 SSOT 다. 둘을 통합하지 말 것.

## 관련 문서

- `CLAUDE.md` §"Three-Axis Task Modeling SSOT" — 권위 사양 + enforcement
- [`NODE_GRAPH_LAYOUT.md`](NODE_GRAPH_LAYOUT.md) §R1 — phase 코드의 priority 의미 비교 격리
- [`11-agent-architecture.md`](11-agent-architecture.md) — TaskOrchestrator / 배리어 메커니즘
