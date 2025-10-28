# AI Dev Framework - CLI 가이드

## 📦 설치 및 설정

```bash
# 의존성 설치
npm install

# 환경변수 설정 (.env)
ANTHROPIC_API_KEY=your-key-here
```

---

## 🚀 빠른 시작

### 1. Workspace 생성
```bash
npm run init:workspace my-app
```

**생성되는 구조:**
```
workspace/my-app/
├── common/
│   ├── inputs/directives/learn/
│   └── outputs/
│       ├── memory/
│       └── reports/
├── config.json
└── README.md
```

**config.json 내용:**
```json
{
  "projectName": "my-app",
  "branchBase": "main",
  "autoLearn": true,
  "llmProvider": "anthropic",
  "llmModel": "claude-3-5-sonnet-20241022"
}
```

---

### 2. Feature 생성
```bash
npm run init:feature my-app ui-1.0.0
```

**생성되는 구조:**
```
workspace/my-app/ui-1.0.0/
├── inputs/
│   ├── sources/
│   │   └── prd.md          # PRD 템플릿
│   └── directives/
│       ├── design/
│       ├── code/
│       └── learn/
└── outputs/
    ├── design/
    ├── code/
    ├── reports/
    └── memory/
```

**PRD 템플릿이 자동 생성됨:**
- 개요, 목표, 사용자 스토리
- 기능/비기능 요구사항
- 디자인 참조, 기술 제약사항
- 성공 지표

---

### 3. PRD 작성
```bash
# 생성된 PRD 템플릿 편집
vi workspace/my-app/ui-1.0.0/inputs/sources/prd.md

# (선택) Figma 링크 추가
echo "https://figma.com/..." > workspace/my-app/ui-1.0.0/inputs/sources/figma-link.txt

# (선택) 와이어프레임 추가
mkdir -p workspace/my-app/ui-1.0.0/inputs/sources/wireframes
cp ~/Downloads/home.png workspace/my-app/ui-1.0.0/inputs/sources/wireframes/
```

---

### 4. Design 생성
```bash
npm run dev arch-design workspace/my-app/ui-1.0.0
```

**입력:**
- `inputs/sources/prd.md`
- `inputs/sources/figma-link.txt` (선택)
- `inputs/sources/wireframes/` (선택)

**출력:**
- `outputs/design/design-{timestamp}.md`

---

### 5. Code 생성
```bash
npm run dev arch-code workspace/my-app/ui-1.0.0
```

**입력:**
- `outputs/design/design-xxx.md` (최신)
- `inputs/sources/prd.md` (참고)

**출력:**
- 실제 코드 파일 (git branch에 커밋)
- `outputs/code/manifest-{timestamp}.json`
- `outputs/reports/report-{timestamp}.md`
- `outputs/memory/code-context-{timestamp}.txt` (자동 학습)

---

### 6. 피드백 적용

#### Design 피드백
```bash
# directive 작성
echo "Tab UI를 Material Design으로 변경해줘" > \
  workspace/my-app/ui-1.0.0/inputs/directives/design/directive.md

# design 재생성
npm run dev arch-design workspace/my-app/ui-1.0.0
```

#### Code 수정
```bash
# directive 작성
echo "Fix button color bug in Header.tsx" > \
  workspace/my-app/ui-1.0.0/inputs/directives/code/directive.md

# code 재생성
npm run dev arch-code workspace/my-app/ui-1.0.0
```

---

### 7. 명시적 학습 (선택)
```bash
# learn directive 작성
echo "전체 코드베이스를 학습해라" > \
  workspace/my-app/ui-1.0.0/inputs/directives/learn/directive.md

# learn 실행
npm run dev arch-learn workspace/my-app/ui-1.0.0
```

---

## 📋 명령어 레퍼런스

### 초기화 명령

| 명령 | 설명 | 예시 |
|------|------|------|
| `npm run init:workspace <name>` | 새 workspace 생성 | `npm run init:workspace my-app` |
| `npm run init:feature <workspace> <name>` | 새 feature 생성 | `npm run init:feature my-app ui-1.0.0` |

### 개발 명령

| 명령 | 설명 | 입력 | 출력 |
|------|------|------|------|
| `npm run dev arch-design <path>` | Design 생성 | PRD + sources | design doc |
| `npm run dev arch-code <path>` | Code 생성 | design + PRD | code + report |
| `npm run dev arch-learn <path>` | 명시적 학습 | codebase | memory |

---

## 📁 디렉토리 구조 상세

```
workspace/
└── {project}/                      # 예: my-app
    ├── common/                     # 공통 리소스
    │   ├── inputs/
    │   │   └── directives/learn/   # 공통 학습 지시
    │   └── outputs/
    │       ├── memory/             # 공통 학습 결과
    │       └── reports/            # 공통 보고서
    ├── {feature}/                  # 예: ui-1.0.0
    │   ├── inputs/
    │   │   ├── sources/            # ⭐ 공통 소스 (모든 task 공유)
    │   │   │   ├── prd.md          # 필수
    │   │   │   ├── figma-link.txt  # 선택
    │   │   │   ├── figma-export.json
    │   │   │   └── wireframes/     # 선택
    │   │   └── directives/         # ⭐ task별 지시사항
    │   │       ├── design/
    │   │       │   ├── directive.md
    │   │       │   └── directive-001.md
    │   │       ├── code/
    │   │       │   ├── directive.md
    │   │       │   └── directive-001.md
    │   │       └── learn/
    │   │           └── directive.md
    │   └── outputs/                # task별 결과물
    │       ├── design/
    │       │   └── design-{timestamp}.md
    │       ├── code/
    │       │   └── manifest-{timestamp}.json
    │       ├── reports/
    │       │   └── report-{timestamp}.md
    │       └── memory/
    │           └── {task}-context-{timestamp}.txt
    └── config.json
```

---

## 💡 워크플로우 예시

### 예시 1: 완전 신규 프로젝트

```bash
# 1. Workspace 생성
npm run init:workspace blog-platform

# 2. Feature 생성
npm run init:feature blog-platform web-1.0.0

# 3. PRD 작성
vi workspace/blog-platform/web-1.0.0/inputs/sources/prd.md

# 4. Design 생성
npm run dev arch-design workspace/blog-platform/web-1.0.0

# 5. Design 검토 및 피드백
vi workspace/blog-platform/web-1.0.0/outputs/design/design-xxx.md
echo "Add authentication section" > \
  workspace/blog-platform/web-1.0.0/inputs/directives/design/directive.md

# 6. Design 재생성
npm run dev arch-design workspace/blog-platform/web-1.0.0

# 7. Code 생성
npm run dev arch-code workspace/blog-platform/web-1.0.0

# 8. Git 확인
git diff
git add .
git commit -m "feat: initial blog platform implementation"
```

---

### 예시 2: 기존 프로젝트에 기능 추가

```bash
# 1. 새 Feature 생성
npm run init:feature blog-platform comments-1.0.0

# 2. PRD 작성
vi workspace/blog-platform/comments-1.0.0/inputs/sources/prd.md

# 3. Design → Code
npm run dev arch-design workspace/blog-platform/comments-1.0.0
npm run dev arch-code workspace/blog-platform/comments-1.0.0
```

---

### 예시 3: 버그 수정

```bash
# 1. Code directive 작성
echo "Fix login button color issue" > \
  workspace/blog-platform/web-1.0.0/inputs/directives/code/directive-001.md

# 2. Code 재생성
npm run dev arch-code workspace/blog-platform/web-1.0.0

# 3. 확인 및 커밋
git diff
git commit -am "fix: login button color"
```

---

## 🎯 핵심 원칙

1. **workspace (단수)** - 하나의 작업공간
2. **sources는 공유** - design & code가 함께 사용
3. **directives는 분리** - 각 task의 지시사항만
4. **자동 학습** - code task 후 자동으로 memory 저장
5. **명시적 학습** - learn task로 추가 학습 가능

---

## ❓ 문제 해결

### Workspace가 없다는 에러
```bash
❌ Workspace not found: workspace/my-app
   Run: npm run init:workspace my-app
```
→ 먼저 workspace를 생성하세요.

### Feature가 이미 있다는 에러
```bash
❌ Feature already exists: workspace/my-app/ui-1.0.0
```
→ 다른 이름을 사용하거나 기존 feature를 삭제하세요.

### PRD를 찾을 수 없다는 에러
```bash
❌ prd.md not found in source directory
```
→ `inputs/sources/prd.md` 파일을 작성하세요.

---

## 🔍 더 보기

- [WORKSPACE_STRUCTURE.md](./WORKSPACE_STRUCTURE.md) - 디렉토리 구조 상세
- [WORKFLOW_GUIDE_v2.md](./WORKFLOW_GUIDE_v2.md) - 워크플로우 가이드
- [architecture-design.md](./docs/architecture-design.md) - 아키텍처 설계

