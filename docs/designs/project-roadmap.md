# ANT (AI-Native Transformation) — 프로젝트 개요 및 개발 로드맵

**작성자:** 정우준  
**최종 업데이트:** 2025-10-28  
**프로젝트:** ANT (AI-Native Transformation) - Architect Agent

---

## 1. 프로젝트 개요

### 1.1 목적

**AI를 활용하는 조직**에서 **AI와 함께 학습하고 성장하는 조직(AI-Native Organization)** 으로 전환

AI를 단순한 보조 도구가 아닌,  
**조직 단위로 학습하고 협업하는 개발 주체**로 발전시키는 것을 목표.

### 1.2 배경

현재 개발조직은 Cursor, Claude Code, GitHub Copilot 등  
**Ephemeral(일시적) AI-Assisted Development** 환경을 사용하고 있다.  

이 방식은 단기적인 생산성 향상에는 효과적이지만,  
AI가 맥락을 기억하지 못하고 학습하지 못하기 때문에  
조직 차원의 품질 향상과 지식 축적에는 근본적인 한계가 존재한다.

### 1.3 문제 인식

| 항목 | 설명 |
|------|------|
| **망각성** | 세션 종료 시 AI가 모든 맥락을 잃음 |
| **비학습성** | 과거 피드백과 패턴을 재활용하지 못함 |
| **개인 중심성** | AI 사용이 개인 단위에 머무름 |
| **조직 확장 불가** | 팀 차원의 지식 축적·일관성 확보 불가능 |

### 1.4 방향성

기존 보조형 AI 환경을 유지하되,  
**지속 학습 기반의 AI-Driven Framework**를 병행 도입하여  
조직 전체 개발 프로세스를 지능화하는 **전환 로드맵**을 제시한다.

> 핵심 전환 목표:  
> "AI가 돕는 조직"에서 "AI가 함께 일하는 조직"으로 이동한다.

---

## 2. 개발 로드맵

### 2.1 개요

AI Development Framework는  
AI를 단순한 코딩 도우미가 아닌,  
**지속적으로 학습하고 스스로 개선하는 개발 파트너**로 만들기 위한 시스템이다.  

프레임워크는 다음과 같은 단계별 구성으로 개발된다.

| 순서 | 개발 모듈 | 핵심 역할 | 상태 |
|------|------------|------------|------|
| 1 | **Framework Core Skeleton** | 시스템 전체 구조 및 실행 흐름의 기반 | ✅ 완료 |
| 2 | **Prompt Engine** | LLM 프롬프트 관리 및 출력 품질 제어 | ✅ 완료 |
| 3 | **Agent Workflow Graph** | LangGraph 기반 에이전트 워크플로우 정의 | ✅ 완료 |
| 4 | **Validation & Guardrail Engine** | 출력 검증 및 자동 재시도 로직 | ✅ 완료 |
| 5 | **Chunker + Embedder Integration** | 코드/문서 임베딩 및 벡터 저장 | ✅ 완료 |
| 6 | **Retriever** | 의미 유사도 기반 검색 및 컨텍스트 구성 | ✅ 완료 |
| 7 | **Learning Extractor** | 실행 결과에서 학습 가능한 패턴 추출 및 Vector Memory 저장 | ✅ 완료 |
| 8 | **Git Integration Layer** | 코드 원본 관리 및 자동 커밋 | ✅ 완료 |
| 9 | **Reporting & Analytics** | 실행 로그 및 학습 결과 리포트 생성 | ✅ 완료 |

---

### 2.2 단계별 개발 현황

#### (1) Framework Core Skeleton ✅
- **역할:** 프레임워크의 기반 구조 확립
- **구현:**
  - Port-Adapter 패턴 (Hexagonal Architecture) 적용
  - `core/ports.ts` - 인터페이스 정의
  - `core/policies/` - 중앙 정책 관리 (validations, retrieval)
  - `core/orchestrator.ts` - 파이프라인 라우터
  - 의존성 방향: `agents → core ← periphery`
- **평가:** ✅ Architect Agent가 단일 실행 플로우로 동작하고 결과가 일관되게 기록됨

---

#### (2) Prompt Engine ✅
- **역할:** 각 Phase(Plan / Code)에 따른 LLM 프롬프트 템플릿 관리
- **구현:**
  - Port: `PromptLoader` (core/ports.ts)
  - Adapter: `FilePromptAdapter`, `PromptRenderer` (periphery/adapters/prompt/)
  - Orchestrator: `ArchitectPromptor` (agents/architect/prompt/)
  - 6개 모듈화된 템플릿 (system, plan-base, plan-rules, code-base, code-rules, examples)
  - 의존성 주입 패턴 적용
- **평가:** ✅ 동일 입력에서 일관된 출력 생성, 템플릿 재사용성 확보

---

#### (3) Agent Workflow Graph ✅
- **역할:** Plan → Code → Validate 단계를 그래프 기반으로 제어 (LangGraph 활용)
- **구현:**
  - Code 워크플로우: `resolve → plan → implement → validate` (enforce 통합)
  - Design 워크플로우: `resolve → plan → save`
  - Learn 워크플로우: `resolve → store`
  - 각 워크플로우별 독립 state, runner, graph
  - 노드 간 실행 흐름과 상태 전이 정의
- **평가:** ✅ 각 단계가 독립 실행 및 재시도 로직을 포함한 일관된 그래프 형태로 작동

---

#### (4) Validation & Guardrail Engine ✅
- **역할:** LLM 출력 결과의 품질 검증 및 자동 재시도 제어
- **구현:**
  - 정책: `core/policies/validations.ts` (GUARDRAILS, VALIDATION_POLICIES)
  - 검증 노드: `graph/code/nodes/validate.ts`
  - ellipsis 검출, 삭제 비율(<70%) 검증
  - Guardrail 위반 시 자동 재시도 (maxRetries 설정)
- **평가:** ✅ 품질 기준 위반 발생 시 즉시 감지·재시도·로그 기록 정상 수행

---

#### (5) Chunker + Embedder Integration ✅
- **역할:** 코드·문서를 의미 단위로 분할하고 벡터로 변환하여 저장
- **구현:**
  - Docker-based 통합: `periphery/integrations/vector-memory/`
  - ChromaDB (port 8000) + Embedding Server (all-MiniLM-L6-v2, port 8001)
  - Adapter: `ChromaMemoryAdapter` (periphery/adapters/memory/)
- **평가:** ✅ 분할된 chunk가 문맥 단절 없이 검색 가능한 단위로 벡터화됨

---

#### (6) Retriever ✅
- **역할:** 의미 유사도 기반 검색 및 관련 문맥의 LLM 프롬프트 주입
- **구현:**
  - 정책: `core/policies/retrieval.ts` (RETRIEVAL_POLICY - phase별 topK, namespaces)
  - 유틸리티: `periphery/adapters/memory/Retriever.ts` (retrieveContext)
  - 서비스: `agents/architect/memoryService/` (retrieve, queries)
  - Mode별 쿼리 설정 (design vs code)
  - 6개 섹션별 결과 포맷팅
- **평가:** ✅ 질의 시 연관도가 높은 결과를 안정적으로 반환

---

#### (7) Learning Extractor ✅
- **역할:** 실행 결과로부터 학습 가능한 패턴을 추출하고 Vector Memory에 축적
- **구현:**
  - Adapter: `periphery/adapters/learning/LearningExtractor.ts`
  - Service: `agents/architect/memoryService/storage.ts` (storeLearnings)
  - Node: `graph/learn/nodes/store.ts`
  - 학습 데이터 자동 생성 및 ChromaDB 저장
- **평가:** ✅ 실행 후 학습 데이터가 누적되고, 이후 실행 시 재활용 가능

---

#### (8) Git Integration Layer ✅
- **역할:** HEAD 기준 코드 비교, diff 계산 및 자동 커밋
- **구현:**
  - Port: `GitPort` (core/ports.ts)
  - Adapter: `SimpleGitAdapter` (periphery/adapters/git/)
  - Utilities: `gitUtils.ts` (getHeadFile, writeFile, etc.)
  - 브랜치 자동 생성 및 관리
- **평가:** ✅ 변경 내역이 자동 반영되고 브랜치 커밋 프로세스가 안정적으로 수행됨

---

#### (9) Reporting & Analytics ✅
- **역할:** 실행 로그 및 리포트 자동 생성
- **구현:**
  - Port: `ReporterPort` (core/ports.ts)
  - Adapter: `FileReporter` (periphery/adapters/reporting/)
  - 사용: `graph/code/runner.ts`
  - 각 Phase별 실행 결과 및 품질 지표 리포트화
  - retry 횟수 및 실패 원인 기록
- **평가:** ✅ 리포트가 자동 생성되고 실행 이력 추적이 가능

---

### 2.3 아키텍처 개선 사항 (2025-10-27)

#### ✅ 완료된 리팩토링
1. **Prompt Engine 완전 재구축**
   - Port-Adapter 패턴 적용
   - 6개 모듈화된 템플릿으로 분리
   - 의존성 주입 패턴 도입

2. **Graph 노드 구조 정리**
   - code/design/learn 워크플로우 명확히 분리
   - 공통 로직 추출 (parseResponse 유틸)
   - enforce + implement 통합

3. **State 관리 개선**
   - 각 워크플로우별 독립 state 파일
   - code/design/learn이 동등한 레벨로 구조화

4. **Policy 통합**
   - `core/policies/` 디렉토리로 통합
   - validations, retrieval 정책 중앙 관리

5. **Memory Service 구조화**
   - `memoryService/` 디렉토리 생성
   - retrieve (조회), storeLearnings (저장), queries (설정) 분리
   - 명확한 Service 레이어 역할

6. **네이밍 일관성**
   - `getContextMemory` → `retrieve` (간결화)
   - `FilePromptLoader` → `FilePromptAdapter` (패턴 일관성)
   - retrieval 패밀리 통합 (policy, retrieveContext, retrieve)

#### ⚠️ 알려진 이슈
1. **의존성 방향 위반**
   - `core/orchestrator.ts`가 `agents/`, `periphery/`를 직접 import
   - 해결 방안: `index.ts`로 이동 또는 별도 composition root 레이어 분리

#### 📋 향후 개선 과제
1. Orchestrator 리팩토링 (의존성 방향 준수)
2. 테스트 코드 추가
3. 성능 모니터링 및 최적화

---

### 2.4 개발 일정

| 순서 | 개발 모듈 | 일정 | 상태 | 비고 |
|------|------------|------|------|------|
| 1 | Framework Core Skeleton | 2025 Q4 | ✅ 완료 | Port-Adapter 패턴 적용 |
| 2 | Prompt Engine | 2025 Q4 | ✅ 완료 | 6개 모듈화 템플릿 |
| 3 | Agent Workflow Graph | 2025 Q4 | ✅ 완료 | LangGraph 기반 3개 워크플로우 |
| 4 | Validation & Guardrail Engine | 2025 Q4 | ✅ 완료 | Policy 기반 검증 |
| 5 | Chunker + Embedder Integration | 2025 Q4 | ✅ 완료 | Docker-based 통합 |
| 6 | Retriever | 2025 Q4 | ✅ 완료 | Policy 기반 서비스 레이어 |
| 7 | Learning Extractor | 2025 Q4 | ✅ 완료 | Vector Memory 축적 |
| 8 | Git Integration Layer | 2025 Q4 | ✅ 완료 | SimpleGit 기반 |
| 9 | Reporting & Analytics | 2025 Q4 | ✅ 완료 | FileReporter 기반 |
| — | **Architect Agent 1.0** | **2025-10-27** | **✅ 완료** | **모든 모듈 통합 완료** |

---

## 3. 결론

본 프레임워크는 **AI가 개발자의 보조 도구를 넘어 조직의 학습 주체로 진화**하는 구조를 지향한다.  

### 달성한 목표
- ✅ Architect Agent의 완전한 구현 (Design, Code, Learn 워크플로우)
- ✅ Port-Adapter 패턴을 통한 확장 가능한 아키텍처
- ✅ Vector Memory 기반 지속 학습 시스템
- ✅ 모듈화된 Prompt Engine (재사용성 극대화)
- ✅ Policy 기반 검증 및 재시도 메커니즘

### 다음 단계
1. **Orchestrator 리팩토링** - 의존성 방향 위반 해결
2. **다른 Agent 통합** - Reviewer, Planner, Doc Agent 개선
3. **성능 최적화** - Vector Memory 쿼리, LLM 호출 최적화
4. **테스트 자동화** - 통합 테스트, E2E 테스트 추가

> **최종 목표:**  
> AI가 개발조직 내에서 스스로 학습하고, 개선하며,  
> 품질과 속도를 동시에 진화시키는 **AI-Native Development Framework**의 완성.
