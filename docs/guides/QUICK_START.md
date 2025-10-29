# Quick Start Guide

완전히 새로운 프로젝트를 시작하는 가장 빠른 방법

---

## 🚀 방법 1: 자동 초기화 (권장)

workspace 구조가 없어도 자동으로 생성됩니다!

```bash
# 1. 바로 코드 생성 시작
npm run dev architect code workspace/test-app/my-feature/

# 시스템이 자동으로:
# - workspace/test-app/ 생성
# - workspace/test-app/my-feature/ 생성
# - config.json, PRD 템플릿 생성
```

### 첫 실행 시 출력
```
📁 Creating workspace: test-app
✅ Workspace initialized: workspace/test-app/
📁 Creating feature: my-feature
✅ Feature initialized: workspace/test-app/my-feature/
   Edit: workspace/test-app/my-feature/inputs/sources/prd.md

⚠️  No design document or directive found.
   Edit the PRD template and run 'architect design' first.
```

### 다음 단계
```bash
# 2. PRD 작성
vim workspace/test-app/my-feature/inputs/sources/prd.md

# 3. 디자인 생성
npm run dev architect design workspace/test-app/my-feature/

# 4. 코드 생성
npm run dev architect code workspace/test-app/my-feature/ --eval
```

---

## 🔧 방법 2: 수동 초기화 (세밀한 제어)

구조를 미리 만들고 싶다면:

```bash
# 1. Workspace 생성
npm run init:workspace test-app

# 2. Feature 생성
npm run init:feature test-app my-feature

# 3. PRD 작성
vim workspace/test-app/my-feature/inputs/sources/prd.md

# 4. 디자인 생성
npm run dev architect design workspace/test-app/my-feature/

# 5. 코드 생성
npm run dev architect code workspace/test-app/my-feature/ --eval
```

---

## 📁 자동 생성되는 구조

```
workspace/test-app/
├── config.json                    # 프로젝트 설정
├── common/                        # 공통 리소스
│   ├── inputs/directives/learn/
│   └── outputs/
└── my-feature/                    # 자동 생성!
    ├── inputs/
    │   ├── sources/
    │   │   └── prd.md            # PRD 템플릿
    │   └── directives/
    │       ├── design/directive.md
    │       ├── code/directive.md
    │       └── eval/
    └── outputs/
        ├── design/               # 디자인 문서
        ├── reports/              # 리포트
        └── eval/                 # 평가 결과
```

---

## 💡 핵심 차이점

| 항목 | 자동 초기화 | 수동 초기화 |
|------|-----------|-----------|
| **속도** | ⚡ 즉시 시작 | 3단계 필요 |
| **제어** | 기본 구조 | 커스터마이징 가능 |
| **용도** | 빠른 프로토타입 | 프로덕션 프로젝트 |
| **학습 곡선** | 낮음 | 중간 |

---

## 🎯 권장 워크플로우

### 새 프로젝트 시작 (Design → Code)

```bash
# 1. 자동 초기화 + 디자인
npm run dev architect design workspace/myapp/feature1/

# 📁 Creating workspace: myapp
# 📁 Creating feature: feature1
# ✅ Feature initialized
# ⚠️  No PRD found

# 2. PRD 작성
vim workspace/myapp/feature1/inputs/sources/prd.md

# 3. 다시 디자인
npm run dev architect design workspace/myapp/feature1/

# 4. 코드 생성 + 평가
npm run dev architect code workspace/myapp/feature1/ --eval

# 5. Git 커밋
cd /path/to/your/repo
git diff  # 생성된 코드 확인
git add .
git commit -m "feat: implement feature1"
```

### 기존 코드 수정

```bash
# 1. Directive 작성
echo "Fix button color bug in Header.tsx" > \
  workspace/myapp/feature1/inputs/directives/code/directive.md

# 2. 코드 생성
npm run dev architect code workspace/myapp/feature1/ --eval

# 3. 확인
git diff
```

---

## 🔍 자동 초기화 동작 방식

### 1. Workspace 체크
```typescript
// resolve 단계에서 자동 실행
const workspaceExists = await gitPort.fileExists('workspace/myapp');
if (!workspaceExists) {
  // 자동 생성!
  await autoInitializeWorkspace(context, gitPort);
}
```

### 2. 생성되는 파일

**workspace/myapp/config.json**:
```json
{
  "projectName": "myapp",
  "branchBase": "main",
  "autoLearn": true,
  "llmProvider": "anthropic",
  "llmModel": "claude-3-5-sonnet-20241022"
}
```

**workspace/myapp/feature1/inputs/sources/prd.md**:
```markdown
# feature1 - Product Requirements

## Overview
Describe the feature and its purpose.

## Goals
- Goal 1
- Goal 2

## User Stories
- As a [user type], I want [goal] so that [benefit]
...
```

---

## 📊 실전 예제

### 예제 1: TODO 앱

```bash
# 한 줄로 시작
npm run dev architect design workspace/todo-app/basic-crud/

# PRD 작성 후
npm run dev architect design workspace/todo-app/basic-crud/
npm run dev architect code workspace/todo-app/basic-crud/ --eval
```

### 예제 2: E-commerce

```bash
# 여러 feature 동시 진행
npm run dev architect design workspace/ecommerce/product-catalog/
npm run dev architect design workspace/ecommerce/shopping-cart/
npm run dev architect design workspace/ecommerce/checkout/

# 각각 PRD 작성 후 코드 생성
npm run dev architect code workspace/ecommerce/product-catalog/ --eval
npm run dev architect code workspace/ecommerce/shopping-cart/ --eval
npm run dev architect code workspace/ecommerce/checkout/ --eval
```

---

## ⚡ Tips

### 1. 빠른 프로토타입
```bash
# workspace 이름만 바꿔서 여러 실험
npm run dev architect design workspace/experiment1/feature/
npm run dev architect design workspace/experiment2/feature/
npm run dev architect design workspace/experiment3/feature/
```

### 2. Feature 이름 규칙
```bash
# 버전 포함
workspace/myapp/ui-v1.0.0/
workspace/myapp/api-v2.0.0/

# 날짜 포함
workspace/myapp/sprint-2024-10/

# 기능 명확히
workspace/myapp/user-authentication/
workspace/myapp/payment-integration/
```

### 3. 디렉토리 확인
```bash
# 생성된 구조 확인
tree workspace/myapp/ -L 3

# PRD 확인
cat workspace/myapp/feature1/inputs/sources/prd.md
```

---

## 🎉 요약

✅ **자동 초기화** 기능으로 workspace 구조 없이도 바로 시작 가능  
✅ **GitPort** 덕분에 필요한 디렉토리 자동 생성  
✅ **PRD 템플릿** 자동 생성으로 가이드 제공  
✅ **config.json** 자동 생성으로 즉시 사용 가능

**이제 `npm run dev` 한 줄로 새 프로젝트를 시작하세요!** 🚀

