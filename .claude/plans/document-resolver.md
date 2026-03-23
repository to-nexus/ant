# Task 문서 주입 규칙 명시화 플랜

## Context

`packages`와 task type은 독립적인 두 축:
- `packages` = 코드 스코프 (어떤 tier/패키지를 건드리나) → system design 주입 파라미터
- task type = 문서 카테고리 결정자 (어떤 종류의 docs가 필요한가)

현재 이 규칙이 암묵적으로 작동하지만 3개 파일에 분산되어 동일 개념을 중복 구현 중.
`documentResolver.ts` 하나로 집중시켜 명시화.

**버그 하나 존재**: ui task + parsedUiDocs 없음 → `planGeneration.ts`가 system design을 fallback으로 주입.
현재 정상 경로(ui-spec.json 존재)에서는 발현 안 됨.

---

## 전체 매트릭스

### task type × 문서 주입

| task type | packages 기대값 | system design 주입 | ui-doc 주입 | 비고 |
|-----------|---------------|-------------------|------------|------|
| `feature` | fe-main / be-main / 조합 | ✅ packages 기반 | ❌ | |
| `setup` | fe-main, be-main, shared 조합 | ✅ packages 기반 | ❌ | shared → api-contract만 |
| `test-code` | fe-main / be-main | ✅ packages 기반 | ❌ | |
| `doc` | fe-main / be-main | ✅ packages 기반 | ❌ | |
| `ui` | fe-{name} (존재하지만 무시됨) | ❌ | ✅ uiSections 필터 | parsedUiDocs 없으면 → 아무것도 없음 (버그 수정) |
| `design-system` | fe-{name} (존재하지만 무시됨) | ❌ | ✅ uiSections 필터 | decompose가 uiSections: ['tokens'] 설정 |
| `error` | 원래 task와 동일 | ❌ | ❌ | selectedSpec 있으면 spec을 designDoc으로 주입 (기존 특수 처리 유지) |
| `verification` | 없음 | ❌ | ❌ | |

### monorepo / multi-package packages 조합 → 주입 결과

`buildDesignDocForTask()`가 packages 배열을 루프하므로 임의 조합 대응. 코드 변경 없음.

| packages 예시 | 주입 결과 | 시나리오 |
|--------------|---------|---------|
| `['fe-main']` | fe-system-main.md + api-contracts | 싱글 fe |
| `['be-main']` | be-system-main.md + api-contracts | 싱글 be |
| `['fe-main', 'be-main']` | fe+be system-main.md + api-contracts | 싱글 fullstack |
| `['fe-auth', 'fe-dashboard']` | fe-system-auth.md + fe-system-dashboard.md + api-contracts | fe monorepo, 여러 패키지 동시 접근 |
| `['be-auth', 'be-payments']` | be-system-auth.md + be-system-payments.md + api-contracts | MSA, 여러 서비스 접근 |
| `['fe-auth', 'be-auth', 'shared']` | fe-system-auth.md + be-system-auth.md + api-contracts | fullstack + shared (shared는 api-contract 이미 포함이라 추가 없음) |
| `['shared']` | api-contracts만 | shared/DTO 전용 작업 |
| `['fe-nonexistent']` | api-contracts만 | 존재하지 않는 패키지 → graceful skip |
| `[]` 또는 미지정 | 전체 fe+be system design + api-contracts | fallback (decompose 버그 시) |

> `shared` 단독 또는 조합 시: api-contract-*.md는 어떤 packages 지정이든 항상 주입됨. `shared`는 "추가로 api-contract를 요청"하는 게 아니라 "이 패키지의 system design은 api-contract다"를 의미.

> ui/design-system task에 monorepo packages(`['fe-auth', 'fe-dashboard']`)가 설정되어 있어도 resolver가 `''` 반환 → 무시됨. ui-doc만 주입.

---

## 변경 파일

### 1. 신규: `documentResolver.ts`
`src/agents/architect/graph/code/nodes/documentResolver.ts`

```typescript
/**
 * Two independent axes:
 *   packages  → code scope  → system design injection
 *   task type → doc category → ui-doc injection
 */
export function resolveDesignDocForTask(task: CodeTask, state: ArchitectGraphState): string {
  // visual tasks: system design irrelevant
  if (task.type === 'ui' || task.type === 'design-system') return '';
  // diagnostic tasks: no design context
  if (task.type === 'verification' || task.type === 'error') return '';

  // spec-driven jobs: selectedSpec takes priority over packages
  // (planGeneration.ts:65-75 기존 분기 — 누락 시 PRD 기반 작업 regression)
  if (state.selectedSpec && state.specDocs?.[state.selectedSpec]) {
    const parts = [`# Feature Specification (Primary)\n\n${state.specDocs[state.selectedSpec]}`];
    if (state.designDocs?.apiContracts) {
      for (const [name, content] of Object.entries(state.designDocs.apiContracts)) {
        parts.push(`# API Contract: ${name} (Reference)\n\n${content}`);
      }
    }
    return parts.join('\n\n────────────────────────────────────────\n\n');
  }

  // feature/setup/test-code/doc: system design via packages
  if (task.packages?.length && state.designDocs) {
    return buildDesignDocForTask(task.packages, state.designDocs);
  }
  return state.design || '';
}

export function resolveUiDocForTask(task: CodeTask, state: ArchitectGraphState): string | undefined {
  if (task.type !== 'ui' && task.type !== 'design-system') return undefined;
  if (!state.parsedUiDocs) return undefined;
  return ArtifactService.getUiDocForTask(state.parsedUiDocs, task.uiSections);
}
```

### 2. `planGeneration.ts`
`src/agents/architect/graph/code/nodes/plan/planGeneration.ts`

`resolveDesignDoc()` 내부 → `resolveDesignDocForTask()` 위임. **호출 지점 2개** (line 116, 153) 모두 교체.
- design-system 분기 제거 (resolver가 처리)
- **ui fallback 버그 제거**: ui + no parsedUiDocs → '' (system design 주입 안 함)
- selectedSpec 분기는 resolver 내부로 이동 (PRD 기반 작업 유지)

### 3. `promptBuilder.ts`
`src/agents/architect/graph/code/nodes/codeGen/promptBuilder.ts`

- `isUiTask` 분기, `uiDocForTask` 블록 → `resolveDesignDocForTask()` / `resolveUiDocForTask()` 호출로 교체
- error + selectedSpec 특수 처리는 유지 (lines 141-144)
- condense 로직 유지 (designDoc 크기 최적화)

---

## 변경하지 않는 것

- `packages` 필드 의미 및 값: 변경 없음
- `uiSections` 필드: 변경 없음
- `buildDesignDocForTask()`, `ArtifactService.getUiDocForTask()`: 그대로 재사용
- decompose 프롬프트: 변경 없음
- shared 패키지 처리: 변경 없음
- `plan/index.ts:836` getUiDocForTask 호출: 이미 올바른 패턴, 변경 불필요

---

## 검증

| 케이스 | 기대 결과 |
|--------|---------|
| feature `packages:['fe-main']` | system design 주입, ui-doc 없음 |
| setup `packages:['fe-main','be-main','shared']` | fe+be system design + api-contract 주입 |
| setup `packages:['shared']` | api-contract만 주입 |
| ui + parsedUiDocs 있음 | ui-doc 주입, system design 없음 |
| **ui + parsedUiDocs 없음** | **아무것도 주입 안 함 (버그 수정)** |
| design-system + parsedUiDocs 있음 | ui-doc(tokens) 주입, system design 없음 |
| error + selectedSpec | spec doc 주입 (기존 특수 처리 유지) |
| verification | 아무것도 주입 안 함 |

`pnpm test` 통과 확인.
