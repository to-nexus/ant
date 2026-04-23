# Codebase Meta Document Policy

> 작성 목적: ant 가 워크스페이스 파일 시스템에서 관찰·생성하는 메타 문서의 경계를 정의한다. 컨벤션 / 런타임 산출물 / 에이전트 세션 상태가 같은 트리에 섞이면서 발생했던 파편화 (ex. "export style convention 을 `outputs/design/system/` 아티팩트로 기록하려는 초안") 를 구조적으로 막는다.

## 1. 3층 분리 원칙

피쳐 워크스페이스는 세 개의 최상위 디렉토리만 가진다. 이 셋은 **상호 배타적** 이며, 각 파일은 정확히 하나의 층에 속해야 한다.

| 디렉토리 | 성격 | 수명 | 읽는 주체 | 쓰는 주체 |
|---|---|---|---|---|
| `codebase/` | 코드 + 코드의 메타 문서. git 추적. | 영속 | 사람 개발자 + ant 에이전트 | 코드 생성 태스크 (setup / feature / integration / ...) |
| `outputs/` | 디자인·생성 **산출물**. RAC 에서 참조. | 영속 (세션 간) | ant 에이전트 (프롬프트 주입 경유) | design / planner / 관련 태스크 |
| `sessions/` | 에이전트 **런타임 / 디버그 상태**. | 일시적 (한 job 또는 resume window) | ant 에이전트 (자율 조회) + 사람 (디버그) | 그래프 런타임 / 디버그 로거 |

### 왜 3층 인가

- **코드 vs 산출물 구분**: `outputs/` 는 프롬프트 · 스펙 · 토큰 등 "무엇을 만들지" 를 기술. 실제 소스는 `codebase/` 에만. 컨벤션처럼 "파일을 만들 때 어떻게" 는 코드 작성 규칙이므로 `codebase/` 소속.
- **코드 vs 세션 구분**: `sessions/` 는 재시작·디버그용. 컨벤션을 여기에 두면 세션이 바뀔 때마다 사라짐.
- **산출물 vs 세션 구분**: `outputs/` 는 "완성된 문서", `sessions/` 는 "진행 중 상태". 후자는 실패하면 덮어써도 되지만 전자는 축적된다.

경계가 흐려지면 파편화 리스크가 생긴다. **새 파일을 추가할 때 반드시 위 표에서 1개 층을 지정** 하고 `codebase/` 에 속하면 아래 §2 정책을 따른다.

## 2. `codebase/ANTRULES.md` — ant 에이전트 설정 SSOT (live document)

### 정체성

- **ant 에이전트가 이 코드베이스에서 새 파일을 생성하거나 수정할 때 따라야 하는 cross-task 불변성** 을 기록하는 live document.
- `README.md` / `ARCHITECTURE.md` / `RUNBOOK.md` 와는 **목적이 다르다**. 이들은 사람 중심 문서 (프로젝트 개요, 모듈 경계, 런 방법). ANTRULES.md 는 에이전트 행동 규칙. 두 축은 독립으로 공존한다.
- Cursor / Claude Code / OpenAI Codex 생태계에서 `AGENTS.md` / `CLAUDE.md` 가 하는 역할과 유사. 이름은 ant 의 identity 를 반영해 `ANTRULES.md`.

### 설계 원칙 — append/modify 를 모두 허용하는 live document

이 파일은 "setup 이 예측해서 찍는 선제적 skeleton" 이 아니라 **"작업 중에 발견된 cross-task 불변성을 누적·반영하는 살아있는 기록"** 이다. 초기에 작성된 규칙이 실제 작업에서 틀린 것으로 드러나면 덮어써서 최신 상태를 유지한다.

실제로 유용한 기록 범주 (예시, 엄격한 enum 아님):

- **Export style** — default vs named (병렬 태스크 drift 의 1차 원인)
- **File naming** — kebab-case / camelCase / PascalCase 규칙
- **Library version compatibility** — 테스트 러너 · 주요 의존성의 호환성 제약 (e.g. "zustand v4 ≠ React 18 breaking change — use v5")
- **Decided test runner** — test-code 태스크가 실제 설치·검증 후 선택한 러너
- **Import conventions** — React import 스타일, path alias 규약
- **Environment variable naming** — `VITE_*` / `NEXT_PUBLIC_*` / 프로젝트 prefix
- **Anti-patterns to avoid** — 검증에서 발견된 "이 패턴은 v3 API 와 충돌하니 쓰지 말 것"
- **Lint rule status** — 해제/활성 상태와 이유

### 위치

- `codebase/ANTRULES.md` (루트 평탄 파일). 하위 디렉토리 / 숨김 디렉토리 사용 금지 — 사람 개발자가 저장소 루트에서 곧장 인지해야 하므로.

### 크기 제약

- 권장 상한: **1500자**. 초과 시 ant 파이프라인이 truncate + 경고 로깅.
- 근거: 매 plan / execute 프롬프트에 자동 주입되므로 토큰 비용 · 캐시 안정성에 직접 영향.
- 장문 레퍼런스 (아키텍처 상세 · 온보딩 가이드) 는 `codebase/docs/...` 또는 `codebase/README.md` 에 분리.

### 섹션 구조 — 자유 형식, 권장 예시

고정 섹션은 **없다**. 아래는 권장 예시이며 프로젝트의 현재 상태에 해당하는 섹션만 포함한다. 모르는 것 / 아직 결정 안 된 것은 **섹션을 아예 생략**한다 (placeholder 나 "TBD" 대신).

```md
# ANTRULES.md

> ant 에이전트가 이 코드베이스에서 파일 생성·수정 결정을 할 때의 설정.
> 사람용 설명은 README.md / docs/ 참조.

## Export Style
- (예) default export, single component per file.

## React Imports
- (React 스택일 때만) `import React from 'react'` required when using `React.JSX.Element`.

## Testing
- setup 시점: Node/언어 버전, 패키지 매니저, 이미 추가된 test-runner 의존성, 호환성 노트.
- 이후 test-code 태스크가 실제 선택한 runner / setup file / placement 를 append.

## File Naming
- Components: kebab-case.tsx. Hooks: `use-*.ts`.

## Library Compatibility
- (예, feature 태스크가 발견 후 추가) `zustand@^4` 는 React 18 concurrent mode 와 충돌; v5 를 사용할 것.
```

필요 시 `## Security`, `## Lint`, `## Anti-Patterns`, `## Glossary` 등 자유 추가.

### 쓰기 / 읽기 소유권 — 모든 태스크가 write 가능

| 주체 | 권한 |
|---|---|
| setup task | read + write. 디자인 문서에 명시된 것 / setup 시점에 실제 설치된 의존성 등 **확신하는 것만** 초기 skeleton 에 기록. 모르는 섹션은 생략. **허위 금지 문구 작성 금지** ("Do not add test files" 같은 것). |
| feature / ui / integration / design-system | read + write. 자기 작업 중 발견한 cross-task 불변성 (타입 규약, import style 결정 등) 을 추가/수정. |
| test-code | read + write. 실제 설치·검증한 test runner / setup file / placement 등을 `## Testing` 에 append 하거나 기존 내용을 수정. |
| error / verification | read + write. 수정 중 발견한 anti-pattern 이나 호환성 제약을 추가. |
| doc | read + write. 문서 작성 중 발견한 명명 규약 불일치 등을 반영. |

**단일 writer 는 없다**. 각 태스크는 자기 관찰로 기록·수정할 수 있다. 충돌 (병렬 태스크가 동시에 수정) 은 SharedFileBuffer + LLM-merge 로직으로 자연 해소된다 (별도 lock 불필요 — 기존 `edit_file` / `<file>` 의 cross-worker conflict 메커니즘 재사용).

### 에이전트 디스패치

`loadAntrules(featureRoot)` (`core/artifact/antrules.ts`) 가 단일 필드 `antrulesContent: string | undefined` 를 반환한다:

- `undefined` — 파일 없음 / 읽기 실패 / trim 후 빈 문자열
- 비어있지 않은 문자열 — 컨텐츠 (1500자 초과 시 truncate + `read_file` 포인터 footer)

공통 partial `jobs/code/base/injections/ant-md.md` 가 `{{#if antrulesContent}}` 로 gate 하여 내용을 렌더한다. plan / execute 의 기본 base 템플릿 및 모든 variant (verification · error · test-code · feature · ui · design-system · integration) 가 이 partial 을 include 하므로 주입은 **매번** 일어난다.

partial 상단에 파일 경로를 명시하여, LLM 이 해당 섹션이 stale 하다고 판단하면 `read_file codebase/ANTRULES.md` 로 자율 조회할 수 있다. 즉 "매 프롬프트 주입 + 필요 시 자율 read" 의 이중 전달.

### 호출 경로 파편화 방지

각 plan hook (generic / verification / error) 이 개별적으로 `loadAntrules` 를 호출하면 hook 을 추가할 때마다 주입을 잊을 위험이 생긴다. `PlanPromptCtx.antrulesContent` 에 phase layer (`buildPlanPrompt` in `planGeneration.ts`) 가 미리 담아 넘기고, 모든 hook 은 `ctx.antrulesContent` 를 소비할 뿐이다. Execute 쪽도 `buildMessages.ts` 한 지점에서만 `loadAntrules` 를 호출 — 호출 경로는 plan 1곳, execute 1곳.

## 3. 실무 가이드라인

### 새 파일 / 디렉토리 추가 시 체크리스트

1. 이 파일은 사람 개발자가 `ls codebase/` 에서 보게 해야 하는가? → `codebase/` 층.
2. 이 파일은 코드 생성의 **입력** 스펙인가 (PRD, 토큰, UI 스펙)? → `outputs/` 층.
3. 이 파일은 다음 run 에 이어질 에이전트 내부 상태인가? → `sessions/` 층.

혼돈 사례:
- ❌ "프로젝트 컨벤션" 을 `outputs/design/system/project-conventions.md` 로 만들기 — 1번이 맞는데 2번 선택한 실수. 컨벤션은 `codebase/ANTRULES.md`.
- ❌ 런타임 로그를 `codebase/.ant/logs/` 에 기록 — 3번을 1번으로 섞음. `sessions/` 로.
- ❌ PRD 를 `codebase/docs/PRD.md` 에 영구 저장 — 2번 성격을 1번에 두면 산출물 수명주기 (버전 · 갱신) 가 코드 git 이력과 섞인다.

### 여러 에이전트 도구와의 공존

`CLAUDE.md`, `AGENTS.md`, `.cursorrules` 가 이미 있다면 ANTRULES.md 와 공존 가능. 에이전트별 설정은 **해당 에이전트만** 읽으므로 충돌 없음. 단, 동일 규칙이 여러 파일에 중복되면 drift 가 발생하니 ANTRULES.md 가 기준이면 다른 파일들은 ANTRULES.md 포인터만 두는 편을 권장.

## 4. 관련 문서

- [.cursorrules](/.cursorrules) — ant 작업 기본 규약 + ANTRULES.md 요약 포인터
- [14-code-job.md](14-code-job.md) — 코드 잡의 setup 태스크가 ANTRULES.md 를 어떻게 초기화하는지
- [28-context-management.md](28-context-management.md) — ArtifactPipeline 이 pool 을 구성하는 방식

## 5. 변경 이력

- 2026-04-22: 최초 작성 (policy 도입). `attempted-cycle-removal` 작업 중 `outputs/design/system/project-conventions.md` 초안이 경계 위반임을 발견하면서 원칙화.
- 2026-04-23: §2 재작성. 원래 의도 (발견 기반 live log) 대비 현 구현 (setup 선제 skeleton, 4섹션 고정, 읽기 전용) 의 drift 가 `plum-molding-bench` 에서 setup 이 `Do not add test files` 같은 허위 금지 문구를 생성 → test-code 태스크 무한 루프로 드러났음. "4섹션 고정" 해제, "모든 태스크가 read+write 가능", "허위 금지 문구 금지", scope 를 광범위 cross-task 불변성으로 명시.
