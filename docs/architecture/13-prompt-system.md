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
            detect/         (base.md, rules.md)
            decompose/      (base.md, rules.md)
            execute/        (base.md, rules.md)
            plan/           (base.md, rules.md)
            revise/         (base.md, rules.md)
        base/
            injections/     (preview-setup.md, preview-env-contract.md)
    design/
        phases/
            decompose/      (base.md, rules.md)
            execute/        (base.md, rules.md)
            revise/         (base.md, rules.md)
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

## FilePromptAdapter

`periphery/adapters/prompt/FilePromptAdapter.ts`가 파일시스템에서 템플릿을 로드한다. 빌드 시 esbuild가 `templates/` 디렉토리를 dist에 복사한다.

## 경계

- 각 에이전트의 프롬프트 사용: [05-code-job.md](05-code-job.md), [06-design-job.md](06-design-job.md), [07-planner-job.md](07-planner-job.md)
- Preview 관련 프롬프트: [11-preview-system.md](11-preview-system.md)
