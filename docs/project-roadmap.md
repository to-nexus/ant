# AI Development Framework — 프로젝트 개요 및 개발 로드맵

**작성자:** 정우준  
**일자:** 2025-10-24  
**프로젝트:** AI-Driven Development Framework (Architect Agent PoC)

---

## 1. 프로젝트 개요

### 1.1 목적

본 문서의 목적은 개발조직을  
**AI를 활용하는 조직**에서 **AI와 함께 학습하고 성장하는 조직(AI-Native Organization)** 으로 전환하는 것이다.  

AI를 단순한 보조 도구가 아닌,  
**조직 단위로 학습하고 협업하는 개발 주체**로 발전시키는 것을 목표로 한다.

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
> “AI가 돕는 조직”에서 “AI가 함께 일하는 조직”으로 이동한다.

---

## 2. 개발 로드맵

### 2.1 개요

AI Development Framework는  
AI를 단순한 코딩 도우미가 아닌,  
**지속적으로 학습하고 스스로 개선하는 개발 파트너**로 만들기 위한 시스템이다.  

프레임워크는 다음과 같은 단계별 구성으로 개발된다.

| 순서 | 개발 모듈 | 핵심 역할 |
|------|------------|------------|
| 1 | **Framework Core Skeleton** | 시스템 전체 구조 및 실행 흐름의 기반 |
| 2 | **Prompt Engine** | LLM 프롬프트 관리 및 출력 품질 제어 |
| 3 | **Agent Workflow Graph** | LangGraph 기반 에이전트 워크플로우 정의 |
| 4 | **Validation & Guardrail Engine** | 출력 검증 및 자동 재시도 로직 |
| 5 | **Chunker + Embedder Integration** | 코드/문서 임베딩 및 벡터 저장 |
| 6 | **Retriever** | 의미 유사도 기반 검색 및 컨텍스트 구성 |
| 7 | **Learning Extractor** | 실행 결과에서 학습 가능한 패턴 추출 및 Vector Memory 저장 |
| 8 | **Git Integration Layer** | 코드 원본 관리 및 자동 커밋 |
| 9 | **Reporting & Analytics** | 실행 로그 및 학습 결과 리포트 생성 |

---

### 2.2 단계별 개발 목표

#### (1) Framework Core Skeleton
- **역할:** 프레임워크의 기반 구조 확립 (Agent, Orchestrator, Config, Memory의 일관된 실행 구조 마련)  
- **목표:**  
  - Agent 공통 인터페이스 정의  
  - CLI → Orchestrator → Agent 실행 흐름 통합  
  - 프로젝트별 설정 자동 감지 및 로깅 체계 확립  
- **평가 기준:** Architect Agent가 단일 실행 플로우로 동작하고 결과가 일관되게 기록될 것

---

#### (2) Prompt Engine
- **역할:** 각 Phase(Plan / Code / Validate / Learn)에 따른 LLM 프롬프트 템플릿 관리  
- **목표:**  
  - 공통 프롬프트 규칙화 및 출력 포맷 표준화  
  - Guardrail 자동 삽입 및 모델 파라미터 제어  
  - phase별 프롬프트 템플릿 모듈화  
- **평가 기준:** 동일 입력에서 일관된 출력이 생성되며, 불완전 출력 시 자동 재시도 수행

---

#### (3) Agent Workflow Graph
- **역할:** Plan → Code → Validate → Learn 단계를 그래프 기반으로 제어 (LangGraph 활용)  
- **목표:**  
  - 노드 간 실행 흐름과 상태 전이 정의  
  - 실패 시 재시도 및 rollback 경로 구성  
  - 실행 단계별 로그 및 상태 추적 가능화  
- **평가 기준:** 각 단계가 독립 실행 및 재시도 로직을 포함한 일관된 그래프 형태로 작동할 것

---

#### (4) Validation & Guardrail Engine
- **역할:** LLM 출력 결과의 품질 검증 및 자동 재시도 제어  
- **목표:**  
  - placeholder, ellipsis 검출 및 삭제 비율(<70%) 검증  
  - 필수 통합 요소 누락 감지  
  - Guardrail 위반 시 자동 재시도 수행  
- **평가 기준:** 품질 기준 위반 발생 시 즉시 감지·재시도·로그 기록이 정상 수행될 것

---

#### (5) Chunker + Embedder Integration
- **역할:** 코드·문서를 의미 단위로 분할하고 벡터로 변환하여 저장  
- **목표:**  
  - chunking 알고리즘 구현 (300~800 tokens, 20% overlap)  
  - 의미 기반 임베딩 및 메타데이터 자동 저장  
- **평가 기준:** 분할된 chunk가 문맥 단절 없이 검색 가능한 단위로 벡터화될 것

---

#### (6) Retriever
- **역할:** 의미 유사도 기반 검색 및 관련 문맥의 LLM 프롬프트 주입  
- **목표:**  
  - query embedding + namespace 필터링  
  - 검색 결과 reranking 및 context 압축  
  - relevance 높은 snippet 반환  
- **평가 기준:** 질의 시 연관도가 높은 결과를 안정적으로 반환할 것

---

#### (7) Learning Extractor
- **역할:** 실행 결과로부터 학습 가능한 패턴을 추출하고 Vector Memory에 축적  
- **목표:**  
  - 학습 데이터 자동 생성 및 저장  
  - 설계/코드 반복 패턴의 원칙화  
- **평가 기준:** 실행 후 학습 데이터가 누적되고, 이후 실행 시 재활용이 가능할 것

---

#### (8) Git Integration Layer
- **역할:** HEAD 기준 코드 비교, diff 계산 및 자동 커밋  
- **목표:**  
  - diff 비율 계산 및 커밋 메시지 자동 생성  
  - 브랜치 분리 및 push 자동화  
- **평가 기준:** 변경 내역이 자동 반영되고 브랜치 커밋 프로세스가 안정적으로 수행될 것

---

#### (9) Reporting & Analytics
- **역할:** 실행 로그 및 리포트 자동 생성  
- **목표:**  
  - 각 Phase별 실행 결과 및 품질 지표 리포트화  
  - retry 횟수 및 실패 원인 기록  
- **평가 기준:** 리포트가 자동 생성되고 실행 이력 추적이 가능할 것

---

### 2.3 개발 일정

| 순서 | 개발 모듈 | 일정 | 상태 | 비고 |
|------|------------|------|------|------|
| 1 | Framework Core Skeleton | 2025 Q4 | 진행 중 | 시스템 기반 구조 확립 |
| 2 | Prompt Engine | 2025 Q4 | 예정 | 프롬프트 표준화 및 모델 제어 |
| 3 | Agent Workflow Graph | 2025 Q4 | 예정 | LangGraph 기반 워크플로우 구성 |
| 4 | Validation & Guardrail Engine | 2025 Q4 | 예정 | 출력 검증 및 자동 재시도 로직 |
| — | **첫 번째 시연 (Architect Agent PoC)** | 2025 Q4 | 예정 | Plan → Code → Validate 루프 시연 |
| 5 | Chunker + Embedder Integration | 2026 Q1 | 예정 | 코드·문서 벡터화 및 저장 |
| 6 | Retriever | 2026 Q1 | 예정 | 의미 기반 검색 및 context 구성 |
| 7 | Learning Extractor | 2026 Q1 | 예정 | 학습 가능한 패턴 추출 및 Memory 축적 |
| — | **두 번째 시연 (Vector Memory 기반 Learning Flow PoC)** | 2026 Q1 | 예정 | Chunking → Retrieval → Learning 통합 시연 |
| 8 | Git Integration Layer | 2026 Q2 | 예정 | 코드 자동 커밋 및 브랜치 관리 |
| 9 | Reporting & Analytics | 2026 Q2 | 예정 | 실행 리포트 및 피드백 시스템 완성 |

---

## 3. 결론

본 프레임워크는 **AI가 개발자의 보조 도구를 넘어 조직의 학습 주체로 진화**하는 구조를 지향한다.  
2025년 4분기말 Architect Agent의 첫 시연을 통해  
AI 주도형 개발 프로세스의 작동 원리를 입증하고,  
2026년 1분기 Vector Memory 기반 학습형 구조를 완성하며,  
2분기에는 전체 자동화 루프와 리포팅 체계를 통합하는 것을 목표로 한다.

> **최종 목표:**  
> AI가 개발조직 내에서 스스로 학습하고, 개선하며,  
> 품질과 속도를 동시에 진화시키는 **AI-Native Development Framework**의 구현.
