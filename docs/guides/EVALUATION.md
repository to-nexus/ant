# Code Evaluation

코드 생성 후 품질을 자동으로 분석하는 옵션 기능입니다.

## Quick Start

```bash
# 코드 생성 + 평가
npm run dev arch-code workspace/myapp/feature/ --eval

# 평가 없이 코드만 생성
npm run dev arch-code workspace/myapp/feature/
```

## Workflow

```
resolve → plan → execute → validate → evaluate → learn
                                          ↓
                                    --eval 플래그 시:
                                    - 코드 메트릭 분석
                                    - 품질 리포트 생성
                                    - 요구사항 체크리스트
```

## Metrics

| 메트릭 | 설명 | 범위 |
|-------|------|------|
| Lines of Code | 총 라인 수 (논리적) | - |
| Cyclomatic Complexity | 코드 복잡도 | 1-10 (Simple), 11-20 (Moderate), 21+ (Complex) |
| Maintainability Index | 유지보수성 | 0-100 (85+: Excellent, 70-84: Good, 50-69: Moderate) |
| Comment Density | 주석 비율 | 10-30% (Optimal) |

## Configuration

### Directory Structure

```
workspace/myapp/feature/
├── inputs/directives/eval/
│   ├── tests.json                # 요구사항 체크리스트 (선택)
│   └── quality-thresholds.json   # 품질 기준 (선택)
└── outputs/eval/
    ├── report.json               # JSON 리포트
    └── report.md                 # Markdown 리포트
```

### tests.json

```json
{
  "name": "feature-evaluation",
  "tasks": [
    {
      "id": "req-1",
      "description": "사용자 인증 기능 구현"
    }
  ]
}
```

### quality-thresholds.json

```json
{
  "minMaintainabilityIndex": 70,
  "maxComplexity": 20,
  "enforceOnFail": false
}
```

## Output

### Console

```
🔬 Evaluating generated code...

═══════════════════════════════════════════════════════════
📊 EVALUATION SUMMARY
═══════════════════════════════════════════════════════════

📈 Code Metrics:
   Files:           5
   Total Lines:     342
   Complexity:      8.2
   Maintainability: 75.3/100
   Quality:         GOOD

💡 Recommendations:
   ✅ 코드 품질이 우수합니다!

📋 Requirements (3 items):
   Please verify manually in the report

═══════════════════════════════════════════════════════════
```

### report.md

```markdown
# Code Evaluation Report

**Generated**: 2025-10-29 14:30:00

## Summary

- Files: 5
- Total Lines: 342
- Avg Complexity: 8.2
- Avg Maintainability: 75.3/100
- Quality: Good

## Recommendations

✅ 코드 품질이 우수합니다!

## Requirements Checklist

- [ ] **req-1**: 사용자 인증 기능 구현

## File Details

### src/components/UserAuth.tsx
- Lines: 89 (논리적: 75)
- Complexity: 7
- Maintainability: 78.5/100
- Comment Density: 12.3%
```

## Implementation

### Architecture

**Evaluation은 Architect workflow의 일부**:

```typescript
// src/agents/architect/graph/code/graph.ts
graph.addEdge("validate", "evaluate");
graph.addEdge("evaluate", "learn");

// src/agents/architect/graph/code/nodes/evaluate.ts
export async function evaluate(state: ArchitectGraphState) {
  // Skip if not enabled
  if (!context.enableEvaluation) {
    return state;  // No-op
  }
  
  // Analyze code from state.files
  const generatedFiles = state.files.map(f => ({
    path: f.path,
    content: f.content
  }));
  
  // Calculate metrics
  const metrics = analyzeFiles(generatedFiles);
  
  // Generate report
  const report = createReport(metrics);
  
  // Save to outputs/eval/
  saveReport(report);
  
  return { ...state, evaluationReport: report };
}
```

### Code Metrics

```typescript
// src/agents/architect/utils/codeMetrics.ts

// Lines of code
function countLines(code: string): number {
  return code.split('\n').length;
}

// Cyclomatic complexity
function calculateComplexity(code: string): number {
  let complexity = 1;
  complexity += (code.match(/\bif\b|\bfor\b|\bwhile\b/g) || []).length;
  complexity += (code.match(/&&|\|\|/g) || []).length;
  return complexity;
}

// Maintainability index (simplified)
function estimateMaintainabilityIndex(code: string): number {
  const loc = countLines(code);
  const complexity = calculateComplexity(code);
  return Math.max(0, 171 - 5.2 * Math.log(loc) - 0.23 * complexity);
}
```

## Features

✅ **간단한 정적 분석**
- 외부 의존성 없음
- 빠른 실행
- 모든 언어 지원

✅ **선택적 실행**
- `--eval` 플래그로 제어
- 플래그 없으면 스킵 (no-op)

✅ **확장 가능**
- 품질 기준 커스터마이징
- 요구사항 체크리스트

## Limitations

❌ **실제 테스트 실행 안함**

**이유**:
1. 의존성 설치 필요 (npm install)
2. 빌드 필요 (TypeScript → JavaScript)
3. 환경 설정 필요 (React 렌더링)
4. 복잡하고 느리며 자주 실패

**대안**:
- 간단한 정적 분석 (복잡도, MI)
- 요구사항 체크리스트 (수동 확인)
- 사용자가 직접 테스트 실행

```bash
# 기능 테스트는 수동으로
cd workspace/myapp/feature
npm test
```

## Design Decisions

### Why Simple Static Analysis?

**Before (복잡한 방식)**:
- ❌ VM에서 코드 실행
- ❌ ESLint/Prettier 의존성
- ❌ 테스트 프레임워크 실행
- ❌ 복잡하고 자주 실패

**After (단순한 방식)**:
- ✅ 정적 분석만
- ✅ 의존성 없음
- ✅ 빠르고 안정적
- ✅ 실용적

### Why Integrated in Workflow?

**Before (별도 Agent)**:
- ❌ `Evaluator Agent` (별도 agent)
- ❌ 코드를 다시 생성해서 테스트
- ❌ `aidev eval` 명령 필요

**After (Workflow 통합)**:
- ✅ Architect workflow에 통합
- ✅ 생성된 코드를 바로 분석
- ✅ `--eval` 플래그만 사용

---

**더 자세한 워크플로우는 [WORKFLOW_GUIDE.md](guides/WORKFLOW_GUIDE.md)를 참고하세요.**

