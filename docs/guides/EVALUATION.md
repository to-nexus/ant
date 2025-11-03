# Code Evaluation

Optional quality analysis after code generation.

## Usage

```bash
# Generate code with evaluation
npm run dev -- arch code workspace/myapp/feature/ --eval

# Generate code without evaluation
npm run dev -- arch code workspace/myapp/feature/
```

## Workflow

```
resolve → decompose → plan → execute → 
writeFiles → validate → installDeps → 
runtimeValidate → evaluate → learn
                                          ↓
                (if --eval flag)
```

## Metrics

| Metric | Description | Range |
|--------|-------------|-------|
| Lines of Code | Total logical lines | - |
| Cyclomatic Complexity | Code complexity | 1-10 (Simple), 11-20 (Moderate), 21+ (Complex) |
| Maintainability Index | Maintainability score | 0-100 (85+: Excellent, 70-84: Good, 50-69: Moderate) |
| Comment Density | Comment ratio | 10-30% (Optimal) |

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
   ✅ Code quality is excellent!

═══════════════════════════════════════════════════════════
```

### Report Files

```
workspace/myapp/feature/outputs/eval/
├── report.json     # JSON report
└── report.md       # Markdown report
```

### report.md Example

```markdown
# Code Evaluation Report

**Generated**: 2025-10-31

## Summary

- Files: 5
- Total Lines: 342
- Avg Complexity: 8.2
- Avg Maintainability: 75.3/100
- Quality: Good

## Recommendations

✅ Code quality is excellent!

## File Details

### src/components/UserAuth.tsx
- Lines: 89 (logical: 75)
- Complexity: 7
- Maintainability: 78.5/100
- Comment Density: 12.3%
```

## Configuration

Optional evaluation config:

```
workspace/myapp/feature/inputs/directives/eval/
├── tests.json                # Requirements checklist (optional)
└── quality-thresholds.json   # Quality criteria (optional)
```

### tests.json

```json
{
  "name": "feature-evaluation",
  "tasks": [
    {
      "id": "req-1",
      "description": "User authentication implemented"
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

## Implementation

### Node Structure

```typescript
// src/agents/architect/graph/code/nodes/evaluate.ts
export async function evaluate(state: ArchitectGraphState) {
  // Skip if --eval flag not provided
  if (!context.enableEvaluation) {
    return state;  // No-op
  }
  
  // Analyze generated files
  const metrics = analyzeFiles(state.files);
  
  // Generate report
  const report = createReport(metrics);
  
  // Save to outputs/eval/
  saveReport(report);
  
  return { ...state, evaluationReport: report };
}
```

### Metrics Calculation

```typescript
// Lines of code
function countLines(code: string): number {
  return code.split('\n').filter(line => 
    line.trim() && !line.trim().startsWith('//')
  ).length;
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

✅ **Simple static analysis**
- No external dependencies
- Fast execution
- Language agnostic

✅ **Optional execution**
- Controlled by `--eval` flag
- No performance impact when disabled

✅ **Extensible**
- Custom quality thresholds
- Requirements checklist

## Limitations

**Does not run actual tests**

Reasons:
1. Requires dependency installation (`npm install`)
2. Requires build (`tsc`)
3. Requires environment setup (React rendering)
4. Complex, slow, and often fails

Alternative:
- Simple static analysis (complexity, MI)
- Requirements checklist (manual verification)
- User runs tests manually

```bash
# Run tests manually
cd /path/to/generated/code
npm install
npm test
```

## Design Decisions

### Why Simple Static Analysis?

**Complex approach** (not used):
- ❌ Run code in VM
- ❌ ESLint/Prettier dependencies
- ❌ Test framework execution
- ❌ Complex and unreliable

**Simple approach** (current):
- ✅ Static analysis only
- ✅ No dependencies
- ✅ Fast and stable
- ✅ Practical

### Why Integrated in Workflow?

**Separate agent** (not used):
- ❌ `Evaluator Agent` (separate agent)
- ❌ Regenerate code for testing
- ❌ Requires `aidev eval` command

**Workflow integration** (current):
- ✅ Integrated in Architect workflow
- ✅ Analyzes generated code immediately
- ✅ Simple `--eval` flag
