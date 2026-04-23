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

## 2. `codebase/ANTRULES.md` — 3-조건 필터 기반의 deviation ledger

### 단일 목적

`codebase/ANTRULES.md` 는 **이 코드베이스에서만 유효하고, 자동으로 유추되지 않으며, 후속 task 가 같은 결정을 반복해야 일관성이 유지되는 잔여 집합** 을 기록한다. 그 외의 책임 영역 (decompose / prompt / config file) 을 침범하지 않는다.

### 3-조건 필터 (ALL 만족 시에만 기록)

어떤 사실을 ANTRULES 에 기록할 자격은 아래 세 조건을 **모두** 만족할 때만 부여된다. 하나라도 빠지면 다른 SSOT 가 담당하고 ANTRULES 에는 들어가지 않는다.

| # | 조건 | 실패 시 실제 담당 |
|---|---|---|
| 1 | **Codebase-local** — 이 프로젝트에서만 유효한 선택. system-wide default / techTier hint 로 커버되면 안 된다. | 시스템 prompt / techTier hints |
| 2 | **Not auto-derivable** — `package.json`, `tsconfig.json`, lockfile, 프레임워크 관습, 명시적 config 파일, 기존 파일 구조 어디에도 기록되지 않는다. | 해당 config 파일 / 기존 코드 |
| 3 | **Cross-task invariant** — 후속 task (또는 세션) 가 같은 선택을 반복해야 일관성이 유지된다. 이 task 만의 일회성 선택이면 제외. | 해당 task 의 plan / task description |

### 침범 금지 원칙

ANTRULES 는 아래 세 영역의 책임을 **건드리지 않는다**:

| 영역 | 담당 | 예시 |
|---|---|---|
| "이번 task 는 무엇을 할지" | **decompose** | "hero-section.tsx 를 작성한다" |
| "TypeScript / Next 에서 일반적으로 이렇게 해야 한다" | **prompt (system / techTier)** | "`moduleResolution: node` 필수" |
| "기계가 읽는 사실" | **config 파일** | `package.json` 의 deps, `tsconfig.paths` |

ANTRULES 는 세 영역 어디에도 속하지 않는 **잔여 집합** 만 가져간다. decompose 가 매 task description 에 `techTier: nextjs` 를 이미 주입하는데 ANTRULES 에 "Framework: Next.js" 를 적으면 SSOT 가 둘이 되고 drift 의 씨앗이 된다.

### 전형적인 허용 / 금지 사례

#### ✅ 허용 — 2축

- **프로젝트 고유 컨벤션 (decompose / prompt 로 표현 불가능한 미세 선택)**
  - 파일 네이밍 case (`kebab-case.tsx`, `PascalCase.ts`)
  - Hooks 파일명 prefix (`use-*.ts`)
  - Export 스타일 선호 (named 우선, default 예외)
  - 디렉토리 조직 규약 (e.g. "sections/ 는 top-level 페이지 블록만, components/ui 는 primitive 만")
  - Lint rule 의 특정 해석 (`no-unused-vars: warn` 로 의도적 완화 + 이유)
  - 커스텀 도메인 용어 매핑 (e.g. "`pulse` = project code name; code 에 `Pulse` 로 등장")

- **시점-국지 (point-in-time) 패키지 호환 / pinning rationale**
  - "`shadcn X v0.4` 가 `react@19` 와 충돌 — `react@18` 에 pin, upstream PR #NNN 머지 전까지"
  - "Node 22.6 의 `--experimental-strip-types` 버그로 22.5 고정"
  - "jest 30 migration 전까지 `jest.config.ts` 대신 `.js` 유지"
  - "Tailwind v4 의 `@theme` 직접 선언 방식이 Next 15.1 과 호환성 이슈 — v3 고정"

#### ❌ 금지 — 이미 다른 SSOT 가 담당

| 금지 항목 | 실제 SSOT |
|---|---|
| "Framework: Next.js 15, App Router" | `package.json` + techTier |
| "Styling: Tailwind v3" | `package.json` + `tailwind.config.ts` |
| "Test runner: Jest 29 via `next/jest`" | `package.json` + `jest.config.*` |
| "Source root: `src/`" | `tsconfig paths` + 프레임워크 관습 |
| "`@/` alias resolves to `src/`" | `tsconfig paths` |
| "Config file: `tailwind.config.ts` at codebase root" | 파일 시스템 |
| "Icons: `lucide-react`" | `package.json` |
| "TypeScript strict mode" | `tsconfig.json` |
| "Scan path: `src/**/*.{ts,tsx}`" | `tailwind.config.ts` 본체 |

이들을 ANTRULES 에 적는 순간 SSOT 가 둘이 된다. 코드 / 설정이 바뀌었을 때 ANTRULES 는 자동으로 업데이트되지 않으므로 stale 해지고, LLM 이 "authoritative" 로 믿으면 회귀가 발생한다.

### Before / After — `lapis-bonding-fruit` 실제 사례

이 3-조건 필터 도입 전 setup-project 가 생성한 ANTRULES (933 chars) 중 필터를 통과하는 항목만 남기면 다음과 같다.

**Before (933 chars, 7 섹션)**:
```md
# ANTRULES.md

## Framework
- Next.js 15, App Router, TypeScript strict mode.
- Source root: `src/` — all application code lives under `codebase/src/`.

## Styling
- Tailwind CSS v3.
- Config file: `tailwind.config.ts` at codebase root.
- Source scan path: `src/**/*.{ts,tsx}`.
- Design tokens extend `theme.extend` in `tailwind.config.ts`.

## Testing
- Jest 29 + React Testing Library 16 via `next/jest` (SWC pipeline).
- Do NOT add `babel.config.js` — it disables SWC project-wide.
- Setup file: `jest.setup.ts` (imports `@testing-library/jest-dom`).

## Icons
- Use `lucide-react` exclusively for all icon needs.

## Aliases
- `@/` resolves to `src/`.

## File Naming
- Components: `kebab-case.tsx`.
- Hooks: `use-*.ts`.
- Utilities: `kebab-case.ts`.

## Export Style
- Named exports preferred; default export only for Next.js page/layout files.
```

**After (4 항목만 유효)**:
```md
# ANTRULES.md

## Testing
- Do NOT add `babel.config.js` — it disables SWC project-wide (next/jest 의 interaction hazard).

## File Naming
- Components: `kebab-case.tsx`.
- Hooks: `use-*.ts`.
- Utilities: `kebab-case.ts`.

## Export Style
- Named exports preferred; default export only for Next.js page/layout files.
```

제거된 5 섹션 (`Framework`, `Styling`, `Icons`, `Aliases`, `Styling/Scan path` 등) 은 모두 `package.json` / `tsconfig.json` / `tailwind.config.ts` 에서 자동 유추되는 사실이었다. 남긴 항목:
- `babel.config.js` 금지 — **조건 1·2·3 모두 만족** (next/jest 특유 hazard, 어떤 config 에도 안 적혀 있음, 후속 task 가 쉽게 실수할 수 있음)
- 파일 네이밍 3종 — **조건 2 만족** (next.js 는 파일명에 무관심, tsconfig 에도 없음) + 조건 3 (후속 task 가 일관성을 유지해야 함)
- Export style — 위와 동일

### 위치

- `codebase/ANTRULES.md` (루트 평탄 파일). 하위 디렉토리 / 숨김 디렉토리 사용 금지 — 사람 개발자가 저장소 루트에서 곧장 인지해야 하므로.

### 크기 제약

- 권장 상한: **1500자**. 초과 시 ant 파이프라인이 truncate + 경고 로깅.
- 근거: 매 plan / execute 프롬프트에 자동 주입되므로 토큰 비용 · 캐시 안정성에 직접 영향.
- 3-조건 필터를 제대로 적용하면 대부분의 프로젝트에서 500자 이하로 수렴한다. 1500자 에 근접한다면 필터 재검토 신호.

### 섹션 구조 — 자유 형식, 고정 골격 없음

고정 섹션은 **없다**. 3-조건 필터를 통과한 항목이 있는 경우에만 해당 제목으로 섹션을 만든다. 통과 항목이 없으면 **파일 자체를 생성하지 않는다** (empty skeleton 금지). `setup` task 는 더 이상 "모든 카테고리를 미리 시드" 하지 않는다 — 발견 기반으로만 append.

### 쓰기 / 읽기 소유권 — 모든 태스크가 write 가능

| 주체 | 권한 |
|---|---|
| 모든 code-job task (setup / feature / ui / integration / design-system / test-code / error / verification / doc) | read + write. 3-조건 필터를 통과한 cross-task 불변성 **만** 기록. 필터를 통과하지 못하면 기록 금지. |
| verification task | 특히 중요 — 실증한 deviation (예: "jest 30 까지 `.ts` config 사용 금지, `.js` 유지") 을 append 하는 주 생산자. 단 "`setupFilesAfterEnv` 가 맞는 키" 같은 공식 schema 에서 derivable 한 사실은 techTier hint 대상이지 ANTRULES 대상이 아님. |

**단일 writer 는 없다**. 각 태스크는 자기 관찰로 기록·수정할 수 있다. 충돌 (병렬 태스크가 동시에 수정) 은 SharedFileBuffer + LLM-merge 로직으로 자연 해소된다 (별도 lock 불필요 — 기존 `edit_file` / `<file>` 의 cross-worker conflict 메커니즘 재사용).

### 에이전트 디스패치

`loadAntrules(featureRoot)` (`core/artifact/antrules.ts`) 가 단일 필드 `antrulesContent: string | undefined` 를 반환한다:

- `undefined` — 파일 없음 / 읽기 실패 / trim 후 빈 문자열
- 비어있지 않은 문자열 — 컨텐츠 (1500자 초과 시 truncate + `read_file` 포인터 footer)

공통 partial `jobs/code/base/injections/antrules.md` 가 `{{#if antrulesContent}}` 로 gate 하여 내용을 렌더한다. 파티얼 본문은 3-조건 필터를 매번 재노출 — content 존재 분기에서는 "이 block 의 stale 가능성을 의심하고 실제 code 를 신뢰하라" 는 완화 프레이밍으로, undefined 분기에서는 "새 파일 생성 전 3-조건 필터 통과 여부 확인" 으로 LLM 에게 상기시킨다.

partial 상단에 파일 경로를 명시하여, LLM 이 해당 섹션이 stale 하다고 판단하면 `read_file codebase/ANTRULES.md` 로 자율 조회할 수 있다. 즉 "매 프롬프트 주입 + 필요 시 자율 read + 의심 기반 SSOT 재확인" 의 삼중 전달.

### 호출 경로 파편화 방지

각 plan hook (generic / verification / error) 이 개별적으로 `loadAntrules` 를 호출하면 hook 을 추가할 때마다 주입을 잊을 위험이 생긴다. `PlanPromptCtx.antrulesContent` 에 phase layer (`buildPlanPrompt` in `planGeneration.ts`) 가 미리 담아 넘기고, 모든 hook 은 `ctx.antrulesContent` 를 소비할 뿐이다. Execute 쪽도 `buildMessages.ts` 한 지점에서만 `loadAntrules` 를 호출 — 호출 경로는 plan 1곳, execute 1곳.

### 의존성 자급자족 원칙 — ANTRULES 의 책임이 아니다

"어떤 라이브러리를 쓰려면 설치해야 한다" 같은 **class-of-bug 차원의 기본 원칙** 은 ANTRULES 가 담당하지 않는다. 이는 `jobs/code/base/injections/dep-self-contained.md` 파티얼이 **모든 code-job execute / plan variant 에 고정 주입** 한다 (doc / explain 제외). ANTRULES 는 이 원칙에 의존하되 대체하지 않는다 — "이 프로젝트는 Jest 29 를 쓴다" 는 decompose / package.json SSOT, "이 프로젝트에서 쓰기로 한 Jest 는 `@types/jest` 를 요구한다" 는 dep-self-contained SSOT. ANTRULES 는 "이 프로젝트는 jest 30 migration 전까지 config 파일을 `.js` 로 유지한다" 같은 **점-국지 deviation** 만 담당.

## 3. 실무 가이드라인

### 새 파일 / 디렉토리 추가 시 체크리스트

1. 이 파일은 사람 개발자가 `ls codebase/` 에서 보게 해야 하는가? → `codebase/` 층.
2. 이 파일은 코드 생성의 **입력** 스펙인가 (PRD, 토큰, UI 스펙)? → `outputs/` 층.
3. 이 파일은 다음 run 에 이어질 에이전트 내부 상태인가? → `sessions/` 층.

혼돈 사례:
- ❌ "프로젝트 컨벤션" 을 `outputs/design/system/project-conventions.md` 로 만들기 — 1번이 맞는데 2번 선택한 실수. 컨벤션은 `codebase/ANTRULES.md` (단, 3-조건 필터 통과 시).
- ❌ 런타임 로그를 `codebase/.ant/logs/` 에 기록 — 3번을 1번으로 섞음. `sessions/` 로.
- ❌ PRD 를 `codebase/docs/PRD.md` 에 영구 저장 — 2번 성격을 1번에 두면 산출물 수명주기 (버전 · 갱신) 가 코드 git 이력과 섞인다.

### ANTRULES 기록 전 self-check

어떤 사실을 ANTRULES 에 적기 전 다음 네 질문에 답한다. **모두 NO 일 때만** 기록 자격.

1. `package.json` / `tsconfig.json` / `*.config.*` / lockfile 에 이미 있는가?
2. 프레임워크 공식 관습 / techTier 기본값으로 유추되는가?
3. decompose 가 task description 에 이미 주입하는 정보인가?
4. 이 task 만의 일회성 선택인가 (후속 task 가 반복할 필요 없는가)?

하나라도 YES 라면 ANTRULES 대신 **해당 SSOT** 에 기록하거나 기록하지 않는다.

### 여러 에이전트 도구와의 공존

`CLAUDE.md`, `AGENTS.md`, `.cursorrules` 가 이미 있다면 ANTRULES.md 와 공존 가능. 에이전트별 설정은 **해당 에이전트만** 읽으므로 충돌 없음. 단, 동일 규칙이 여러 파일에 중복되면 drift 가 발생하니 ANTRULES.md 가 기준이면 다른 파일들은 ANTRULES.md 포인터만 두는 편을 권장.

## 4. 관련 문서

- [.cursorrules](/.cursorrules) — ant 작업 기본 규약 + ANTRULES.md 요약 포인터
- [14-code-job.md](14-code-job.md) — 코드 잡의 setup 태스크가 ANTRULES.md 를 어떻게 초기화하는지 (3-조건 필터 적용 후의 축소된 seed 범위)
- [28-context-management.md](28-context-management.md) — ArtifactPipeline 이 pool 을 구성하는 방식

## 5. 변경 이력

- 2026-04-22: 최초 작성 (policy 도입). `attempted-cycle-removal` 작업 중 `outputs/design/system/project-conventions.md` 초안이 경계 위반임을 발견하면서 원칙화.
- 2026-04-23: §2 재작성. 원래 의도 (발견 기반 live log) 대비 현 구현 (setup 선제 skeleton, 4섹션 고정, 읽기 전용) 의 drift 가 `plum-molding-bench` 에서 setup 이 `Do not add test files` 같은 허위 금지 문구를 생성 → test-code 태스크 무한 루프로 드러났음. "4섹션 고정" 해제, "모든 태스크가 read+write 가능", "허위 금지 문구 금지", scope 를 광범위 cross-task 불변성으로 명시.
- 2026-04-23 (dep-self-contained 리팩터): `lapis-bonding-fruit` 에서 setup-project 가 생성한 933자 ANTRULES 중 5/7 섹션이 `package.json` / `tsconfig.json` 재선언으로 밝혀지면서 SSOT drift 위험이 구조화됨. §2 를 3-조건 필터 기반으로 재작성. 파티얼 파일명을 `ant-md.md` → `antrules.md` 로 rename 하여 파일명과 대상이 일치하게 조정. "Treat them as authoritative" 프레이밍을 "stale 가능성을 의심, 실제 code 를 SSOT 로 신뢰" 로 완화. "의존성 자급자족 원칙" 은 별도 partial (`dep-self-contained`) 로 분리 — ANTRULES 의 책임에서 제외.
