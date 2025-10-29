# Workspace Configuration Guide

각 workspace는 `config.json`으로 설정을 관리합니다.

---

## 📁 Config 파일 위치

```
workspace/
  {project-name}/
    config.json       ← 여기!
    features/
    common/
```

---

## 🔧 Config 필드

### 필수 필드

```json
{
  "projectName": "my-app",
  "branchBase": "main"
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `projectName` | string | 프로젝트 이름 |
| `branchBase` | string | Feature 브랜치의 base (예: `main`, `develop`) |

### 선택 필드

```json
{
  "repoType": "local",
  "localPath": "../my-app",
  "autoLearn": true,
  "llmProvider": "anthropic",
  "llmModel": "claude-3-5-sonnet-20241022"
}
```

| 필드 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `repoType` | `"local"` \| `"github"` | `"local"` | 저장소 타입 |
| `localPath` | string | - | 로컬 저장소 경로 (상대/절대) |
| `autoLearn` | boolean | `true` | 코드 생성 후 자동 학습 저장 |
| `llmProvider` | `"anthropic"` \| `"openai"` | env | LLM 제공자 |
| `llmModel` | string | env | LLM 모델명 |

---

## 🗂️ 저장소 경로 설정

### 옵션 1: 상대 경로 (권장)

ANT 레포 기준 상대 경로

```json
{
  "repoType": "local",
  "localPath": "../my-app"
}
```

**디렉토리 구조**:
```
/Users/probe/dev/
├── ant/                    ← ANT 프레임워크
│   └── workspace/
│       └── my-app/
│           └── config.json
└── my-app/                 ← 생성될 실제 프로젝트 (../my-app)
    ├── src/
    ├── package.json
    └── ...
```

### 옵션 2: 절대 경로

```json
{
  "repoType": "local",
  "localPath": "/Users/probe/dev/my-app"
}
```

### 옵션 3: 홈 디렉토리

```json
{
  "repoType": "local",
  "localPath": "~/projects/my-app"
}
```

**디렉토리 구조**:
```
/Users/probe/
├── projects/
│   └── my-app/             ← 생성될 프로젝트
└── dev/
    └── ant/                ← ANT 프레임워크
```

---

## 📋 예제 Config

### 예제 1: 간단한 프로젝트

```json
{
  "projectName": "todo-app",
  "repoType": "local",
  "localPath": "../todo-app",
  "branchBase": "main",
  "autoLearn": true
}
```

### 예제 2: 기업 프로젝트

```json
{
  "projectName": "cross-ramp",
  "repoType": "local",
  "localPath": "/Users/probe/dev/cross-ramp",
  "branchBase": "develop",
  "owner": "nexus",
  "repo": "cross-ramp",
  "autoLearn": true,
  "llmProvider": "anthropic",
  "llmModel": "claude-3-5-sonnet-20241022"
}
```

### 예제 3: GitHub 통합 (미래)

```json
{
  "projectName": "my-saas",
  "repoType": "github",
  "owner": "mycompany",
  "repo": "my-saas",
  "branchBase": "main",
  "autoLearn": true
}
```

---

## 🚀 Workspace 초기화

Workspace는 **반드시 먼저 생성**해야 합니다. 입력 파일 없이 작업을 실행할 수 없습니다.

### 초기화 명령어

```bash
# 1. Workspace 생성
npm run init:workspace <project-name>

# 2. Feature 생성
npm run init:feature <project-name> <feature-name>
```

### 실행 예제

```bash
# 1. Workspace 생성
npm run init:workspace my-app

# 출력:
# 📁 Creating workspace: my-app
# ✅ Workspace initialized: workspace/my-app/
#    Edit config: workspace/my-app/config.json

# 2. Feature 생성
npm run init:feature my-app auth-feature

# 출력:
# 📁 Creating feature: auth-feature
# ✅ Feature initialized: workspace/my-app/auth-feature/

# 3. PRD 작성
vim workspace/my-app/auth-feature/inputs/sources/prd.md

# 4. 작업 실행
npm run dev architect design workspace/my-app/auth-feature/
```

### 생성되는 디렉토리 구조

```
workspace/
  my-app/
    config.json                      ← 기본 설정
    common/
      inputs/directives/learn/
      outputs/
    auth-feature/
      inputs/
        sources/
          prd.md                     ← 여기에 PRD 작성
        directives/
          design/directive.md
          code/directive.md
          learn/directive.md
      outputs/
        design/
        eval/
        reports/
```

---

## 🔄 워크플로우

### 1. 새 프로젝트 시작

```bash
# 1. Workspace 생성
npm run init:workspace my-app

# 2. config.json 수정 (필요시)
vim workspace/my-app/config.json

# 3. Feature 생성
npm run init:feature my-app feature1

# 4. PRD 작성
vim workspace/my-app/feature1/inputs/sources/prd.md

# 5. Design 생성
npm run dev architect design workspace/my-app/feature1/

# 6. Code 생성
npm run dev architect code workspace/my-app/feature1/ --eval
```

**생성된 구조**:
```
workspace/
  my-app/
    config.json                      ← 기본 설정
    feature1/
      inputs/
        sources/prd.md               ← PRD 작성 완료
        directives/
          design/directive.md
          code/directive.md
      outputs/
        design/design-*.md
        eval/report.md
```

### 2. 기존 프로젝트 연결

```bash
# 1. Workspace 생성
npm run init:workspace existing-project

# 2. config 수정 (기존 저장소 경로 지정)
vim workspace/existing-project/config.json
```

```json
{
  "projectName": "existing-project",
  "repoType": "local",
  "localPath": "../existing-project",  // 기존 저장소 경로
  "branchBase": "main"
}
```

```bash
# 3. Feature 생성
npm run init:feature existing-project new-feature

# 4. Directive 작성 (refactor의 경우)
vim workspace/existing-project/new-feature/inputs/directives/code/directive.md

# 5. 코드 생성
npm run dev architect code workspace/existing-project/new-feature/ --mode refactor
```

---

## 💡 Best Practices

### 1. 프로젝트 구조

**권장**:
```
/Users/probe/dev/
├── ant/                    ← ANT 프레임워크
├── project-a/              ← 생성된 프로젝트들
├── project-b/
└── project-c/
```

**Config**:
```json
{
  "localPath": "../project-a"
}
```

### 2. 프로젝트 명명 규칙

- **workspace 이름**: `my-app` (kebab-case)
- **localPath**: 같은 이름 사용 (`../my-app`)
- **projectName**: config에서 동일하게

### 3. Branch 전략

**개인 프로젝트**:
```json
{
  "branchBase": "main"
}
```

**팀 프로젝트**:
```json
{
  "branchBase": "develop"
}
```

---

## 🔍 Validation

Config는 자동으로 검증됩니다:

```typescript
// 검증 규칙
- projectName: 필수
- branchBase: 필수
- repoType="local" → localPath 필수
- repoType="github" → owner, repo 필수
```

**잘못된 Config**:
```json
{
  "projectName": "my-app"
  // ❌ branchBase 누락
}
```

**에러**:
```
⚠️  Invalid config.json in workspace/my-app:
    Config missing required field: branchBase
```

---

## 🎯 요약

✅ **Workspace 먼저 생성**: `npm run init:workspace <project>`  
✅ **Feature 생성**: `npm run init:feature <project> <feature>`  
✅ **입력 파일 준비**: PRD 또는 directive 작성  
✅ **작업 실행**: `npm run dev architect <task> <input>`  
  - `architect design` / `arch design`  
  - `architect code` / `arch code`  
  - `architect learn` / `arch learn`  
✅ **Config 관리**: `config.json`로 프로젝트 설정  
✅ **경로 설정**: `localPath`로 실제 저장소 위치 (상대 경로 권장)  

**올바른 순서**:

```bash
# 1. 준비
npm run init:workspace my-app
npm run init:feature my-app feature1
vim workspace/my-app/feature1/inputs/sources/prd.md

# 2. 실행
npm run dev architect design workspace/my-app/feature1/
npm run dev architect code workspace/my-app/feature1/ --eval
```

