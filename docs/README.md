# ANT 문서 디렉토리

> ANT 프로젝트의 모든 문서화 자료를 체계적으로 관리합니다.

---

## 📁 디렉토리 구조

```
docs/
├── architecture/          # 아키텍처 설계 및 전략 문서
├── lessons/              # LLM이 생성한 학습/설명 문서
├── guides/               # 사용 가이드 및 테스트 가이드
└── [기타]                # 미분류 문서 (UI, 비교 분석 등)
```

---

## 🏛️ Architecture (아키텍처)

**사용자가 지시하여 만든 설계, 전략, 규칙 문서**

### 📋 주요 문서

#### 코어 아키텍처
- `ARCHITECTURE_CODE_JOB.md` - Code Job 아키텍처 (Tool Calling 기반)
- `designs/ARCHITECTURE.md` - 전체 시스템 아키텍처

#### Context 시스템
- `ARCHITECT_CONTEXT_MODULE.md` - Architect Context 모듈 설계
- `CONTEXT_STRUCTURE.md` - Context 구조 정의
- `MODE_SPECIFIC_CONTEXT_PRIORITY.md` - 모드별 Context 우선순위
- `SESSION_CONTEXT_COMPRESSION_STRATEGY.md` - 세션 Context 압축 전략

#### Vector DB & 인덱싱
- `CODEBASE_INDEXING_COMPLETE.md` - **코드베이스 인덱싱 완전 가이드** ⭐
- `VECTOR_DB_INDEXING_STRATEGY.md` - Vector DB 인덱싱 전략
- `VECTOR_DB_DUAL_TYPE_ANALYSIS.md` - 이중 타입 구조 분석

#### 검색 & 최적화
- `SMART_IMPORT_GRAPH_RETRIEVAL.md` - Import Graph 기반 검색
- `PROMPT_TOKEN_OPTIMIZATION.md` - 프롬프트 토큰 최적화

#### Job 설계
- `DESIGN_JOB_CONTEXT.md` - Design Job Context
- `LEARN_BRANCH_DESIGN.md` - Learn Job 브랜치 학습 설계
- `designs/ARCHITECT_CODE_TASK_WORKFLOW.md` - Code Task 워크플로우

---

## 🎓 Lessons (학습 자료)

**LLM이 생성한 시스템 이해를 위한 학습/설명 문서**

### 📚 학습 문서

- `LLM_API_REQUEST_STRUCTURE.md` - LLM API 요청 구조 및 용어 정리
- `VECTOR_DB_INDEXING_PIPELINE.md` - Vector DB 인덱싱 파이프라인 설명
- `CODEBASE_TO_LLM_FLOW.md` - 코드베이스 저장 → LLM 컨텍스트 흐름
- `CODE_JOB_COMPLETE_FLOW.md` - Code Job 전체 흐름 분석
- `CODEBASE_CHUNKING_STRUCTURE.md` - 코드베이스 청킹 구조 분석

**용도**: 시스템 이해, 온보딩, 개념 학습

---

## 📖 Guides (가이드)

**사용 가이드 및 테스트 가이드**

### 🛠️ 가이드 문서

- `CLI_GUIDE.md` - CLI 사용 가이드
- `EVALUATION.md` - 평가 및 벤치마크 가이드
- `COMPREHENSIVE_TEST_GUIDE.md` - 전체 시스템 테스트 가이드
- `REPLAN_TEST_GUIDE.md` - Replan 기능 테스트 가이드

**용도**: 실제 사용법, 테스트 방법, 평가 방법

---

## 📝 기타 문서 (Root)

루트 디렉토리에 배치된 미분류 문서들:

- `CHAT_UI_COMPONENTS.md` - Chat UI 컴포넌트 문서
- `CONTEXT_LOADING_COMPLETE_GUIDE.md` - Context 로딩 종합 가이드
- `CONTEXT_MODULES_COMPARISON.md` - Context 모듈 비교
- `CONTEXT_PRELOADING.md` - Context Preloading 기술 문서
- `XML_FILE_PROCESSING.md` - XML 파일 처리
- `saas-landing-prd.md` - SaaS Landing PRD

---

## 🗂️ 문서 분류 기준

### Architecture (아키텍처)
- ✅ 시스템 설계 및 구조
- ✅ 전략 및 정책
- ✅ 규칙 및 표준
- ✅ 사용자가 직접 지시한 설계

### Lessons (학습 자료)
- ✅ LLM이 생성한 설명 문서
- ✅ 시스템 이해를 위한 흐름도
- ✅ 용어 정리 및 개념 설명
- ✅ 파이프라인 및 프로세스 설명

### Guides (가이드)
- ✅ 사용 방법 (How-to)
- ✅ 테스트 가이드
- ✅ 평가 및 벤치마크
- ✅ CLI 명령어 레퍼런스

### Root (미분류)
- ✅ UI 관련 문서
- ✅ 비교 분석 문서
- ✅ 기술 상세 문서
- ✅ PRD 및 기획 문서

---

## 🚀 빠른 시작

### 새로운 개발자 온보딩
1. `lessons/LLM_API_REQUEST_STRUCTURE.md` - 기본 용어 이해
2. `lessons/VECTOR_DB_INDEXING_PIPELINE.md` - 인덱싱 이해
3. `architecture/ARCHITECTURE_CODE_JOB.md` - Code Job 아키텍처
4. `guides/CLI_GUIDE.md` - CLI 사용법

### 코드베이스 인덱싱 설정
1. `architecture/CODEBASE_INDEXING_COMPLETE.md` - **필독!**
2. `architecture/VECTOR_DB_INDEXING_STRATEGY.md` - 전략 이해
3. `lessons/VECTOR_DB_INDEXING_PIPELINE.md` - 내부 동작 이해

### 테스트 실행
1. `guides/COMPREHENSIVE_TEST_GUIDE.md` - 전체 테스트
2. `guides/REPLAN_TEST_GUIDE.md` - Replan 테스트
3. `guides/EVALUATION.md` - 평가 및 벤치마크

---

## 📚 추천 학습 순서

### 레벨 1: 기초 (필수)
1. `lessons/LLM_API_REQUEST_STRUCTURE.md`
2. `guides/CLI_GUIDE.md`
3. `architecture/CODEBASE_INDEXING_COMPLETE.md`

### 레벨 2: 중급 (권장)
1. `lessons/CODE_JOB_COMPLETE_FLOW.md`
2. `architecture/ARCHITECTURE_CODE_JOB.md`
3. `architecture/CONTEXT_STRUCTURE.md`

### 레벨 3: 고급 (심화)
1. `architecture/MODE_SPECIFIC_CONTEXT_PRIORITY.md`
2. `architecture/PROMPT_TOKEN_OPTIMIZATION.md`
3. `architecture/SMART_IMPORT_GRAPH_RETRIEVAL.md`

---

## 🔄 문서 업데이트 정책

### 언제 문서를 만드나?
- 새로운 아키텍처 설계 시 → `architecture/`
- LLM을 통한 학습/설명 생성 시 → `lessons/`
- 새로운 기능 사용법 작성 시 → `guides/`

### 어디에 배치하나?
- **사용자가 지시한 설계/규칙** → `architecture/`
- **LLM이 만든 설명/학습 자료** → `lessons/`
- **사용법/테스트 가이드** → `guides/`
- **위 분류에 애매한 경우** → `root`

### 레거시 문서는?
- 구현 완료 문서 (`*_COMPLETE.md`)는 통합 후 삭제
- 리팩토링 완료 문서는 통합 후 삭제
- 이슈 분석/픽스 문서는 통합 후 삭제

---

## 📞 문서 관련 질문

- **아키텍처 이해**: `architecture/` 참고
- **시스템 학습**: `lessons/` 참고
- **사용 방법**: `guides/` 참고
- **기타**: `root` 문서 또는 코드 주석 참고

---

**최종 업데이트**: 2025-11-28  
**정리 완료**: ✅ 레거시 문서 삭제, 유사 문서 통합, 카테고리별 정리 완료

