---
name: add-prompt-template
description: ANT 에이전트에 새 Handlebars 프롬프트 템플릿을 추가할 때 사용. 프롬프트 작성, 수정, 신규 phase 추가 시 자동 호출.
allowed-tools: Read, Write, Glob, Grep
---

ANT 프롬프트 시스템에 새 템플릿을 추가한다. $ARGUMENTS

## 1. 디렉토리 결정

템플릿 루트: `packages/ant-cli/src/core/prompt/templates/`

| 에이전트/용도 | 경로 |
|---|---|
| code 에이전트 phase | `code/phases/{detect,decompose,plan,execute,revise}/` |
| design 에이전트 phase | `design/phases/{decompose,execute,revise}/` |
| planner 에이전트 | `planner/plan/` |
| triage | `triage/` |
| ask / learn | `ask/`, `learn/` |
| code base injection | `code/base/injections/` |

## 2. WHAT/HOW 분리 — 반드시 파일 두 개 생성

**`base-{name}.md`** — WHAT (컨텍스트, 데이터, 상태, 태스크 정의)
- 동적 변수 주입 포함 (`{{{directive}}}`, `{{{taskDescription}}}` 등)
- 규칙/제약/금지 표현 금지

**`rules-{name}.md`** — HOW (규칙, 형식, 제약, 금지)
- 정적 텍스트만 포함
- 동적 데이터/변수 주입 금지

## 3. Handlebars 문법

```handlebars
{{#if directive}}
{{{directive}}}
{{/if}}

{{#each tasks}}
- {{this.name}}
{{/each}}

{{{rawContent}}}   ← 삼중 중괄호: HTML 이스케이프 없음 (코드/마크다운용)
```

## 4. FPOP 원칙으로 작성

모든 프롬프트는 영문으로 작성한다. 각 항목별 **위반 판별 기준** 포함:

| 원칙 | 정의 | 위반 판별 기준 |
|------|------|---------------|
| **Principles over Examples** | 보편적 규칙만 기술 | 특정 프로젝트 코드 스니펫, 파일명, 구조를 예시로 포함하고 있는가? → 제거 후 원칙으로 대체 |
| **Observable over Assumed** | "observe X" 형태 | 규칙이 측정·관찰 불가능한 내부 상태를 전제하는가? (예: "사용자가 원할 것이다") → "X가 존재하면" 조건부로 전환 |
| **Constraints over Instructions** | "Do not ..." 범위 한정 | 긍정형 지시("~해라")로만 구성되어 경계가 모호한가? → 금지 조건 명시 추가 |
| **Universal over Specific** | 활성화 범위(gate) 와 같은 축의 specifics 만 허용 | (a) **always-on 파일**(agents/system, jobs/{job}/base/system) 에 framework/library/version 이름이 등장하는가? → `basis/techTier/{language,framework}/<X>.md` 같은 gated 위치로 분리. (b) **gated 파일**(`basis/techTier/framework/nextjs.md` 등) 인데 그 gate 의 축이 본문에서 비어있는가? → SBS 위반, gate 의 specifics 채울 것 (5 절 참고) |
| **What over How** | 목표만 기술 | 구체적 알고리즘·단계·코드 패턴을 지정하는가? → 목표 + 제약만 남기고 삭제 |

### 예외: 원칙만으로 의도를 특정할 수 없는 경우

다음 조건에 해당하면 구체적 예시·스키마·스니펫을 포함할 수 있다:

| 허용 조건 | 예시 |
|-----------|------|
| 출력 형식·스키마 규격 — 원칙만으로 키 이름·중첩 구조를 특정할 수 없음 | JSON 스키마, 마크다운 테이블 형식 |
| 모호한 경계 조건 해소 — 원칙이 두 가지 이상으로 해석될 수 있음 | "빈 배열 vs null 중 어느 쪽?" 같은 엣지 케이스 |

예시를 포함할 때의 제약:
- 예시는 **최소한의 수**로 유지한다 (형식 1개, 엣지 케이스 1~2개)
- 특정 프로젝트 코드가 아닌 **일반화된 형태**로 작성한다
- 예시 앞에 해당 예시가 해소하는 모호성을 한 줄로 명시한다

## 5. SBS — Scope-Bound Specificity (gate 와 specifics 일치)

FPOP 만으로는 "`nextjs.md` 가 'Next.js' 라는 단어를 쓰는 게 위반인가?" 같은 질문을 판정할 수 없다. SBS 는 그 회색지대를 닫는다. 작성 중인 템플릿의 **활성화 범위(gate)** 를 먼저 확정하고, 그 gate 축을 따른 specifics 를 의무로 채운다.

```
specificity_floor(template) = activation_scope(template)
```

### 5-1. 활성화 위치 → specificity floor

| 활성화 위치 | 가능한 gate | specificity floor |
|-------------|-------------|-------------------|
| `agents/{agent}/system.md` | always-on | Universal — FPOP 만 |
| `jobs/{job}/base/system.md` | job axis | job 축만 구체 |
| `basis/techTier/framework/<X>.md` | `framework=X` | X 의 versions / APIs / toolchain — 의무 |
| `basis/techTier/language/<X>.md` | `language=X` (+ stack) | X+stack specifics — 의무 |
| `nodes/{phase}/variants/<V>/*.md` | intent / taskType / mode 변종 | V specifics — 의무 |
| `common/injections/<X>.md` | data-presence / mode | X 가 활성화될 때 의미 있는 specifics — 의무 |

### 5-2. 작성 후 self-check 3 문항

1. **이 파일이 어떤 gate 로 활성화되는가?** 한 문장으로 명시할 수 있어야 한다. 못하면 위치 자체가 잘못됐을 가능성이 크다.
2. **그 gate 가 닫혔을 때 (활성화 안 될 때) 이 파일의 모든 문장이 잉여인가?** — 잉여여야 정상. 잉여가 아니면 그 문장은 잘못된 파일에 있다 (덜 gated 된 위치로 옮길 것).
3. **gate 축의 핵심 명사 (framework 이름, language 이름, intent ID, mode 이름) 가 본문에 등장하는가?** — 등장해야 정상. 없으면 SBS 위반 (gate 의 정보 payload 가 0).

### 5-3. FPOP × SBS 동시 검사

각 paragraph 마다 두 검사를 모두 통과해야 한다.

| 검사 | 질문 | 위반 시 처치 |
|------|------|--------------|
| **SBS** | gate 축에서 구체적인가? | 덜 gated 된 위치로 올리거나, gate 의 discriminator 이름·버전·API 를 반영하도록 다시 쓴다 |
| **FPOP** | gate 가 아닌 다른 축에서 구체적인가? | scope creep — 들어내거나 알맞은 gate 위치로 옮긴다 |

### 5-4. 4 절의 "예외" 와의 관계

4 절 "원칙만으로 의도를 특정할 수 없는 경우" 의 출력 스키마·엣지 케이스 예시 허용은 SBS 와 **별개의 정당화 사유** 다. SBS 는 "이 파일이 gate 된 위치에 있으니 gate 의 specifics 가 의무" 를 다루고, 4 절 예외는 "원칙만으로 출력 형식이 모호하니 최소 예시 허용" 을 다룬다. 양쪽 모두 살아있다.

## 6. MECE — 관심사 분리 & 중복 방지

### 6-1. base/rules 경계

| 질문 | Yes → base | Yes → rules |
|------|-----------|-------------|
| 런타임 변수(`{{{...}}}`)가 필요한가? | ✓ | |
| 동일 문장이 모든 컨텍스트에서 불변인가? | | ✓ |
| "하지 마라/반드시" 등 제약 표현인가? | | ✓ |
| 태스크 상태·입력 데이터를 서술하는가? | ✓ | |

혼합이 발생하면 문장 단위로 분리한다.

### 6-2. 기존 규칙 중복 검사 (수정 시 필수)

1. **Grep 먼저**: 추가하려는 핵심 키워드로 `templates/` 전체를 검색
2. **같은 관심사 규칙이 존재하면**: 신규 파일 생성 대신 기존 파일 강화
3. **부분 중복이면**: 공통 부분을 상위 rules로 올리고, 차이만 phase별 rules에 유지
4. **완전 중복이면**: 추가하지 않음

### 6-3. partial 주입 포인트 확인

새 partial을 만들었다면, 실제로 소비하는 상위 템플릿에서 `{{> partialName}}` 호출이 있는지 확인한다.
자동 등록(initPartials)은 파일을 partial로 등록할 뿐, 사용 여부는 보장하지 않는다.

## 7. 코드 수정 불필요

`initPartials()`가 서버 시작 시 `templates/` 하위 모든 `.md`를 자동 등록한다.
파일 추가/삭제/이름 변경 후 코드 변경 필요 없음.

## 8. 검증

```bash
pnpm test:cli
```

90개 템플릿 스모크 테스트 + 런타임 조립 유닛 테스트 실행. 실패하면 빌드 차단.
