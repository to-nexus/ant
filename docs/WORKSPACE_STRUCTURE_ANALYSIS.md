# Workspace Structure Analysis: outputs vs sessions

> **작성일**: 2026-01-13  
> **목적**: outputs와 sessions 디렉토리의 역할 명확화 및 재구조화 권장사항

---

## 📋 현재 구조 (AS-IS)

### Feature 디렉토리 구조

```
features/{feature-name}/
├── inputs/                          # 사용자 입력
│   ├── directives/                 # 작업 지시
│   │   ├── design/directive.md
│   │   ├── code/directive.md
│   │   └── learn/directive.md
│   ├── sources/                    # 소스 문서
│   │   └── prd.md                  # PRD (필수)
│   ├── assets/                     # 런타임 에셋
│   └── references/                 # 참고 이미지
│       ├── screens/
│       └── components/
│
├── outputs/                         # 산출물
│   ├── design/                     # 설계 문서
│   │   ├── ui-spec.json           # UI 명세
│   │   ├── ui-tokens.json         # 디자인 토큰
│   │   ├── ui-assets.json         # 에셋 매핑
│   │   └── system-design.md       # 시스템 설계
│   │
│   └── reports/                    # ⚠️ 실행 로그
│       └── architect-{job}-YYYY-MM-DDTHH-mm-ss-SSSZ.log
│
└── sessions/                        # ⚠️ 세션/디버깅 데이터 (혼재)
    ├── chat.json                   # 채팅 세션 상태
    ├── design.json                 # Design Job 세션 상태
    ├── code.json                   # Code Job 세션 상태
    │
    ├── eval-ui-design/             # ⚠️ 평가 리포트
    │   └── evaluidesign-{jobId}.md
    │
    ├── eval-system-design/         # ⚠️ 평가 리포트
    │   └── evalsysdesign-{jobId}.md
    │
    ├── eval-code/                  # ⚠️ 평가 리포트
    │   └── evalcode-{jobId}.md
    │
    ├── log-prompt/                 # ⚠️ 디버깅 로그
    │   ├── prompt-design-{jobId}.md
    │   └── prompt-code-{jobId}.md
    │
    └── plan-text/                  # ⚠️ 디버깅 자료
        └── {jobId}.md              # 코드 구현 계획 텍스트
```

---

## 🔍 문제 분석

### 1. 역할 혼재 문제

| 디렉토리 | 현재 내용 | 역할 성격 |
|----------|----------|----------|
| `outputs/reports/` | `architect-*.log` | 실행 로그 (일시적 디버깅) |
| `outputs/design/` | 설계 문서 (JSON/MD) | **산출물** ✅ |
| `sessions/*.json` | 세션 상태 (재개 용도) | **세션 상태** ✅ |
| `sessions/eval-*/` | 평가 리포트 (MD) | **산출물** ❌ (위치 부적절) |
| (신규) `outputs/evals/prd/` | PRD 평가 리포트 | **산출물** ✅ (올바른 위치) |
| `sessions/log-prompt/` | 프롬프트 구조 로그 | **디버깅 자료** ✅ |
| `sessions/plan-text/` | 구현 계획 텍스트 | **디버깅 자료** ✅ |

### 2. 핵심 문제

**`sessions/` 디렉토리의 역할 충돌:**
- ✅ **세션 상태 (올바름)**: `chat.json`, `design.json`, `code.json`
  - **목적**: Job 재개(resume), 상태 복원
  - **특성**: 휘발성, 런타임 데이터, 내부 구조체
  
- ❌ **평가 리포트 (부적절)**: `eval-ui-design/`, `eval-system-design/`, `eval-code/`
  - **목적**: 품질 평가 결과 문서 (외부 공유 가능)
  - **특성**: 영구 보존, 사용자 가독성, 문서 성격
  - **문제**: 이 리포트는 "산출물"이므로 `outputs/` 하위에 있어야 함

- ✅ **디버깅 로그 (올바름)**: `log-prompt/`, `plan-text/`
  - **목적**: 개발/디버깅 시 프롬프트 및 내부 로직 추적
  - **특성**: 개발자용, 임시 자료

### 3. `outputs/reports/` vs 평가 리포트의 혼란

| 항목 | 현재 위치 | 성격 | 올바른 위치 |
|------|----------|------|------------|
| `architect-*.log` | `outputs/reports/` | 실행 로그 (console 출력 캡처) | `sessions/logs/` 또는 제거 |
| `eval-*.md` | `sessions/eval-*/` | 평가 문서 (품질 분석 리포트) | `outputs/evaluations/` 또는 `outputs/reports/` |

**혼란의 원인:**
- `outputs/reports/`에는 "실행 로그"가 있음 (단순 console 캡처)
- `sessions/eval-*/`에는 "평가 리포트"가 있음 (LLM이 생성한 분석 문서)
- 이 둘은 **성격이 완전히 다름**:
  - 실행 로그 = 일시적, 디버깅용
  - 평가 리포트 = 영구 보존, 문서화된 산출물

---

## 🎯 역할 정의 (명확화)

### outputs/ - 영구 보존 산출물
**정의**: 외부 공유 가능하고, 프로젝트의 최종 결과물로 보존되어야 하는 문서 및 데이터

**특징:**
- ✅ 영구 보존 (버전 관리 대상)
- ✅ 외부 공유 가능 (사용자/팀 공유)
- ✅ 구조화된 문서 (JSON/Markdown)
- ✅ Git에 커밋 가능

**예시:**
- `outputs/design/` - 설계 문서 (ui-spec, system-design 등)
- `outputs/evals/` - 평가 리포트 (eval-prd, eval-ui-design, eval-system-design, eval-code)

---

### sessions/ - 런타임 세션 및 디버깅 데이터
**정의**: Job 재개를 위한 세션 상태 및 개발자 디버깅 자료

**특징:**
- ⚠️ 일시적 (Job 완료 후 정리 가능)
- ⚠️ 내부 구조체 (외부 공유 비권장)
- ⚠️ 개발/디버깅 목적
- ⚠️ Git ignore 권장

**예시:**
- `sessions/*.json` - 세션 상태 (재개용)
- `sessions/log-prompt/` - 프롬프트 로그 (디버깅용)
- `sessions/plan-text/` - 계획 텍스트 (디버깅용)
- `sessions/logs/` - 실행 로그 (console 출력 캡처)

---

## 💡 권장 구조 (TO-BE)

### Option A: 명확한 분리 (권장 ⭐)

```
features/{feature-name}/
├── inputs/                          # 사용자 입력
│   ├── directives/
│   ├── sources/
│   ├── assets/
│   └── references/
│
├── outputs/                         # ✅ 영구 보존 산출물 (외부 공유 가능)
│   ├── design/                     
│   │   ├── ui-spec.json
│   │   ├── ui-tokens.json
│   │   ├── ui-assets.json
│   │   └── system-design.md
│   │
│   └── evals/                      # ✅ 평가 리포트 (sessions에서 이동)
│       ├── prd/                    # ✅ PRD 평가 (신규)
│       │   └── evalprd-{jobId}.md
│       ├── ui-design/
│       │   └── evaluidesign-{jobId}.md
│       ├── system-design/
│       │   └── evalsysdesign-{jobId}.md
│       └── code/
│           └── evalcode-{jobId}.md
│
└── sessions/                        # ✅ 세션 상태 + 디버깅 자료 (일시적)
    ├── chat.json                   # 채팅 세션 상태
    ├── design.json                 # Design Job 세션 상태
    ├── code.json                   # Code Job 세션 상태
    │
    ├── debug/                      # ✅ 디버깅 자료 (통합)
    │   ├── prompts/                # log-prompt/ 이름 변경
    │   │   ├── prompt-design-{jobId}.md
    │   │   └── prompt-code-{jobId}.md
    │   │
    │   ├── plans/                  # plan-text/ 이름 변경
    │   │   └── plan-{jobId}.md
    │   │
    │   └── logs/                   # ✅ 실행 로그 (reports에서 이동)
    │       └── architect-{job}-{timestamp}.log
    │
    └── .gitignore                  # sessions 전체를 git에서 제외
```

**변경 사항:**
1. ✅ **평가 리포트 이동**: `sessions/eval-*/ → outputs/evals/`
2. ✅ **실행 로그 이동**: `outputs/reports/ → sessions/debug/logs/`
3. ✅ **디버깅 자료 통합**: `sessions/debug/` 하위로 체계화
4. ✅ **이름 명확화**: 
   - `log-prompt/ → debug/prompts/`
   - `plan-text/ → debug/plans/`
5. ✅ **outputs/reports/ 제거**: 더 이상 사용하지 않음

---

### Option B: 최소 변경 (차선책)

```
features/{feature-name}/
├── outputs/
│   ├── design/
│   │   └── ...
│   │
│   └── reports/                    # ✅ 평가 리포트 통합
│       ├── evals/                  # eval-* 이동
│       │   ├── prd/
│       │   ├── ui-design/
│       │   ├── system-design/
│       │   └── code/
│       │
│       └── logs/                   # 실행 로그
│           └── architect-*.log
│
└── sessions/
    ├── *.json                      # 세션 상태
    ├── log-prompt/                 # 프롬프트 로그
    └── plan-text/                  # 계획 텍스트
```

**변경 사항:**
1. ✅ **평가 리포트 이동**: `sessions/eval-*/ → outputs/reports/evals/`
2. ⚠️ 실행 로그는 `outputs/reports/logs/`에 유지
3. ⚠️ 디버깅 자료는 `sessions/`에 유지

---

## 📊 비교표

| 항목 | AS-IS | Option A (권장) | Option B (차선) |
|------|-------|----------------|----------------|
| **평가 리포트** | `sessions/eval-*/` | `outputs/evals/` ✅ | `outputs/reports/evals/` ✅ |
| **실행 로그** | `outputs/reports/` | `sessions/debug/logs/` ✅ | `outputs/reports/logs/` ⚠️ |
| **프롬프트 로그** | `sessions/log-prompt/` | `sessions/debug/prompts/` ✅ | `sessions/log-prompt/` ➖ |
| **계획 텍스트** | `sessions/plan-text/` | `sessions/debug/plans/` ✅ | `sessions/plan-text/` ➖ |
| **역할 명확성** | ⚠️ 혼재 | ✅ 명확 분리 | ⚠️ 부분 개선 |
| **마이그레이션 복잡도** | - | ⚠️ 중간 | ✅ 낮음 |

---

## 🔧 마이그레이션 계획 (Option A 기준)

### Phase 1: 디렉토리 구조 변경

**코드 변경 위치:**

1. **Feature 초기화** (`cli/init.ts`, `FeatureCrudService.ts`)
   ```typescript
   // 기존
   fs.mkdirSync(path.join(featureDir, "outputs/reports"), { recursive: true });
   fs.mkdirSync(path.join(featureDir, "sessions/eval-ui-design"), { recursive: true });
   fs.mkdirSync(path.join(featureDir, "sessions/eval-system-design"), { recursive: true });
   fs.mkdirSync(path.join(featureDir, "sessions/eval-code"), { recursive: true });
   fs.mkdirSync(path.join(featureDir, "sessions/log-prompt"), { recursive: true });
   fs.mkdirSync(path.join(featureDir, "sessions/plan-text"), { recursive: true });
   
   // 변경 후
   fs.mkdirSync(path.join(featureDir, "outputs/evals/prd"), { recursive: true });
   fs.mkdirSync(path.join(featureDir, "outputs/evals/ui-design"), { recursive: true });
   fs.mkdirSync(path.join(featureDir, "outputs/evals/system-design"), { recursive: true });
   fs.mkdirSync(path.join(featureDir, "outputs/evals/code"), { recursive: true });
   fs.mkdirSync(path.join(featureDir, "sessions/debug/prompts"), { recursive: true });
   fs.mkdirSync(path.join(featureDir, "sessions/debug/plans"), { recursive: true });
   fs.mkdirSync(path.join(featureDir, "sessions/debug/logs"), { recursive: true });
   ```

2. **실행 로그 저장 위치** (`cli/command.ts:162`)
   ```typescript
   // 기존
   const outputDir = path.join(featureDir, 'outputs', 'reports');
   
   // 변경 후
   const outputDir = path.join(featureDir, 'sessions', 'debug', 'logs');
   ```

3. **프롬프트 로거** (`core/utils/promptLogger.ts:54`)
   ```typescript
   // 기존
   this.logDirPath = path.join(options.featurePath, 'sessions', 'log-prompt');
   
   // 변경 후
   this.logDirPath = path.join(options.featurePath, 'sessions', 'debug', 'prompts');
   ```

4. **계획 텍스트 저장** (`agents/architect/graph/code/nodes/plan/planGeneration.ts:191`)
   ```typescript
   // 기존
   const planTextDir = path.join(featurePath, 'sessions', 'plan-text');
   
   // 변경 후
   const planTextDir = path.join(featurePath, 'sessions', 'debug', 'plans');
   ```

5. **평가 리포트 저장 위치** (eval 관련 코드에서)
   ```typescript
   // 기존
   const evalDir = path.join(featurePath, 'sessions', 'eval-ui-design');
   
   // 변경 후
   const evalDir = path.join(featurePath, 'outputs', 'evaluations', 'ui-design');
   ```

6. **FileOperationService** (`FileOperationService.ts:15-20`)
   ```typescript
   // 기존
   const VISIBLE_DIRECTORIES = [
     'outputs/reports',
     'sessions/eval-ui-design',
     'sessions/eval-system-design',
     'sessions/plan-text',
     'sessions/log-prompt',
   ];
   
   // 변경 후
   const VISIBLE_DIRECTORIES = [
     'outputs/evaluations',
     'sessions/debug',
   ];
   ```

### Phase 2: 기존 데이터 마이그레이션 스크립트

**필요 작업:**
- 기존 워크스페이스의 `sessions/eval-*/ → outputs/evaluations/` 이동
- 기존 `outputs/reports/*.log → sessions/debug/logs/` 이동
- 기존 `sessions/log-prompt/ → sessions/debug/prompts/` 이동
- 기존 `sessions/plan-text/ → sessions/debug/plans/` 이동

**마이그레이션 스크립트 예시:**

```typescript
// scripts/migrate-workspace-structure.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';

async function migrateWorkspace(workspacesRoot: string) {
  const features = await glob('**/features/*/', { cwd: workspacesRoot, absolute: true });
  
  for (const featurePath of features) {
    console.log(`Migrating: ${featurePath}`);
    
    // 1. Move eval reports
    await moveDirectory(
      path.join(featurePath, 'sessions/eval-prd'),
      path.join(featurePath, 'outputs/evals/prd')
    );
    await moveDirectory(
      path.join(featurePath, 'sessions/eval-ui-design'),
      path.join(featurePath, 'outputs/evals/ui-design')
    );
    await moveDirectory(
      path.join(featurePath, 'sessions/eval-system-design'),
      path.join(featurePath, 'outputs/evals/system-design')
    );
    await moveDirectory(
      path.join(featurePath, 'sessions/eval-code'),
      path.join(featurePath, 'outputs/evals/code')
    );
    
    // 2. Move execution logs
    await moveDirectory(
      path.join(featurePath, 'outputs/reports'),
      path.join(featurePath, 'sessions/debug/logs')
    );
    
    // 3. Move prompt logs
    await moveDirectory(
      path.join(featurePath, 'sessions/log-prompt'),
      path.join(featurePath, 'sessions/debug/prompts')
    );
    
    // 4. Move plan texts
    await moveDirectory(
      path.join(featurePath, 'sessions/plan-text'),
      path.join(featurePath, 'sessions/debug/plans')
    );
  }
}

async function moveDirectory(src: string, dest: string) {
  try {
    await fs.access(src);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rename(src, dest);
    console.log(`  ✅ Moved: ${path.basename(src)} → ${dest}`);
  } catch (error) {
    // Source doesn't exist, skip
  }
}
```

### Phase 3: .gitignore 업데이트

```gitignore
# Feature workspace - session data (ephemeral)
**/features/*/sessions/

# Keep evaluation reports (permanent artifacts)
!**/features/*/outputs/evaluations/
```

---

## 🎯 권장 사항

### 즉시 적용 (High Priority)

1. ✅ **평가 리포트 이동**: `sessions/eval-*/ → outputs/evaluations/`
   - **이유**: 평가 리포트는 영구 보존 산출물
   - **영향**: 낮음 (파일 이동만 필요)
   - **우선순위**: **HIGH**

2. ✅ **실행 로그 이동**: `outputs/reports/ → sessions/debug/logs/`
   - **이유**: 실행 로그는 일시적 디버깅 자료
   - **영향**: 중간 (`cli/command.ts` 수정)
   - **우선순위**: **MEDIUM**

### 추가 개선 (Nice to Have)

3. ⚠️ **디버깅 자료 통합**: `sessions/debug/` 하위로 체계화
   - **이유**: 디버깅 자료의 역할 명확화
   - **영향**: 중간 (여러 파일 수정)
   - **우선순위**: **LOW**

4. ⚠️ **sessions/ gitignore**: 세션 데이터는 Git 추적 제외
   - **이유**: 일시적 데이터는 버전 관리 불필요
   - **영향**: 낮음 (`.gitignore` 추가)
   - **우선순위**: **LOW**

---

## 📝 결론

### 핵심 문제
- **평가 리포트(`eval-*.md`)가 `sessions/`에 잘못 위치**
  - 이는 영구 보존 산출물이므로 `outputs/evaluations/`로 이동해야 함
  
- **실행 로그(`architect-*.log`)가 `outputs/reports/`에 위치**
  - 이는 일시적 디버깅 자료이므로 `sessions/debug/logs/`로 이동 권장

### 권장 액션 (우선순위 순)

| 우선순위 | 작업 | 이유 | 복잡도 |
|---------|------|------|--------|
| **1** | 평가 리포트 → `outputs/evaluations/` | 산출물 위치 교정 | 낮음 ✅ |
| **2** | 실행 로그 → `sessions/debug/logs/` | 일시 자료 위치 교정 | 중간 ⚠️ |
| **3** | 디버깅 자료 → `sessions/debug/` | 구조 명확화 | 중간 ⚠️ |
| **4** | `.gitignore` 업데이트 | 버전 관리 최적화 | 낮음 ✅ |

### 최종 권장 구조 (Option A)

```
outputs/                      # ✅ 영구 보존 산출물
├── design/                   # 설계 문서
└── evals/                    # 평가 리포트 (이동)
    ├── prd/                  # PRD 평가
    ├── ui-design/            # UI 설계 평가
    ├── system-design/        # 시스템 설계 평가
    └── code/                 # 코드 평가

sessions/                     # ✅ 세션 + 디버깅
├── *.json                    # 세션 상태
└── debug/                    # 디버깅 자료 (통합)
    ├── prompts/              # 프롬프트 로그
    ├── plans/                # 계획 텍스트
    └── logs/                 # 실행 로그 (이동)
```

---

**다음 단계**: 이 분석을 기반으로 마이그레이션 티켓 생성 및 단계별 구현 진행
