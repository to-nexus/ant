# Demo App - ANT Framework 전체 워크플로우 데모

이 프로젝트는 ANT Framework의 **전체 워크플로우**를 실습할 수 있는 완전한 데모입니다.

## 🎯 목적

실제 프로젝트처럼 PRD → Design → Code → Evaluation까지 전체 플로우를 체험합니다.

## 📁 구조

```
demo-app/
├── README.md                    # 이 파일
├── config.json                  # 프로젝트 설정
├── common/                      # 공통 학습 데이터
└── features/
    ├── todo-list/              # Feature 1: Todo List (간단)
    │   ├── inputs/
    │   │   ├── sources/
    │   │   │   └── prd.md      # ✅ PRD (요구사항)
    │   │   └── directives/
    │   │       ├── design/
    │   │       │   └── directive.md  # Design 지시사항
    │   │       ├── code/
    │   │       │   └── directive.md  # Code 지시사항
    │   │       └── eval/
    │   │           ├── tests.json    # ✅ 평가 테스트
    │   │           └── quality-thresholds.json
    │   └── outputs/
    │       ├── design/          # 생성된 설계 문서
    │       ├── code/            # 생성된 코드
    │       ├── reports/         # 실행 리포트
    │       └── eval/            # 평가 결과
    │
    └── user-auth/              # Feature 2: User Auth (중급)
        └── (동일 구조)
```

## 🚀 빠른 시작 (5분)

### Feature 1: Todo List (간단)

#### 1단계: 전체 워크플로우 한번에 실행

```bash
cd /Users/probe/dev/ant

# Design → Code → Eval 전체 플로우
npm run dev -- arch design workspace/demo-app/features/todo-list/
npm run dev -- arch code workspace/demo-app/features/todo-list/ --eval
```

#### 2단계: 결과 확인

```bash
# 생성된 설계 문서
cat workspace/demo-app/features/todo-list/outputs/design/design.md

# 생성된 코드
ls workspace/demo-app/features/todo-list/outputs/code/

# 평가 결과
cat workspace/demo-app/features/todo-list/outputs/eval/report.md
```

### Feature 2: User Auth (중급)

```bash
# 동일한 플로우
npm run dev -- arch design workspace/demo-app/features/user-auth/
npm run dev -- arch code workspace/demo-app/features/user-auth/ --eval
```

---

## 📖 상세 가이드

### Feature 1: Todo List

#### PRD 확인

`features/todo-list/inputs/sources/prd.md`:
```markdown
# Todo List Feature

## 요구사항
1. Todo 아이템 추가
2. Todo 아이템 완료 표시
3. Todo 아이템 삭제
4. 완료/미완료 필터링
```

#### 평가 테스트 확인

`features/todo-list/inputs/directives/eval/tests.json`:
- Todo 추가 기능 테스트
- 완료 표시 기능 테스트
- 삭제 기능 테스트
- 필터링 기능 테스트

#### 실행 및 결과

```bash
# 1. Design 생성
npm run dev -- arch design workspace/demo-app/features/todo-list/
# → outputs/design/design.md 생성

# 2. Code 생성 + 자동 평가
npm run dev -- arch code workspace/demo-app/features/todo-list/ --eval
# → outputs/code/TodoList.tsx, TodoItem.tsx 등 생성
# → outputs/eval/report.md 자동 생성

# 3. 평가 결과 확인
cat workspace/demo-app/features/todo-list/outputs/eval/report.md
```

**기대 결과**:
```
# Evaluation Report: todo-list-eval

## Summary
- Total Tasks: 4
- Passed: 4
- Pass Rate: 100.0%
- Maintainability Index: 78.5
- Cyclomatic Complexity: 8.2

## Strengths
✅ 높은 테스트 통과율 (100%)
✅ 높은 코드 유지보수성
✅ 낮은 순환 복잡도
```

---

## 🎓 학습 포인트

### 1. 전체 워크플로우 이해

```
PRD 작성
   ↓
Design 생성 (architect design)
   ↓
Code 생성 (architect code)
   ↓
자동 평가 (--eval)
   ↓
품질 확인 (quality thresholds)
```

### 2. 평가 테스트 작성법

`eval/tests.json`을 보면:
- 각 요구사항마다 테스트 케이스 작성
- assertion은 실제 코드 동작 검증
- 품질 기준 설정 가능

### 3. 반복 개선

```bash
# 품질이 낮으면 다시 생성
npm run dev -- arch code workspace/demo-app/features/todo-list/ \
  --mode refactor --eval
```

---

## 🔄 CI/CD 테스트

이 데모는 CI/CD 파이프라인 테스트로도 사용됩니다:

```yaml
# .github/workflows/demo-test.yml
- name: Test ANT workflow
  run: |
    # Todo List feature 테스트
    npm run dev -- arch code workspace/demo-app/features/todo-list/ --eval
    
    # 평가 결과 확인
    PASS_RATE=$(jq '.passRate' workspace/demo-app/features/todo-list/outputs/eval/report.json)
    if (( $(echo "$PASS_RATE < 0.8" | bc -l) )); then
      exit 1
    fi
```

---

## 🆚 /datasets/ 와의 차이

| | `/workspace/demo-app/` | `/datasets/` |
|---|---|---|
| **목적** | **전체 워크플로우 데모** | 범용 벤치마크 |
| **내용** | PRD → Design → Code → Eval | standalone 코딩 문제 |
| **사용법** | `arch design/code --eval` | `eval dataset.json` |
| **학습** | ✅ ANT 워크플로우 이해 | AI 일반 성능 측정 |
| **초보자** | ✅ 추천 (여기서 시작!) | 나중에 |

---

## 📝 Features 목록

### ✅ 구현된 Features

1. **todo-list** (Easy)
   - React Todo 애플리케이션
   - 4개 테스트 케이스
   - 예상 시간: 5분

2. **user-auth** (Medium)
   - JWT 기반 인증
   - 6개 테스트 케이스
   - 예상 시간: 10분

### 🚧 향후 추가 예정

3. **api-rest** (Medium)
   - REST API 서버
   - Express + TypeScript

4. **data-dashboard** (Hard)
   - 데이터 시각화 대시보드
   - 복잡한 상태 관리

---

## 🎯 다음 단계

### 데모 완료 후

1. ✅ 전체 워크플로우 이해됨
2. → 실제 프로젝트 시작: `workspace/my-project/` 생성
3. → PRD 작성 및 feature 개발
4. → 평가 테스트 작성
5. → CI/CD 통합

### 실전 적용

```bash
# 새 프로젝트 초기화
npm run init:workspace my-project

# 새 feature 생성
mkdir -p workspace/my-project/features/my-feature
cp -r workspace/demo-app/features/todo-list/inputs workspace/my-project/features/my-feature/

# PRD 수정 및 워크플로우 실행
vim workspace/my-project/features/my-feature/inputs/sources/prd.md
npm run dev -- arch design workspace/my-project/features/my-feature/
npm run dev -- arch code workspace/my-project/features/my-feature/ --eval
```

---

## 💡 팁

### 빠른 테스트

```bash
# Design만 생성 (코드 생성 안함)
npm run dev -- arch design workspace/demo-app/features/todo-list/

# Code만 생성 (평가 안함)
npm run dev -- arch code workspace/demo-app/features/todo-list/

# 평가만 다시 실행
npm run dev -- eval workspace/demo-app/features/todo-list/inputs/directives/eval/tests.json
```

### 학습 활용

```bash
# 생성된 코드를 학습 데이터로 저장
npm run dev -- arch learn workspace/demo-app/common/inputs/directives/learn/directive.md
```

### 비교 분석

```bash
# 여러 번 생성해서 비교
npm run dev -- arch code workspace/demo-app/features/todo-list/ --eval --max-attempts 3
```

---

## 📚 관련 문서

- [EVALUATION_QUICKSTART.md](../../docs/guides/EVALUATION_QUICKSTART.md) - 평가 시스템 빠른 시작
- [WORKFLOW_GUIDE.md](../../docs/guides/WORKFLOW_GUIDE.md) - 전체 워크플로우 가이드
- [CLI_GUIDE.md](../../docs/guides/CLI_GUIDE.md) - CLI 명령어 상세

---

## ❓ FAQ

### Q: 이것과 /datasets/의 차이는?
A: 여기는 **전체 워크플로우 데모**입니다. PRD부터 시작해서 실제 ANT를 어떻게 사용하는지 보여줍니다.

### Q: 초보자는 어디서 시작?
A: **바로 여기!** todo-list부터 시작하세요:
```bash
npm run dev -- arch design workspace/demo-app/features/todo-list/
npm run dev -- arch code workspace/demo-app/features/todo-list/ --eval
```

### Q: 실제 프로젝트에 적용하려면?
A: 이 데모의 구조를 복사해서 사용하세요:
```bash
cp -r workspace/demo-app/features/todo-list workspace/my-project/features/my-feature
```

### Q: 평가가 실패하면?
A: 정상입니다! 그게 평가의 목적입니다. 품질 기준을 조정하거나 코드를 다시 생성하세요.

