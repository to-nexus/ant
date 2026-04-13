# Prompt System Test Specification

프롬프트 시스템 자동 테스트 사양. `pnpm test:cli` 한 줄로 전부 실행. 빌드 시 `prebuild`에서 자동 게이트.

---

## 테스트 계층

```
├── Intent Acceptance ── intent-acceptance.test.ts
│                        getConfigSlots(intent) → RAC → PromptBuilder.build() 전체 경로
│
├── Safety Gate ──── prompt-smoke.test.ts           partial 등록, 템플릿 렌더, manifest 무결성
│                    runtime-context.test.ts         buildRuntimeContext, generateFileTree
│
├── Audit (전수조사) ── injection-resolution-matrix.test.ts  4-tier injection 조합 매트릭스
│                       rac-creation-audit.test.ts           RAC 생성 (explicit/infer/derive) (~60+)
│                       rac-matrix.test.ts                   config matrix 완전성 + resolveToRAC
│
├── Hardening ──── threshold-boundary.test.ts (11)  경계값 전환
│                  rac-serialization.test.ts   (7)  JSON roundtrip 보존
│                  prompt-immutability.test.ts       입력 mutation 방지
│                  techtier-propagation.test.ts      decompose 경유/비경유 techTier 전파
│
└── 기타 ──── rac.test.ts, triage-*.test.ts 등
```

---

## Intent Acceptance

16개 fixture에 대해 디렉티브·`ActionMetadata`(intent, refs, context 등) 조합을 준비하고, 디렉티브 입력 → RAC 생성 → 프롬프트 빌드 전체 경로를 자동 검증한다. 서버/LLM 없이 순수 함수 호출만으로 실행.

| 파일 | 역할 |
|------|------|
| `tests/intents/dataset.ts` | 16개 fixture + 테스트용 샘플 문서 |
| `tests/intents/intent-acceptance.test.ts` | vitest 자동 테스트 |
| `tests/intents/documents/` | 테스트용 최소 문서 (prd, fe-system, be-system 등 8개) |
| `docs/testing/e2e-intent-reference.md` | 수동 E2E curl 레퍼런스 (자동 테스트 아님) |

### 검증 3단계

```
Stage 1: Config Matrix      getConfigSlots(intent) → null 아닌지

Stage 2: RAC Routing         resolveToRAC(intentId, slots, source) → RAC 생성
                             deriveFromIntent(intent) → agent/jobType 일치
                             RAC.mode, intentGroup 일치
                             refs/context 필드 보존

Stage 3: Prompt Build        PromptBuilder.build(config) → PromptBuildResult
  (code/design만)            requiredInjections 포함 확인
                             forbiddenInjections 배제 확인
                             mustContain 키워드 프롬프트 텍스트에 포함
                             injection 목록 스냅샷 비교 (회귀 방지)
```

- **Stage 1-2**: 모든 16개 fixture에 대해 실행 (plan 포함)
- **Stage 3**: code/design job만 실행 (plan은 별도 빌더 사용)

### 왜 서버 없이 가능한가

테스트는 파이프라인의 순수 함수들만 직접 호출한다:

```
resolveToRAC(intentId, slots)                ← 순수 함수, IntentId + slots → RAC
PromptBuilder.build(PromptBuildConfig)       ← 4-tier injection 해석 + 템플릿 렌더링
AutoInjectionResolver.resolve(input)         ← Tier A+D injection 결정
deriveArtifactPolicies(intent, artifacts)    ← Tier N 정책 도출
```

HTTP, Redis, BullMQ, LLM 호출이 전혀 없다. `AutoInjectionResolver`의 injection 선택 로직(environment 판단, language 감지, refactor/behavioral-debugging 등)이 RAC와 techContext를 기반으로 deterministic하게 동작하므로 스냅샷 테스트가 가능하다.

### 프롬프트 변경 시 워크플로우

```
1. 템플릿/AutoInjectionResolver/RAC/prompt-policy-matrix 변경
2. pnpm test:cli → 스냅샷 diff 발생 (FAIL)
3. diff 검토: 의도한 변경인지 확인
4. pnpm vitest run tests/intents/intent-acceptance.test.ts --update
5. 새 스냅샷 커밋
```

### Fixture 커버리지

| Intent | Stage 3 |
|--------|---------|
| gen-plan | - (plan job) |
| rev-plan | - (plan job) |
| gen-sys-fe | design |
| gen-sys-be | design |
| gen-sys-full | design |
| rev-sys | design |
| gen-ui-figma | design |
| gen-ui-ref | design |
| gen-ui-desc | design |
| rev-ui | design |
| gen-spec | design |
| rev-spec | design |
| gen-code-sys | code |
| gen-code-spec | code |
| gen-code-directive | code |
| rev-code | code |

---

## Safety Gate

프롬프트 변경 시 최소 안전망. 모든 `.md` 템플릿이 렌더 가능한지, manifest와 일치하는지 확인.

| 테스트 | 파일 | 검증 |
|--------|------|------|
| Partial 등록 | `prompt-smoke.test.ts` | partials 전수 로드 |
| 템플릿 smoke | `prompt-smoke.test.ts` | 모든 .md 비어있지 않음 |
| Manifest 무결성 | `prompt-smoke.test.ts` | injection → .md 파일 존재 |
| 런타임 조립 | `runtime-context.test.ts` | buildRuntimeContext 출력 검증 |

### 개발자 워크플로우

```
1. 템플릿(.md) 또는 조립 함수 수정
2. pnpm test:cli          ← 수동 확인 (~1초)
3. PASS → 커밋
4. pnpm build             ← prebuild가 자동으로 테스트 실행
5. FAIL → 빌드 중단 (dist/ 미생성)
```

### 새 템플릿 추가 시

1. `templates/<job>/phases/<phase>/<type>.md` 생성
2. injection이면 `injection-manifest.json`에 추가
3. `pnpm test:cli`로 검증

---

## Audit (전수조사)

7개 축 기반 전수 검증. 프롬프트 시스템 변경 시 해당 감사 재실행.

| 트리거 | 실행 범위 |
|--------|-----------|
| injection-manifest.json 변경 | Smoke + Injection Matrix |
| AutoInjectionResolver 변경 | Injection Resolution Matrix |
| rac.ts 변경 | RAC Audit (rac-creation-audit, rac-matrix) |
| prompt-policy-matrix 변경 | Injection Resolution Matrix + Intent Acceptance |
| PromptBuilder 변경 | Intent Acceptance Stage 3 |
| 템플릿 추가/삭제 | Smoke + Injection Resolution Matrix |

### 7개 축

1. **Source**: explicit / infer / infer+metadata / none
2. **Intent**: 대표 intent → mode/intentGroup 파생
3. **Stack**: frontend / backend / fullstack / none (techTier 기반)
4. **Language**: typescript / go / python / rust / java
5. **TaskType**: feature / setup / verification / error / test-code / doc
6. **Documents**: none / design-only / design+prd / full / explicit-refs
7. **Context Flags**: hasMemory, hasDirective, retryContext, lessons, sessionContext 등 12개

### TaskType별 injection 매트릭스

| injection | feature | setup | verification | error | test-code | doc |
|-----------|---------|-------|-------------|-------|-----------|-----|
| env-specific rules | O | O | X | X | X | X |
| tool-calling-rules-compact | O | O | X | X | X | X |
| preview-setup (browser/fs) | O | O | X | O | X | X |
| preview-env-contract | O | O | O | O | X | X |
| port-management | O | O | O | O | X | X |
| backend-safety (be/fs) | O | O | X | O | O | X |
| test-code hints | X | X | X | X | O | X |
| visual-source-authority | O | O | X | O | X | X |

### 프롬프트 빌드 경로 맵

```
RAC 생성 ─→ Documents 파이프라인 ─→ PromptBuilder.build() (execute/docGen) ─→ LLM
                                  └→ promptBuilder.render() (plan/decompose/detect) ─→ LLM
```

- **build() 경로**: 4-Tier injection 해석 → system + profiles + rules + injections + examples 조립 → guardrails 래핑
- **render() 경로**: 단일 템플릿 직접 렌더링 (plan, decompose, detect, revise 등)

---

## Hardening

전수조사가 커버하지 못한 영역: 경계값, 직렬화, mutation, techTier 전파.

### 경계값 (threshold-boundary, 11 tests)

| 대상 | at threshold | at threshold+1 |
|------|-------------|----------------|
| EXECUTE_SOURCE_THRESHOLD (200K) | inline mode | tool mode |
| DECOMPOSE_SOURCE_THRESHOLD (200K) | inline, individual docs | tool, index only |
| condenseContent (30K) | 원본 유지 | condensed outline |

### 직렬화 (rac-serialization, 7 tests)

| RAC 유형 | 검증 |
|----------|------|
| explicit + full fields | 모든 필드 동일 |
| infer + minimal | source, mode 보존 |
| special chars in documents | newlines, unicode, backticks 무손실 |
| undefined fields | 키 사라짐 허용, null 변환 금지 |

### Immutability (prompt-immutability)

| 대상 | 검증 |
|------|------|
| AutoInjectionResolver.resolve | input 불변 |
| condenseContent | options 불변 |
| resolveToRAC | inputs 불변 |
| sanitizeInjectionVars | 원본 vars 불변 |

### TechTier Propagation (techtier-propagation)

| 시나리오 | 검증 |
|----------|------|
| decompose 경유 (code/design) | buildTechTier → state.techTier → effectiveTechTier → profile injection |
| decompose 미경유 (plan/ask/visual) | techTier 없이도 injection 정상 |
| resolveTaskTechTiers | 태스크별 techTiers 올바른 선택 |

---

## 참조

- 프롬프트 시스템 아키텍처: `docs/architecture/13-prompt-system.md`
- RAC 타입: `packages/ant-shared/src/rac.ts`
- PromptBuilder: `packages/ant-cli/src/core/prompt/builder/PromptBuilder.ts`
- AutoInjectionResolver: `packages/ant-cli/src/core/prompt/builder/AutoInjectionResolver.ts`
- ArtifactRoleResolver: `packages/ant-cli/src/core/prompt/builder/ArtifactRoleResolver.ts`
- prompt-policy-matrix: `packages/ant-shared/src/prompt-policy-matrix.ts`
- injection-manifest: `packages/ant-cli/src/core/prompt/injection-manifest.json`
