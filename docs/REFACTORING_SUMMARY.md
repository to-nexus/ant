# Workspace Structure Refactoring - Implementation Summary

> **완료일**: 2026-01-13  
> **목적**: outputs와 sessions 디렉토리 역할 명확화 및 PRD 평가 추가

---

## ✅ 완료된 작업

### 1. 문서 업데이트

**파일**: `docs/WORKSPACE_STRUCTURE_ANALYSIS.md`
- PRD 평가(`outputs/evals/prd/`) 추가
- evaluations → evals로 이름 변경 (간결화)
- 전체 구조 분석 및 마이그레이션 계획 문서화

### 2. 새로운 디렉토리 구조

```
features/{feature-name}/
├── inputs/
│   ├── directives/
│   ├── sources/prd.md
│   ├── assets/
│   └── references/
│
├── outputs/                    # ✅ 영구 보존 산출물
│   ├── design/
│   │   ├── ui-spec.json
│   │   ├── ui-tokens.json
│   │   ├── ui-assets.json
│   │   └── system-design.md
│   │
│   └── evals/                  # ✅ 평가 리포트 (신규)
│       ├── prd/               # PRD 평가
│       ├── ui-design/         # UI 설계 평가
│       ├── system-design/     # 시스템 설계 평가
│       └── code/              # 코드 평가
│
└── sessions/                   # ✅ 세션 + 디버깅 데이터
    ├── chat.json
    ├── design.json
    ├── code.json
    │
    └── debug/                  # ✅ 디버깅 자료 통합
        ├── prompts/           # 프롬프트 로그
        ├── plans/             # 구현 계획 텍스트
        └── logs/              # 실행 로그
```

### 3. 코드 변경 내역

#### 3.1 Feature 초기화
- **`cli/init.ts`**
  - `outputs/evals/` 디렉토리 생성 (prd, ui-design, system-design, code)
  - `sessions/debug/` 디렉토리 생성 (prompts, plans, logs)
  - 기존 `outputs/reports/`, `sessions/eval-*/`, `sessions/log-prompt/`, `sessions/plan-text/` 제거

- **`FeatureCrudService.ts`**
  - Feature 생성 시 동일한 구조 적용

#### 3.2 로그/디버깅 경로 변경
- **`cli/command.ts`**
  - 실행 로그: `outputs/reports/` → `sessions/debug/logs/`

- **`core/utils/promptLogger.ts`**
  - 프롬프트 로그: `sessions/log-prompt/` → `sessions/debug/prompts/`

- **`agents/.../planGeneration.ts`**
  - 계획 텍스트: `sessions/plan-text/` → `sessions/debug/plans/`

#### 3.3 서비스 업데이트
- **`FileOperationService.ts`**
  - PROTECTED_ROOT_FOLDERS 업데이트
  - `outputs/evals/`, `sessions/debug/` 보호 추가

- **`ArtifactService.ts`**
  - writeReportFile: `outputs/reports/` → `sessions/debug/logs/`

### 4. 마이그레이션 도구

**파일**: `scripts/migrate-workspace-structure.ts`

**기능**:
- 기존 워크스페이스의 자동 마이그레이션
- Dry-run 모드 지원
- 마이그레이션 통계 출력

**사용법**:
```bash
# Dry-run (실제 이동 없이 미리보기)
npm run migrate:workspace:dry-run

# 실제 마이그레이션 실행
npm run migrate:workspace

# 특정 경로 지정
npm run migrate:workspace -- /path/to/workspaces
```

**마이그레이션 내용**:
1. `sessions/eval-prd/` → `outputs/evals/prd/`
2. `sessions/eval-ui-design/` → `outputs/evals/ui-design/`
3. `sessions/eval-system-design/` → `outputs/evals/system-design/`
4. `sessions/eval-code/` → `outputs/evals/code/`
5. `outputs/reports/` → `sessions/debug/logs/`
6. `sessions/log-prompt/` → `sessions/debug/prompts/`
7. `sessions/plan-text/` → `sessions/debug/plans/`

### 5. Git 설정

**파일**: `.gitignore`

**변경 내용**:
```gitignore
# 전체 워크스페이스 무시
workspaces/*

# 평가 리포트만 추적 (영구 산출물)
!workspaces/**/outputs/evals/

# 세션 데이터 무시 (일시적 데이터)
workspaces/**/sessions/
```

---

## 🎯 변경 근거

### 이전 문제점
1. **평가 리포트 위치 오류**: `sessions/eval-*/`에 있었으나, 이는 영구 보존 산출물이므로 `outputs/`에 있어야 함
2. **실행 로그 혼란**: `outputs/reports/`에 있었으나, 이는 일시적 디버깅 자료이므로 `sessions/`에 있어야 함
3. **디버깅 자료 산재**: `sessions/log-prompt/`, `sessions/plan-text/` 등이 분산되어 관리 어려움

### 해결 방안
1. **outputs/evals/**: 평가 리포트를 영구 보존 산출물로 올바르게 배치
2. **sessions/debug/**: 디버깅 자료를 하나의 디렉토리로 통합
3. **명확한 역할 분리**:
   - `outputs/`: 영구 보존, 외부 공유 가능, Git 추적
   - `sessions/`: 일시적, 개발자용, Git 무시

---

## 📊 영향도 분석

### 낮은 영향 (✅ 안전)
- Feature 초기화 (신규 Feature만 영향)
- 디버깅 로그 경로 (개발자만 사용)
- .gitignore (기존 데이터 영향 없음)

### 중간 영향 (⚠️ 주의)
- 기존 워크스페이스 마이그레이션 필요
- 평가 리포트 접근 경로 변경 (UI에서 참조 시)

### 마이그레이션 필요
- **수동 작업 불필요**: `npm run migrate:workspace` 자동 실행
- **Dry-run 지원**: 안전하게 미리 확인 가능

---

## 🚀 다음 단계

### 즉시 실행 가능
1. **기존 워크스페이스 마이그레이션**:
   ```bash
   npm run migrate:workspace:dry-run  # 미리보기
   npm run migrate:workspace          # 실행
   ```

2. **신규 Feature 생성**:
   - 새로운 구조 자동 적용됨
   - 추가 작업 불필요

### 추가 개선 가능 (선택)
1. UI에서 평가 리포트 경로 업데이트 (outputs/evals/)
2. 평가 리포트 생성 코드에 경로 적용
3. 문서 생성기에 PRD 평가 기능 추가

---

## 📝 체크리스트

### 완료 항목 ✅
- [x] 문서 분석 및 계획 수립
- [x] 새로운 디렉토리 구조 정의
- [x] Feature 초기화 코드 리팩토링
- [x] 로그 경로 변경
- [x] 서비스 코드 업데이트
- [x] 마이그레이션 스크립트 작성
- [x] .gitignore 업데이트
- [x] package.json 스크립트 추가

### 향후 작업 (선택)
- [ ] 기존 워크스페이스 마이그레이션 실행
- [ ] UI 코드에서 평가 리포트 경로 업데이트
- [ ] PRD 평가 생성기 구현
- [ ] 문서 업데이트 (README 등)

---

## 📚 참고 문서

- **분석 문서**: `docs/WORKSPACE_STRUCTURE_ANALYSIS.md`
- **PRD 평가 가이드**: `docs/rubric/PRD_EVALUATION_GUIDE.md`
- **마이그레이션 스크립트**: `scripts/migrate-workspace-structure.ts`

---

**리팩토링 완료**: 2026-01-13  
**영향받는 파일**: 7개  
**신규 파일**: 2개 (마이그레이션 스크립트, 요약 문서)
