# Prompt System

## 개요

ANT의 프롬프트 시스템은 WHAT/HOW 분리 원칙으로 설계된다. 템플릿은 Handlebars 기반이며, 6단계 엔진 파이프라인을 통해 최종 프롬프트가 조립된다.

## WHAT/HOW 분리

| 접두사 | 역할 | 내용 |
|--------|------|------|
| `base-*.md` | WHAT | 컨텍스트, 데이터, 현재 상태, 태스크 정의 |
| `rules-*.md` | HOW | 규칙, 형식, 제약, 방법 |

### 규약

- `base-*.md`에는 규칙/제약/금지 표현을 넣지 않는다
- `rules-*.md`에는 동적 데이터/컨텍스트 주입을 넣지 않는다
- 모든 프롬프트는 영문으로 작성한다
- 프로젝트 특정 예시를 넣지 않는다 (플랫폼/언어 중립)

## 템플릿 디렉토리 구조

```
core/prompt/templates/
    code/
        phases/
            decompose/      (base.md, rules.md)
            detect/         (base.md, rules.md)
            docgen/         (base.md, rules.md)
            enforce/        (base.md, rules.md)
            error/          (base.md, rules.md)
            execute/        (base.md, rules.md)
            plan/           (base.md, rules.md)
            revise/         (base.md, rules.md)
            testgen/        (base.md, rules.md)
            tool/           (base.md, rules.md)
            verify/         (base.md, rules.md)
        base/
            system.md
            examples.md
            injections/     (각종 injection 파셜)
            tools/          (도구별 파셜)
    design/
        phases/
            decompose/      (base.md, rules.md)
            detect/         (base.md, rules.md)
            execute/        (base.md, rules.md)
            plan/           (base.md, rules.md)
            revise/         (base.md, rules.md)
    common/
        architect-role.md
        rules.md
        injections/         (공통 injection 파셜)
    planner/
        plan/               (base.md, rules.md)
    triage/                 (base.md, rules.md)
    ask/                    (base.md, rules.md)
    learn/                  (base.md, rules.md)
```

## 엔진 파이프라인

PromptEngine은 6단계로 프롬프트를 조립한다.

| 단계 | 컴포넌트 | 역할 |
|------|----------|------|
| 1 | InputNormalizer | 입력 정규화 |
| 2 | ContextAssembler | 컨텍스트 수집 및 조합 |
| 3 | ModeController | 모드별 분기 제어 |
| 4 | TemplateComposer | Handlebars 템플릿 렌더링 |
| 5 | PolicyInjector | 정책 주입 |
| 6 | PromptFormatter | 최종 형식 정리 |

## 템플릿 렌더링

Handlebars를 사용하며, 조건부 섹션(`{{#if}}`)과 반복(`{{#each}}`)을 지원한다. 삼중 중괄호(`{{{...}}}`)로 HTML 이스케이프 없이 raw 출력한다.

### 주입 데이터 예시

| 변수 | 출처 |
|------|------|
| `directive` | 사용자 입력 또는 overrideDirective |
| `detectionReport` | detectEnvironment 노드 |
| `taskDescription` | decompose에서 생성된 태스크 설명 |
| `previousChaptersSummary` | 이전 챕터 요약 (Design Job) |
| `existingDocument` | 기존 PRD 또는 설계 문서 |

## FPOP 원칙

프롬프트 작성 시 FPOP (First-Principles Observation Prompting)을 따른다.

| 원칙 | 의미 |
|------|------|
| Principles over Examples | 보편적 규칙 사용, 구체적 사례 배제 |
| What over How | 대상 명시, 방법 생략 (LLM이 이미 알고 있음) |
| Observable over Assumed | 관찰 요구, 추론 금지 |
| Universal over Specific | 플랫폼/언어 중립 |
| Constraints over Instructions | 금지 사항으로 범위 한정 |
| Reminders for Blind Spots | 자주 누락되는 항목만 상기 |

## 리소스 경로 해석

`WorkspacePathResolver.getCliRoot()`가 모든 내부 리소스(템플릿, 정책, 프로필 등)의 루트 경로를 결정한다.

| 실행 컨텍스트 | getCliRoot() 반환값 | 예시 |
|---------------|---------------------|------|
| dev 모드 (`tsx src/...`) | `src/` | `src/core/prompt/templates/` |
| prod 모드 (`node dist/...`) | `dist/` | `dist/core/prompt/templates/` |
| 자식 프로세스 (job-runner) | `ANT_CLI_ROOT` 환경변수 | JobWorker가 설정 |

경로 해석 방식:
- prod: `import.meta.url` 경로에서 `/dist/`를 찾아 추출 (번들 깊이 무관)
- dev: `WorkspaceResolver.ts`의 실제 위치 기준으로 `src/` 반환
- `ANT_CLI_ROOT` 환경변수가 설정된 경우 무조건 우선 사용

이 경로에 의존하는 파생 메서드:
- `getPromptTemplatesPath()` → `{root}/core/prompt/templates`
- `getPoliciesPath()` → `{root}/core/policies/prompts`
- `getProfilesPath()` → `{root}/periphery/profiles`
- `getDocsRoot()` → `{root}/../../../docs`

## FilePromptAdapter

`periphery/adapters/prompt/FilePromptAdapter.ts`가 파일시스템에서 템플릿을 로드한다. 빌드 시 esbuild가 `templates/` 디렉토리를 dist에 복사한다.

### initPartials()

서버 시작 시 `initPartials()`를 await하여 모든 Handlebars partial을 자동 탐색/등록한다.
`templates/` 하위의 모든 `.md` 파일을 재귀 탐색하여 partial로 등록하므로, 템플릿 추가/삭제/이름변경 시 코드 수정이 필요 없다.

## 빌드/테스트 파이프라인

```
npm test          → vitest run (14개 테스트, ~0.3초, 인프라 불필요)
npm run build     → prebuild(=test) → esbuild → cp templates to dist/
npm run start:cloud → dist/ 기반 실행 (이미 검증됨)
```

| 스크립트 | 위치 | 설명 |
|----------|------|------|
| `test` | ant-cli | vitest run (템플릿 스모크 + 런타임 조립 유닛) |
| `prebuild` | ant-cli | build 전 자동 실행 (= test) |
| `test:cli` | root | `pnpm --filter @ant/cli test` (루트에서 실행 편의) |

테스트가 실패하면 빌드가 중단된다. `start:cloud`은 이미 빌드된 산출물을 실행하므로 별도 테스트를 포함하지 않는다.

## 프롬프트 주입 경로

모든 LLM 프롬프트는 2가지 경로를 통해 조립된다:

| 경로 | 설명 | 안전장치 |
|------|------|----------|
| A: 템플릿 렌더링 | `.md` 템플릿을 FilePromptAdapter로 렌더 | 스모크 테스트 (90개 전수검사) |
| B: 런타임 조립 | TypeScript 함수가 state에서 동적 컨텍스트 조립 | 유닛 테스트 (buildRuntimeContext, generateFileTree) |

## 안전 메커니즘

- **Fail-fast**: base/rules 템플릿 실패 시 TemplateComposer가 throw (job 즉시 실패)
- **Contract logging**: PromptLogger가 `contractViolations` 필드로 누락 변수 기록
- **Injection manifest**: `injection-manifest.json`이 injection 템플릿 → 변수 매핑을 선언
- **`npm test` 게이트**: 템플릿 스모크 + 런타임 조립 유닛 테스트 (CI에서 자동 실행)

자세한 내용은 [docs/testing/05-prompt-safety-gate.md](../testing/05-prompt-safety-gate.md) 참고.

## 경계

- 각 에이전트의 프롬프트 사용: [14-code-job.md](14-code-job.md), [15-design-job.md](15-design-job.md), [16-planner-job.md](16-planner-job.md)
- Preview 관련 프롬프트: [22-preview-system.md](22-preview-system.md)
