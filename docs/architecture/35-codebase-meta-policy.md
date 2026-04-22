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

## 2. `codebase/ANT.md` — ant 에이전트 설정 SSOT

### 정체성

- **ant 에이전트가 이 코드베이스에서 새 파일을 생성하거나 수정할 때 따라야 하는 결정 규칙** 을 모아둔 단일 엔트리.
- `README.md` / `ARCHITECTURE.md` / `RUNBOOK.md` 와는 **목적이 다르다**. 이들은 사람 중심 문서 (프로젝트 개요, 모듈 경계, 런 방법). ANT.md 는 에이전트 행동 규칙. 두 축은 독립으로 공존한다.
- Cursor / Claude Code / OpenAI Codex 생태계에서 `AGENTS.md` / `CLAUDE.md` 가 하는 역할과 유사. 이름은 ant 의 identity 를 반영해 `ANT.md`.

### 위치

- `codebase/ANT.md` (루트 평탄 파일). 하위 디렉토리 / 숨김 디렉토리 사용 금지 — 사람 개발자가 저장소 루트 에서 곧장 인지해야 하므로.

### 크기 제약

- 권장 상한: **1500자**. 초과 시 ant 파이프라인이 truncate + 경고 로깅.
- 근거: 매 plan / execute 프롬프트에 자동 주입되므로 토큰 비용 · 캐시 안정성에 직접 영향.
- 장문 레퍼런스 (아키텍처 상세 · 온보딩 가이드) 는 `codebase/docs/...` 또는 `codebase/README.md` 에 분리.

### 섹션 구조 (고정)

```md
# ANT.md

> ant 에이전트가 이 코드베이스에서 파일 생성·수정 결정을 할 때의 설정.
> 사람용 설명은 README.md / docs/ 참조.

## Export Style
- (예) default export, single component per file.

## React Imports
- (예) `import React from 'react'` required when using `React.JSX.Element` / `React.ReactNode`.

## Testing
- Framework: (예) Jest + next/jest preset
- Setup file: `src/test-setup.ts`
- Test placement: `src/__tests__/*.test.tsx`

## File Naming
- Components: (예) kebab-case.tsx
- Hooks: `use-*.ts`
```

필요 시 `## Security`, `## Lint`, `## Glossary` 등 추가 가능. 기본 4 섹션은 고정.

### 쓰기 / 읽기 소유권

| 주체 | 쓰기 | 읽기 |
|---|---|---|
| setup task | 초기 skeleton 생성 | — |
| design-system task | 원칙적으로 안 건드림 (필요 시 `## Testing` 보강) | ✓ |
| feature / integration / ui 태스크 | **읽기 전용** | ✓ |
| test-code 태스크 | **읽기 전용** | ✓ |
| error / verification 태스크 | **읽기 전용** | ✓ |
| 운영 중 갱신 | 별도 refactor 태스크 (향후 도입) | — |

SSOT 는 setup 이 찍고, 나머지는 읽기만 한다. "운영 중 변경" 은 ANT.md 가 직접 허용하지 않는다 — 이는 별도 태스크의 책임이므로 범위 밖.

### 에이전트 디스패치

ArtifactPipeline 은 `codebase/ANT.md` 파일의 존재를 감지하여 다음 템플릿 변수를 세팅한다:

- `hasAntMd: boolean`
- `antMdContent: string | undefined` (1500자 초과 시 truncate)

공통 partial `jobs/code/base/injections/ant-md.md` 가 `hasAntMd` 를 gate 로 내용을 렌더한다. plan / execute 의 기본 base 템플릿 및 모든 variant (verification · error · test-code · feature · ui · design-system · integration) 가 이 partial 을 include 하므로 주입은 **매번** 일어난다.

partial 상단에 파일 경로를 명시하여, LLM 이 해당 섹션이 stale 하다고 판단하면 `read_file codebase/ANT.md` 로 자율 조회할 수 있다. 즉 "매 프롬프트 주입 + 필요 시 자율 read" 의 이중 전달.

## 3. 실무 가이드라인

### 새 파일 / 디렉토리 추가 시 체크리스트

1. 이 파일은 사람 개발자가 `ls codebase/` 에서 보게 해야 하는가? → `codebase/` 층.
2. 이 파일은 코드 생성의 **입력** 스펙인가 (PRD, 토큰, UI 스펙)? → `outputs/` 층.
3. 이 파일은 다음 run 에 이어질 에이전트 내부 상태인가? → `sessions/` 층.

혼돈 사례:
- ❌ "프로젝트 컨벤션" 을 `outputs/design/system/project-conventions.md` 로 만들기 — 1번이 맞는데 2번 선택한 실수. 컨벤션은 `codebase/ANT.md`.
- ❌ 런타임 로그를 `codebase/.ant/logs/` 에 기록 — 3번을 1번으로 섞음. `sessions/` 로.
- ❌ PRD 를 `codebase/docs/PRD.md` 에 영구 저장 — 2번 성격을 1번에 두면 산출물 수명주기 (버전 · 갱신) 가 코드 git 이력과 섞인다.

### 여러 에이전트 도구와의 공존

`CLAUDE.md`, `AGENTS.md`, `.cursorrules` 가 이미 있다면 ANT.md 와 공존 가능. 에이전트별 설정은 **해당 에이전트만** 읽으므로 충돌 없음. 단, 동일 규칙이 여러 파일에 중복되면 drift 가 발생하니 ANT.md 가 기준이면 다른 파일들은 ANT.md 포인터만 두는 편을 권장.

## 4. 관련 문서

- [.cursorrules](/.cursorrules) — ant 작업 기본 규약 + ANT.md 요약 포인터
- [14-code-job.md](14-code-job.md) — 코드 잡의 setup 태스크가 ANT.md 를 어떻게 초기화하는지
- [28-context-management.md](28-context-management.md) — ArtifactPipeline 이 pool 을 구성하는 방식

## 5. 변경 이력

- 2026-04-22: 최초 작성 (policy 도입). `attempted-cycle-removal` 작업 중 `outputs/design/system/project-conventions.md` 초안이 경계 위반임을 발견하면서 원칙화.
