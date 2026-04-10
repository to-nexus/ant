# Prompt System Test Specification

프롬프트 시스템 자동 테스트 사양. `pnpm test:cli` 한 줄로 전부 실행. 빌드 시 `prebuild`에서 자동 게이트.

---

## 테스트 계층

```
889 tests (전체)
├── Safety Gate ──── prompt-smoke.test.ts (25)     partial 등록, 템플릿 렌더, manifest 무결성
│                    runtime-context.test.ts        buildRuntimeContext, generateFileTree
│
├── Audit (전수조사) ── injection-audit.test.ts     ModeController 전축 매트릭스 (~200+)
│                       rac-creation-audit.test.ts  RAC 생성 (explicit/infer/derive) (~60+)
│                       documents-pipeline-audit    문서 조합 파이프라인 (~30+)
│                       direct-render-audit         직접렌더 경로 (~25+)
│                       e2e-prompt-audit            E2E 렌더 + 불변식 (~25+)
│                       invariant-audit             정적 무결성 (~20+)
│
├── Hardening ──── threshold-boundary.test.ts (11)  경계값 전환
│                  rac-serialization.test.ts   (7)  JSON roundtrip 보존
│                  prompt-immutability.test.ts (12)  입력 mutation 방지
│                  prompt-integration.test.ts  (17)  resolver + 문서 조합 + 엔진
│                  template-golden.test.ts     (12)  프롬프트 전문 스냅샷
│
└── 기타 ──── rac.test.ts, triage-*.test.ts, rac-matrix.test.ts 등
```

---

## Safety Gate

프롬프트 변경 시 최소 안전망. 모든 `.md` 템플릿이 렌더 가능한지, manifest와 일치하는지 확인.

| 테스트 | 파일 | 검증 |
|--------|------|------|
| Partial 등록 | `prompt-smoke.test.ts` | 142개 partials 로드 |
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
| injection-manifest.json 변경 | Audit 1 + 6 |
| ModeController 변경 | Audit 1 전체 |
| rac.ts 변경 | Audit 2 |
| promptBuilder 변경 | Audit 3 |
| 템플릿 추가/삭제 | Audit 5 + 6 |

### 7개 축

1. **Source**: explicit / infer / infer+metadata / none
2. **Intent**: 16개 intent → jobMode/workType/environment 파생
3. **Environment**: browser / node-api / go-api / fullstack / node-cli / go-cli
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
RAC 생성 ─→ Documents 파이프라인 ─→ 6-Layer Pipeline (execute) ─→ LLM
                                  └→ Direct Render (plan/decompose/detect) ─→ LLM
```

- **6-Layer**: InputNormalizer → ContextAssembler → ModeController → TemplateComposer → PolicyInjector → PromptFormatter
- **Direct Render**: `buildTaskPlanPrompt`, `buildVerificationPlanPrompt`, `buildDecomposePrompt` 등

---

## Hardening

전수조사가 커버하지 못한 영역: 경계값, 직렬화, mutation, 실제 통합, 프롬프트 전문 회귀.

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
| infer + minimal | source, jobMode, tech 보존 |
| special chars in documents | newlines, unicode, backticks 무손실 |
| undefined fields | 키 사라짐 허용, null 변환 금지 |

### Immutability (prompt-immutability, 12 tests)

| 대상 | 검증 |
|------|------|
| ModeController.determineMode | context, resolvedAction 불변 |
| ContextAssembler.assemble | artifacts, resolvedAction 불변 |
| prepareDesignDocument | state.designDocs 불변 |
| condenseContent | options 불변 |
| resolveFromExplicit / resolveFromInfer | inputs 불변 |

### 통합 (prompt-integration, 17 tests)

| # | 시나리오 | 핵심 검증 |
|---|---------|----------|
| 1 | infer + designDoc + prd + ui | documents 3건, paths 정확 |
| 2 | explicit + documents | bypass infer, 원본 유지 |
| 3 | verification | prd/ui skip |
| 4 | error + selectedSpec | spec + apiContract 조합 |
| 5 | design + source-docs | base-system-design 템플릿 |
| 6 | plan + documents | plan prompt에 문서 포함 |
| 7 | decompose fe+be | 개별 ResolvedDocument |
| 8 | sourceDocuments | 소스문서 합성 |

### Golden Prompt (template-golden, 12 tests)

스냅샷 기반 회귀 방지. PR에서 프롬프트 diff를 리뷰 가능.

| # | 시나리오 | 스냅샷 대상 |
|---|---------|-----------|
| 1-7 | 기존 (infer/go/explicit/directive-only/design/plan/decompose) | injections + text |
| 8 | explicit + refactor | refactor-guidance + behavioral-debugging |
| 9 | error + frontend | preview-setup |
| 10 | test-code + backend | test-code hints + backend-safety |
| 11 | design: api-contract | api-contract-guide |
| 12 | verification plan | buildVerificationPlanPrompt 전문 |

스냅샷 최초 생성 후 **사람이 읽고 "이 프롬프트가 맞다"를 확인**한 후 커밋.

---

## 참조

- 프롬프트 시스템 아키텍처: `docs/architecture/13-prompt-system.md`
- RAC 타입: `packages/ant-shared/src/rac.ts`
- ModeController: `packages/ant-cli/src/core/prompt/engine/ModeController.ts`
- injection-manifest: `packages/ant-cli/src/core/prompt/injection-manifest.json`
