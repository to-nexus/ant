# Prompt System Test Specification

프롬프트 시스템 자동 테스트 사양. `pnpm test:cli` 한 줄로 전부 실행. 빌드 시 `prebuild`에서 자동 게이트.

---

## 테스트 계층 (MECE)

```
A. Coverage (도달성)
│  template-reverse-matrix.test.ts ─── 148개 .md 역방향 도달성 + JSON 매트릭스 생성
│  tech-tier-registry.test.ts ──────── TECH_TIER_TEMPLATE_PATHS ↔ 디스크 파일 동기화
│
B. Integrity (무결성)
│  invariant-audit.test.ts ─────────── manifest↔파일 일치, 레거시 변수 금지,
│                                      TS→템플릿 경로 역참조, resolve() 조합별 파일 존재
│  prompt-smoke.test.ts ────────────── partial 전수 등록, basis/ 포함 전 템플릿 렌더, manifest 일치
│
C. Injection Resolution (주입 경로)
│  injection-resolution-matrix.test.ts  Tier I/A/D/N 4계층 조합 매트릭스
│  intents/intent-acceptance.test.ts ── 16개 intent × required/forbidden injection + 스냅샷
│
D. Build Pipeline (빌드 파이프라인)
│  prompt-build-e2e.test.ts ────────── PromptBuilder.build() 8개 시나리오 E2E
│                                      Stage 1: 경로 해석 / Stage 2: 렌더 성공 / Stage 3: 내용 주입
│  artifact-injection-e2e.test.ts ──── 아티팩트 role별 주입 + directive 경로별 주입 정방향 E2E (12 시나리오)
│                                      + JSON 매트릭스 생성 (__generated__/artifact-injection-matrix.json)
│  artifact-injection-audit.test.ts ── build() 호출부 artifacts 전달 + decompose include 정적 감사 (단일 주입 SSOT)
│  prompt-integration.test.ts ──────── ArtifactPipeline, 문서 조립 시나리오
│  documents-pipeline-audit.test.ts ── 문서 파이프라인 회귀 미러
│
E. Hardening (강화)
│  prompt-immutability.test.ts ─────── resolve/render 입력 불변성
│  techtier-propagation.test.ts ────── decompose 경유/미경유 techTier 전파
│  threshold-boundary.test.ts ──────── EXECUTE/DECOMPOSE_SOURCE_THRESHOLD 경계값
│  rac-serialization.test.ts ───────── RAC JSON roundtrip 보존
│
F. Context & Routing (컨텍스트·라우팅)
│  runtime-context.test.ts ─────────── buildRuntimeContext, generateFileTree
│  triage-prompt.test.ts ──────────── buildTriagePrompt 구조 + 스냅샷
│  rac.test.ts ─────────────────────── resolveToRAC, deriveFromIntent
│  rac-matrix.test.ts ──────────────── config-matrix 완전성
│  rac-creation-audit.test.ts ──────── RAC 생성 (explicit/infer/derive)
│
G. Non-prompt (비프롬프트)
   triage-parser.test.ts, triage-guard.test.ts, classify-parser.test.ts,
   tool-registry.test.ts, command-allowlist.test.ts, content-compactor.test.ts,
   artifact-ownership-routing.test.ts, ask-knowledge.test.ts,
   batch-split-fix.test.ts, human-id.test.ts
```

---

## A. Coverage (도달성)

### template-reverse-matrix.test.ts

`templates/` 하위 148개 `.md` 파일 각각에 대해 7가지 도달 소스를 역추적한다.

| 소스 | 의미 |
|------|------|
| `build-callsite` | `promptBuilder.build()`의 `templates.base/rules/system`에 하드코딩 |
| `auto-injection` | `AutoInjectionResolver.resolve()` 조합적 전수 실행 결과 |
| `policy-map` | `POLICY_TEMPLATE_MAP`에 등록 (Tier I/N) |
| `render-call` | 에이전트 TS 코드에서 `render()`/`readFileSync()` 직접 호출 |
| `partial-ref` | 다른 템플릿의 `{{> path}}` Handlebars partial 참조 |
| `basis-registry` | `TECH_TIER_TEMPLATE_PATHS` 기반 `buildBasisSection` 주입 |
| `manifest` | `injection-manifest.json` 계약 등록 |

검증:
- **소스가 0개인 파일 = 고아 → 테스트 실패** (warn이 아닌 fail)
- injection 템플릿은 manifest에 등록 필수
- `tests/__generated__/template-matrix.json` 자동 생성 (디버깅·리뷰용)

### tech-tier-registry.test.ts

`@ant/shared`의 `TECH_TIER_TEMPLATE_PATHS` 레지스트리가 가리키는 경로와 디스크 `.md` 파일의 1:1 동기화 검증. 역방향 고아 파일도 탐지.

---

## B. Integrity (무결성)

### invariant-audit.test.ts

4개 감사 항목:

| ID | 검증 | 실패 시 |
|----|------|---------|
| 6A | manifest 엔트리가 AutoInjectionResolver, partial, POLICY_TEMPLATE_MAP, agent render 중 하나 이상에서 사용 | **fail** |
| 6B | 템플릿에 `{{designDoc}}`, `{{prdSpec}}`, `{{uiDoc}}` 레거시 변수 금지 | fail |
| 6C | 에이전트 TS 코드의 `render('path')`/`templates: { base: 'path' }` 경로에 `.md` 파일 존재 | fail |
| 6D | `AutoInjectionResolver.resolve()` 조합 전수 실행 결과의 모든 경로에 `.md` 파일 존재 | fail |

6C는 템플릿 리터럴의 `${var}` 변수를 UI suffix(`by-figma`/`by-desc`), 언어(`typescript`/`go`), tool name(`run_command`) 등으로 확장한다.

### prompt-smoke.test.ts

| 검증 | 대상 |
|------|------|
| partial 전수 로드 | `initPartials()` 실패 0건 |
| 전 템플릿 렌더 | **basis/ 포함** 148개 전수. `SAMPLE_VARS`로 에러 없이 비어있지 않은 출력 |
| manifest 일치 | `/injections/` 경로의 모든 `.md`가 manifest에 존재 |
| partial 참조 무결성 | `{{> path}}`가 가리키는 partial이 등록됨 |
| 카탈로그 참조 | design 템플릿의 `§` 참조가 정규 카탈로그 이름과 일치 |

---

## C. Injection Resolution (주입 경로)

### injection-resolution-matrix.test.ts

4계층 인젝션 시스템의 조합적 전수 검증:

| 계층 | 검증 |
|------|------|
| Tier I (Intent) | 모든 intent에 prompt-policy 존재, PolicyKey→경로 매핑 |
| Tier N (Artifact) | 아티팩트 유무에 따른 조건부 정책 활성/비활성 |
| Tier A (Auto-tech) | taskType × stack × mode × node 매트릭스 |
| Tier D (Data) | 12개 데이터 플래그별 주입 조건 (directive, memory, gitDiff...) |

### intents/intent-acceptance.test.ts

16개 fixture × 3단계:

| Stage | 검증 |
|-------|------|
| 1. Config Matrix | `getConfigSlots(intent)` 유효 |
| 2. RAC Routing | `resolveToRAC()` → agent/jobType/mode/intentGroup 일치 |
| 3. Prompt Build | `PromptBuilder.build()` → requiredInjections 포함, forbiddenInjections 배제, 스냅샷 |

---

## D. Build Pipeline (빌드 파이프라인)

### prompt-build-e2e.test.ts

프로덕션 5개 호출부를 미러링한 8개 시나리오:

| 시나리오 | pipeline 설정 | 핵심 검증 |
|----------|---------------|-----------|
| Code execute (default/feature) | full | system+basis+rules+injections+examples 전부 비어있지 않음 |
| Code execute (verification) | includeExamples=off | 정적 정책 스킵, injections에 tool-calling 미포함 |
| Code execute (error+fullstack) | includeExamples=off | preview-setup + backend-safety + behavioral-debugging |
| Code execute (refactor) | includeBasis=off | refactor-guidance + behavioral-debugging |
| Design system-design (FE) | includeBasis=on | Tier I frontend-guide, document-language |
| Design spec | minimal | 인젝션 0건 |
| Ask | no pipeline | base+rules만 |
| Plan | no techContext | Tier A/D 비활성 |

각 시나리오에서 **3단계 런타임 주입 검증**:

1. **Stage 1 (경로)**: `result.injections`에 기대 경로 포함/배제
2. **Stage 2 (렌더)**: `result.sections.failedTemplates` 0건
3. **Stage 3 (내용)**: `result.system`에 각 인젝션 템플릿의 핑거프린트 텍스트 존재

### artifact-injection-e2e.test.ts

아티팩트 role(`ref`/`context`/`directive`)별 주입과 directive 경로별 주입을 정방향으로 검증. 12개 시나리오:

| 시나리오 | 템플릿 | 핵심 검증 |
|----------|--------|-----------|
| A1. code execute: ref+context | code/execute/default | ref→Primary, context→Background, 교차 없음 |
| A2. code execute: ref only | code/execute/default | ref→Primary, Background 빈 헤더 |
| A3. code execute: context only | code/execute/default | context→Background, ref 부재 |
| A4. no artifacts, no resolvedAction | code/execute/default | Primary/Background 헤더 자체 없음 |
| A5. defensive bridge | code/execute/default | config.artifacts 없이 resolvedAction.artifacts만 → 브릿지 작동 |
| A6. spec: partial path | design/spec | result.user에 마커 (injections 아닌 partial 경로) |
| A7. verification | code/execute/verification | action-context 스킵 |
| A8. directive role: silent drop | code/execute/default | `role='directive'` 양쪽 모두 누락 |
| D1. code execute: directive truthy | code/execute/default | sections.injections에 `# Directive` |
| D2. code execute: directive empty | code/execute/default | directive 인젝션 없음 |
| D3. spec: runtimeContext | design/spec | result.user에 directive (partial 경로) |
| D4. plan: base template | plan/default | result.user에 directive (`{{directive}}` 직접) |

`tests/__generated__/artifact-injection-matrix.json` 자동 생성.

### artifact-injection-audit.test.ts

역방향 정적 감사 (7 케이스):

| 그룹 | 대상 파일 | 검증 |
|------|-----------|------|
| 2-A. build() 호출부 | code/execute/buildMessages, design/docGen/intent/system, design/docGen/intent/spec | `artifacts` 키워드 존재 |
| 2-B. decompose 노드 | code/decompose/responseParser, design/decompose/uiDesign·systemDesign·spec | `include` 키워드 존재 + `artifactPolicy` 부재 |

### prompt-integration.test.ts

`ArtifactPipeline`의 `selectArtifacts`, 문서 조립 시나리오 (taskType별 선택/배제).

### documents-pipeline-audit.test.ts

문서 파이프라인 로직의 회귀 미러 테스트. 실제 코드 패턴을 순수 함수로 복제하여 검증.

---

## E. Hardening (강화)

| 테스트 | 검증 |
|--------|------|
| prompt-immutability.test.ts | `resolve()`, `compactContent`, `resolveToRAC` 입력 불변성 |
| techtier-propagation.test.ts | decompose 경유/미경유 시 techTier 전파 + injection 결과 |
| threshold-boundary.test.ts | EXECUTE/DECOMPOSE_SOURCE_THRESHOLD 경계값 전환 |
| rac-serialization.test.ts | RAC JSON roundtrip: explicit/infer, special chars, undefined 필드 |

---

## F. Context & Routing (컨텍스트·라우팅)

| 테스트 | 검증 |
|--------|------|
| runtime-context.test.ts | `buildRuntimeContext`, `generateFileTree` 출력 문자열 |
| triage-prompt.test.ts | `buildTriagePrompt` system/user 구조 + 스냅샷 |
| rac.test.ts | `resolveToRAC`, `deriveFromIntent` 단위 테스트 |
| rac-matrix.test.ts | config-matrix 완전성, `resolveToRAC` 전수 |
| rac-creation-audit.test.ts | RAC 생성 (explicit/infer/derive) 변형 |

---

## 변경 시 워크플로우

### 템플릿(.md) 추가

1. `templates/` 아래 파일 생성
2. injection이면 `injection-manifest.json`에 추가
3. `pnpm test:cli` → `template-reverse-matrix`가 도달성 검증
4. 고아면 fail → 연결 코드(render 호출, partial 참조 등) 추가 필요

### 템플릿 삭제

1. 파일 삭제
2. `pnpm test:cli` → `invariant-audit` 6C가 참조 무결성 실패 감지
3. 코드에서 참조 제거 후 재실행

### AutoInjectionResolver 변경

1. 코드 수정
2. `pnpm test:cli` → injection-resolution-matrix + invariant-audit 6D가 경로 검증
3. intent-acceptance 스냅샷 diff 발생 시 `--update`

### PromptBuilder / 파이프라인 변경

1. 코드 수정
2. `pnpm test:cli` → prompt-build-e2e가 8개 시나리오 E2E 검증
3. intent-acceptance Stage 3이 injection 목록 스냅샷 비교

### 아티팩트/Directive 주입 변경

1. action-context.md, directive.md, PromptBuilder 브릿지, build() 호출부 수정
2. `pnpm test:cli` → artifact-injection-e2e가 12개 시나리오 role별 렌더 검증
3. artifact-injection-audit가 호출부 artifacts 전달 + decompose include 설정(및 artifactPolicy 부재) 감사
4. `artifact-injection-matrix.json` diff로 주입 경로 변화 추적

---

## TaskType별 injection 매트릭스

| injection | feature | setup | verification | error | test-code | doc |
|-----------|---------|-------|-------------|-------|-----------|-----|
| tool-calling-rules-compact | O | O | X | X | X | X |
| preview-setup (frontend) | O | O | X | O | X | X |
| preview-env-contract | O | O | O | O | X | X |
| port-management | O | O | O | O | X | X |
| backend-safety (backend) | O | O | X | O | O | X |
| visual-source-authority (frontend) | O | O | X | O | X | X |
| test-code hints | X | X | X | X | O | X |
| ui-source-dispatch | X(feature) | X | X | X | X | X |
| ui-source-dispatch (taskType=ui OR design-system) | O | - | - | - | O | - |

---

## 프롬프트 빌드 경로 맵

```
RAC 생성 ─→ Documents 파이프라인 ─→ PromptBuilder.build() (execute/docGen) ─→ LLM
                                  └→ promptBuilder.render() (plan/decompose/detect) ─→ LLM
```

- **build() 경로**: Tier I/A/D/N injection 해석 → system + profiles + rules + injections + examples 조립 → guardrails 래핑
- **render() 경로**: 단일 템플릿 직접 렌더링 (plan, decompose, detect, revise, triage, visual, learn)

---

## 참조

- 프롬프트 시스템 아키텍처: `docs/architecture/13-prompt-system.md`
- RAC 타입: `packages/ant-shared/src/rac.ts`
- PromptBuilder: `packages/ant-cli/src/core/prompt/builder/PromptBuilder.ts`
- AutoInjectionResolver: `packages/ant-cli/src/core/prompt/builder/AutoInjectionResolver.ts`
- ArtifactRoleResolver: `packages/ant-cli/src/core/prompt/builder/ArtifactRoleResolver.ts`
- prompt-policy-matrix: `packages/ant-shared/src/prompt-policy-matrix.ts`
- injection-manifest: `packages/ant-cli/src/core/prompt/injection-manifest.json`
- 자동 생성 매트릭스: `packages/ant-cli/tests/__generated__/template-matrix.json`
- 아티팩트 주입 매트릭스: `packages/ant-cli/tests/__generated__/artifact-injection-matrix.json`
