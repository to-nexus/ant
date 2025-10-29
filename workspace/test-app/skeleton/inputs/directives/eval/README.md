# Evaluation Tests

이 디렉토리는 Architect Agent가 생성한 코드를 자동으로 평가하기 위한 테스트 케이스를 정의합니다.

## 파일 구조

- `tests.json` - 기본 평가 테스트 케이스
- `quality-thresholds.json` - 품질 메트릭 임계값 설정 (선택사항)

## tests.json 작성 방법

```json
{
  "name": "feature-name-eval",
  "description": "평가 설명",
  "type": "codegen" | "refactor" | "bugfix",
  "language": "typescript" | "javascript" | "python" | ...,
  "tasks": [
    {
      "id": "test-task-1",
      "description": "테스트 설명",
      "prompt": "테스트할 내용",
      "testCases": [
        {
          "id": "test-case-1",
          "description": "테스트 케이스 설명",
          "assertions": [
            "// 테스트 assertion 코드",
            "assert.equal(result, expected)"
          ],
          "timeout": 5000
        }
      ],
      "metadata": {
        "difficulty": "easy" | "medium" | "hard",
        "tags": ["tag1", "tag2"],
        "source": "project"
      }
    }
  ]
}
```

## 자동 평가 실행

### 1. 코드 생성과 동시에 평가 (권장)

```bash
# --eval 옵션으로 코드 생성 후 자동 평가
aidev architect code workspace/test-app/skeleton/ --eval
```

### 2. 수동 평가 실행

```bash
# 이미 생성된 코드 평가
aidev eval workspace/test-app/skeleton/inputs/directives/eval/tests.json \
  --project test-app \
  --output workspace/test-app/skeleton/outputs/eval/report.md
```

## 품질 임계값 설정 (선택사항)

`quality-thresholds.json` 파일을 만들어 최소 품질 기준을 설정할 수 있습니다:

```json
{
  "minPassRate": 0.8,
  "minMaintainabilityIndex": 65,
  "maxComplexity": 20,
  "maxLintErrors": 0,
  "maxLintWarnings": 5
}
```

임계값 미달 시 빌드를 실패시킬 수 있습니다.

## 평가 결과

평가 결과는 `outputs/eval/` 디렉토리에 저장됩니다:

- `report.md` - 사람이 읽기 쉬운 마크다운 리포트
- `report.json` - 기계가 읽기 쉬운 JSON 리포트
- `metrics.json` - 상세 메트릭 데이터

## 예시: React Component 평가

```json
{
  "name": "button-component-eval",
  "description": "Button 컴포넌트 평가",
  "type": "codegen",
  "language": "typescript",
  "tasks": [
    {
      "id": "button-render",
      "description": "Button이 올바르게 렌더링되는지 테스트",
      "prompt": "Button 컴포넌트 렌더링 테스트",
      "testCases": [
        {
          "id": "test-basic-render",
          "description": "기본 렌더링",
          "assertions": [
            "const button = render(<Button>Click me</Button>)",
            "assert(button.getByText('Click me'))"
          ]
        },
        {
          "id": "test-click-handler",
          "description": "클릭 핸들러 동작",
          "assertions": [
            "const handleClick = jest.fn()",
            "const button = render(<Button onClick={handleClick}>Click</Button>)",
            "button.getByText('Click').click()",
            "assert(handleClick.mock.calls.length === 1)"
          ]
        }
      ]
    }
  ]
}
```

## CI/CD 통합

GitHub Actions 예시:

```yaml
- name: Run code generation
  run: aidev architect code workspace/myapp/feature1/ --eval

- name: Check evaluation results
  run: |
    if [ ! -f workspace/myapp/feature1/outputs/eval/report.json ]; then
      echo "Evaluation failed"
      exit 1
    fi
    
    # pass rate 체크
    PASS_RATE=$(jq '.passRate' workspace/myapp/feature1/outputs/eval/report.json)
    if (( $(echo "$PASS_RATE < 0.8" | bc -l) )); then
      echo "Pass rate too low: $PASS_RATE"
      exit 1
    fi
```

