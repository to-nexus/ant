# Multi-Agent Architecture

> 복수의 전문화된 에이전트가 협업하여 소프트웨어 개발 라이프사이클을 담당하는 아키텍처

---

## 1. 개요

### 1.1 배경

ANT는 기존에 `architect` 에이전트 하나로 설계(design), 구현(code), 학습(learn)을 처리했다. 그러나 PRD 작성 같은 기획 단계 작업은 아키텍트의 역할이 아니며, 대상 사용자(기획자, PM)도 다르다. 이를 위해 멀티 에이전트 체계를 도입한다.

### 1.2 에이전트 역할 정의

| Agent | 인간 역할 | 워크플로우 단계 | 대상 사용자 | 핵심 산출물 |
|-------|----------|---------------|-----------|-----------|
| **planner** | PM, 기획자 | 기획 (pre-dev) | 비개발자 | PRD |
| **architect** | 개발자, 아키텍트 | 설계 + 구현 | 개발자 | 설계문서, 소스코드 |
| **reviewer** | 시니어 개발자, QA | 검토 | 개발자 | 리뷰 피드백 |
| **doc** | 테크니컬 라이터 | 문서화 (post-dev) | 개발자 | API 문서, 마이그레이션 가이드 |

### 1.3 워크플로우

```
planner ──(PRD 생산)──> architect ──(설계, 코드)──> reviewer
                          ↑                           │
                          └────(피드백)────────────────┘
                          │
                          └──(코드 변경)──> doc
```

- **planner**는 architect의 입력(`inputs/sources/prd.md`)을 생산하는 역할
- **architect**는 planner의 산출물을 소비하여 설계 및 구현 수행
- **reviewer**, **doc**은 향후 구현 예정

---

## 2. Planner Agent 설계

### 2.1 PRD-as-State 패턴

Planner는 ANT 시스템의 "job 종료 시 맥락 소실" 제약을 PRD 파일 자체를 누적 상태로 활용하는 방식으로 해결한다.

```
Job 1: "쇼핑몰 만들어줘"
  resolve(PRD 없음) → generate(PRD v1) → write(inputs/sources/prd.md)

Job 2: "결제에 포인트 추가해"
  resolve(PRD v1 읽기) → generate(v1 + directive → v2) → write(덮어쓰기)

Job 3: "평가 반영해서 개선해"
  resolve(PRD v2 + eval 읽기) → generate(v2 + eval → v3) → write(덮어쓰기)
```

**핵심 원리:**
- 이전 job의 결과는 이미 PRD에 반영되어 있으므로, job 간 대화 맥락 전달이 불필요
- 경량 맥락(최근 2-3턴 요약)으로 "아까 말한 것" 같은 모호한 참조를 보조

### 2.2 Staging + Choice Card 방식

Planner는 PRD를 `outputs/plan/prd-refine.md`에 먼저 저장(staging)한 후, 사용자에게 `inputs/sources/prd.md`로 적용할지를 choice card로 확인한다.

- **Staging path**: `outputs/plan/prd-refine.md` (임시)
- **Final path**: `inputs/sources/prd.md` (사용자 승인 후 덮어쓰기)
- **근거**: `inputs/` 직접 수정은 위험하므로, 사용자 확인 후 적용하는 방식으로 변경

### 2.3 Architect와의 차이

| 측면 | Architect | Planner |
|------|-----------|---------|
| 산출물 | 복수 파일 | 단일 파일 (prd.md) |
| 태스크 분해 | 필요 (여러 챕터/파일) | 불필요 |
| 중단/재개 | Task-level resume (태스크 큐에서 이어가기) | Job-level retry (전체 재실행) |
| 병렬 실행 | 필요 (멀티 태스크) | 불필요 |
| 도구 사용 | code tool (파일 읽기/쓰기, 검색) | workspace 읽기 + web search |
| 세션 상태 | taskQueue, completedTasks, planText... | directive + jobId만 저장 |
| Graph 노드 수 | 10+ | 4 |

### 2.4 Graph 구조

```
__start__ → resolve → triage → generate ⟷ tool → __end__
                        │
                        ├─(ask)────→ __end__  (평가 등 ask 처리)
                        ├─(redirect)→ __end__  (에이전트 전환 제안)
                        └─(blocked)─→ __end__  (전제조건 미충족)
```

- **resolve**: 기존 PRD + eval report + rubric + 최근 턴 이력 로드. `ant:template` 마커 스마트 감지 (200자 미만 실질 콘텐츠만 템플릿으로 간주). eval/rubric은 참조용으로 로드되며 적용 여부는 LLM이 사용자 지시에 따라 판단.
- **triage**: 공유 triage 노드 재사용 (ask/redirect/blocked/proceed 라우팅)
- **generate**: ReAct agent + StreamOrchestrator. Design job의 docGen과 동일한 패턴: LLM이 `<file>` 태그로 PRD를 출력 → 실시간 파일 카드 스트리밍 → 디스크 저장 → choice card → 세션 기록. 별도 write 노드 없음.
- **tool**: 도구 실행 후 generate로 복귀 (ReAct 루프). 사용 가능 도구: `read_workspace_file`, `list_workspace_files`, `search_web`

### 2.5 확장성

Planner 에이전트는 PRD 전용이 아닌, 기획 단계 전반을 담당하도록 설계:
- 프롬프트: `templates/planner/prd/` 하위에 분리하여 향후 `stories/`, `sprint/` 등 추가 가능
- 변수명: `existingDocument`, `Document Type` 등 범용화
- YAML 기반 job 정의: `prd.yaml`과 동일 패턴으로 새 job 추가 가능

---

## 3. 세션 관리

### 3.1 Agent-Nested 세션 경로

기존 flat 구조(`sessions/design.json`)에서 agent-nested 구조로 전환한다.

```
sessions/
  architect/
    design.json
    code.json
    learn.json
    debug/
      prompts/
      plans/
      logs/
      asks/
  planner/
    plan.json
    debug/
  chat.json              ← UI 레벨, agent 무관
```

**설계 결정:**
- Agent별 디렉토리로 세션 파일을 격리하여, 향후 에이전트 추가 시 충돌 없음
- `chat.json`은 에이전트와 무관한 UI 레벨 개념이므로 `sessions/` 루트에 유지
- `FileSessionAdapter` 생성 시 `agent` 파라미터를 주입하여, 호출부 변경 최소화

### 3.2 Planner의 세션 사용

Planner는 세션을 두 가지 목적으로 사용한다:

1. **경량 맥락**: 최근 2-3턴 요약을 LLM 프롬프트에 주입 (모호한 참조 해석)
2. **중단/재개**: directive + jobId를 저장하여 resume 시 전체 재실행 가능

Task queue, completedTasks 등 architect 고유의 세션 상태 필드는 사용하지 않는다.

### 3.3 타입 체계

```
JobType = 'code' | 'design' | 'learn' | 'ask' | 'plan'
DecomposableJobType = 'code' | 'design' | 'learn'       ← Architect 전용 (Kanban, task)
SessionableJobType = DecomposableJobType | 'plan'        ← 세션 파일을 가지는 모든 job
```

---

## 4. 중단/재개

### 4.1 공통 인프라 재사용

중단 감지(JobExecutionManager), 정리(JobCleanupManager), Choice Card(ChoiceCard.tsx)는 에이전트에 종속되지 않는 공통 인프라다. 모든 에이전트가 동일한 방식으로 중단/재개를 지원한다.

### 4.2 에이전트별 Resume 전략

| 항목 | Architect | Planner |
|------|-----------|---------|
| 저장해야 할 것 | taskQueue, completedTasks, planText, conversationHistory... | directive + jobId |
| Resume 동작 | 남은 task부터 재개 (task-level) | 전체 재실행 (job-level) |
| 중간 진행 보존 | 완료된 task 보존 | 없음 (단일 작업이므로 전부 or 무) |
| ReAct 도구 호출 | N/A (codeGen에서 별도 처리) | 저장 안 함, 재실행 시 재호출 |

### 4.3 Resume 흐름

1. 중단 발생 → JobCleanupManager가 interruption 정보를 세션에 저장 + choice card 전송
2. 사용자가 Resume 클릭 → resume endpoint가 세션에서 interrupted job 검색
3. 검색 범위: `sessions/{agent}/{job}.json` (모든 agent/job 조합)
4. `getAgentForJob(jobType)` 매핑으로 올바른 에이전트 라우팅
5. 에이전트별 runner가 `isResume` 플래그를 설정하여 적절한 진입점으로 이동

---

## 5. Triage 라우팅

### 5.1 에이전트 감지

Triage 시스템은 사용자 요청에서 적절한 agent + job을 감지한다.

| 요청 패턴 | Agent | Job |
|-----------|-------|-----|
| "PRD 만들어줘", "요구사항 정리해줘" | planner | prd (generate) |
| "결제 기능 추가해줘" (기존 PRD 있을 때) | planner | prd (refine) |
| "시스템 설계해줘" | architect | design |
| "코드 짜줘" | architect | code |
| "PRD 평가해줘" | ask | - |

### 5.2 YAML 기반 Job 정의

각 job은 YAML 파일로 정의되어 loader가 동적으로 로드한다. Planner의 `prd.yaml`은 generate/refine 두 모드를 가지며, PRD 파일 존재 여부로 모드를 자동 감지한다.

---

## 6. UI 통합

### 6.1 Chat UI 렌더링

Planner는 architect와 동일한 ChatAPIClient 파이프라인을 사용한다:
- **파일 쓰기만** (일반 텍스트 스트리밍 없음): `startFileCreation()` → `streamFileContent()` → `completeFileCreation()`
- PRD 생성 중 thinking 이벤트와 도구 호출 reasoning만 채팅에 표시
- 최종 PRD 문서는 파일 카드로만 렌더링 — 텍스트 스트리밍과 파일 쓰기 중복 방지

### 6.2 Kanban / Workflow

- **Kanban**: 유니버설 규칙 유지. `setEstimatingActivity`로 노드 진행 상태("PRD 생성 중" 등) 표시. 태스크 분해가 없으므로 태스크 영역은 비어 있음.
- **Workflow**: `enterNode`/`exitNode`으로 노드 활성 상태 전송. SSE 라우트/KanbanService/BroadcasterOptions가 `plan` job type을 지원하도록 타입 확장.

### 6.3 Agent Routing

UI의 `runJob(agent, jobType)` 호출에서 `agent`를 동적으로 결정한다. Triage choice card의 `suggestedAgent` 필드 사용. 기존 `'architect'` 하드코딩을 제거.

---

## 7. Template Marker 감지 개선

### 7.1 문제

`ant:template` 마커는 feature 초기화 시 빈 입력 파일(prd.md, directive.md)에 삽입된다. 기존 로직은 `content.includes('ant:template')`로 판단하여, 파일 어디에든 마커가 있으면 전체를 "빈 템플릿"으로 취급했다.

이로 인해 실제 PRD를 작성한 후에도 하단에 마커가 남아있으면:
- `hasPrd: false`로 보고 (triage의 workspaceAnalyzer)
- PRD를 못 찾는 것으로 판단 (planner의 resolveNode)
- Design job 시작 시 에러 throw (architect의 design resolve)

### 7.2 해결

HTML 주석을 모두 제거한 후 남은 실질 콘텐츠 길이로 판단:
- **200자 미만**: 진짜 템플릿 (마커만 있는 빈 파일)
- **200자 이상**: 실제 문서 + 잔존 마커 → 마커만 strip하고 문서로 사용

적용 범위:
- `workspaceAnalyzer.ts`: `isTemplateContent()` 함수
- `planner/resolve.ts`: PRD 로드 로직
- `architect/design/resolve.ts`: PRD 유효성 검증
- `ArtifactService.ts`: `normalizeUserDoc()` 메서드

---

## 8. 관련 문서

- [04-triage-system.md](04-triage-system.md): Triage 분류 체계 및 라우팅 상세
- [11-code-job-flow.md](11-code-job-flow.md): Architect code job 흐름
- [12-design-job-flow.md](12-design-job-flow.md): Architect design job 흐름
- [14-parallel-task-execution.md](14-parallel-task-execution.md): Architect parallel task 실행
