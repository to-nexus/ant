# AI Development Framework
*From AI-Assisted to AI-Driven Engineering*  

**Author:** Woojune Chung (probe@to.nexus)  
**Date:** 2025-10-21  

---

## 1. Executive Summary

본 문서의 목적은 개발조직을  
**AI를 활용하는 조직**에서 **AI와 함께 학습하고 성장하는 조직(AI-Native Organization)** 으로 전환하는 것이다.  
AI를 단순한 보조 도구가 아닌,  
**조직 단위로 학습하고 협업하는 개발 주체**로 발전시키는 것을 목표로 한다.

현재 우리의 개발조직은 Cursor, Claude Code, GitHub Copilot 등  
**Ephemeral AI-Assisted Development** 환경을 사용하고 있다.  
이 방식은 단기적 생산성 향상에는 효과적이지만,  
AI가 맥락을 기억하지 못하고 학습하지 못하기 때문에  
조직 차원의 품질 향상과 지식 축적에는 한계가 있다.

이에 따라 본 문서는,  
기존 보조형 환경을 유지하되 **지속형 학습 기반 프레임워크(AI-Driven Framework)** 를 병행 도입하여  
조직 전체의 개발 프로세스를 지능화하는 **전환 로드맵**을 제시한다.

---

## 2. Current State — AI-Assisted Development

현재 개발조직은 AI를 개인 코딩(또는 문서작성, 자료조사 등) 보조로 사용하고 있다.

| 특징 | 설명 |
|------|------|
| **형태** | IDE나 CLI에서 개발자가 AI에게 명령하여 코드 생성·수정·설명 수행 |
| **세션 구조** | 대화 세션마다 맥락이 초기화되는 **ephemeral(일시적)** 구조 |
| **저장 구조** | AI가 이전 대화나 프로젝트 문맥을 기억하지 못함 |
| **효과** | 단기적 생산성 향상 |
| **한계** | 팀 단위 학습·협업 불가, 일관성 부족 |

> 현재의 AI는 “즉흥적 조언자” 수준이며,  
> 장기적으로 학습하거나 협업하지 않는다.

---

## 3. Problem — The Ephemeral Limitation

Ephemeral(일시적) 구조의 핵심 문제는 다음과 같다.

| 항목 | 설명 |
|------|------|
| **1. 망각** | 세션 종료 시 모든 맥락이 사라짐 |
| **2. 단절** | 아키텍처, 설계 원칙 등 장기 기억 불가 |
| **3. 비학습성** | 과거 피드백이나 리뷰 반영 불가 |
| **4. 개인 한정성** | AI가 개인 IDE 범위에만 존재 |
| **5. 조직 지식 축적 불가** | AI가 팀 단위로 협업·기억하지 못함 |

---

## 4. Constraints — Why It Cannot Be Fixed

Ephemeral 구조는 단순 설정 변경으로 해결되지 않는다.

| 구분 | 제약 요인 |
|------|------------|
| **플랫폼 구조** | 보조형 AI 도구는 세션 기반 API로 설계되어 외부 memory 연결 불가 |
| **보안** | 코드나 대화 로그의 외부 저장은 보안 리스크 |
| **비용** | 사용자 단위로 memory를 구축하면 스토리지·임베딩 비용 폭증 |
| **플랫폼 정책** | Anthropic, OpenAI 등은 지속형 context 저장 기능을 제공하지 않음 |

따라서 ephemeral 구조를 유지하면서도,  
**지속적으로 학습할 수 있는 병행 시스템**이 필요하다.

---

## 5. New Direction — AI-Driven Development Framework

### 5.1 개요

**AI-Driven Development Framework**는  
AI를 “도우미”가 아닌 “개발조직의 구성원”으로 설계하는 시스템이다.  

AI가 스스로 계획하고, 코드를 작성하고, 리뷰하며, 문서를 작성하는 **지속학습형 구조**를 갖는다.

| 구성 요소 | 설명 |
|-------------|--------|
| **Persistent Memory** | 프로젝트 단위로 설계, 코드, 리뷰, 문서를 Vector DB에 저장 |
| **Multi-Agent System** | Planner, Architect, Coder, Reviewer, Doc으로 역할 분리 |
| **Continuous Learning** | 각 단계의 결과를 memory로 재주입해 점진적 학습 |
| **Integration with Dev Tools** | Git, CI/CD, Issue Tracker와 자동 연동 |

---

### 5.2 Framework Composition (Simplified)

AI Framework는 단순한 프롬프트 집합이 아니라 **실제로 코드로 구현된 시스템**이다.  

| 구성 요소 | 설명 | 담당 주체 |
|-------------|--------|-----------|
| **AI Framework Core** | 여러 에이전트를 연결하고 순서를 제어하는 운영 로직 | ✅ **내부 개발** |
| **Planner / Architect / Coder / Reviewer / Doc Agents** | 역할별 로직이 코드로 작성된 실제 소프트웨어 모듈 | ✅ **내부 개발** |
| **Language Model (LLM)** | OpenAI GPT, Anthropic Claude 등 외부 모델을 호출 | 🌐 **외부 서비스 사용** |
| **Vector Database** | AI의 장기 기억 저장소 (예: Chroma) | 🌐 **외부 서비스 연동** |
| **Git / CI Integrations** | 코드 버전 관리 및 자동 리뷰 연동 | 🌐 **외부 시스템 연동** |

📌 **핵심 요약:**  
- 내부에서는 **“AI 팀의 두뇌 구조”를 코드로 개발**한다.  
- 외부 서비스(LLM, DB)는 **“지식과 도구”** 역할을 한다.  
- 이 구조를 통해 AI는 스스로 **사고·기억·협업**한다.

---

### 5.3 Framework 작동 흐름

```
Planner → Architect → Coder → Reviewer → Doc
             ↓             ↓         ↓
        Vector Memory   Git Repo   CI/PR
```

1. **Planner**  
   - PRD(기획서, *Product Requirement Document*)를 분석해 기능별 작업 계획을 수립  
   - *PRD는 제품의 목표, 요구사항, 기능 범위, 기술적 고려사항을 정의한 문서로,  
     사람이 “무엇을 만들 것인가”를 AI가 이해할 수 있도록 변환하는 입력 자료다.*

2. **Architect**  
   - 설계 방향, 기술스택, 구조 설계 및 초기 코드 스켈레톤 생성  

3. **Coder**  
   - 실제 코드 작성 및 브랜치 커밋  
   - OpenAI GPT, Claude 등 외부 언어모델 호출을 통해 구현  

4. **Reviewer**  
   - 코드 리뷰 및 자동 수정 제안  
   - 품질, 보안, 일관성 검증 수행  

5. **Doc**  
   - 개발 과정 및 결과를 문서화 (README, API 문서 등)  
   - 모든 결과를 Vector Memory에 저장  

> 이 전체 과정은 AI 내부에서 자동으로 연결되며,  
> memory를 통해 시간이 지날수록 품질과 일관성이 향상된다.

---

### 5.4 Memory System (Vector DB)

| 항목 | 설명 |
|------|------|
| **저장소** | Chroma (또는 Pinecone, Qdrant 등 확장 가능) |
| **저장 내용** | 설계, 코드, 리뷰, 문서, 이슈 등 조직의 개발 지식 |
| **검색 방식** | 의미 유사도 기반(Semantic Similarity) 검색 |
| **역할** | AI가 과거 프로젝트 문맥을 기억하고, 스스로 개선하는 학습 기반 제공 |

> Vector DB는 AI 조직의 “기억 시스템(Brain)”이다.  
> 기존 보조형 AI가 매번 잊는 맥락을, 영구적으로 저장한다.

---

## 6. Future State — Hybrid AI Organization

향후 개발조직은 **Ephemeral 보조 AI**와 **Persistent Framework**가 병존한다.

| 구성 요소 | 역할 | 지속성 |
|-------------|--------|---------|
| **AI-Assisted Tools** | 개인 개발자의 코딩 보조, 즉각적 응답 | 세션 단위 |
| **AI Framework Agents** | 조직 단위 개발, 학습, 자동화 수행 | 프로젝트 단위 |

- 개인은 계속 기존 보조 도구를 활용할 수 있다.  
- 하지만 팀 차원에서는 Framework Agents가 병렬로 작업하며  
  프로젝트 전체의 맥락과 품질을 장기적으로 유지한다.  

> Ephemeral AI는 즉시성을,  
> Persistent AI는 지속적 성장과 품질을 제공한다.

---

## 7. Core Model Comparison — Assisted vs Driven

| 구분 | **AI-Assisted Development** | **AI-Driven Development** |
|------|-----------------------------|----------------------------|
| **기반 구조** | 세션 중심 (ephemeral) | 벡터 메모리 기반 (persistent) |
| **지속성** | 대화 종료 시 망각 | 프로젝트 단위로 기억 및 학습 |
| **운영 단위** | 개인 IDE / CLI | 조직형 Multi-Agent Framework |
| **AI 역할** | 보조자 (Assistant) | 구성원 (Collaborator) |
| **작동 방식** | 명령 → 응답 | 계획 → 실행 → 검증 |
| **결과물** | 코드 조각 / diff | 완결된 기능, PR, 문서 |
| **확장성** | 개인 중심 | 팀 단위 자동화 및 병렬 협업 |
| **기억 구조** | 일시적 context buffer | 지속형 vector memory |

📌 **핵심 요약:**  
AI-Assisted는 *도구(tool)*,  
AI-Driven은 *팀(team)* 이다.

---

## 8. Execution Plan

| 단계 | 일정 | 내용 |
|------|-------|------|
| **1단계: PoC 진행** | 2025 Q4 | `ai-dev-framework` 프로젝트로 PoC 진행 중. 내부 저장소 운영 중. |
| **2단계: 인프라 구축** | 2025 Q4 | Vector DB(Chroma) 구축, LLM 연동, Multi-Agent 아키텍처 시뮬레이션 완료 예정 |
| **3단계: 결과 보고** | 2025 Q4 말 | PoC 결과 보고 및 최종 구조 확정 |
| **4단계: 팀 단위 확장** | 2026 Q1 | 개발조직 내 시범 도입 및 지속 학습체계 전환 |

> 목표는 “AI가 함께 일하는 개발조직”의 실현이다.  
> 이는 보조형 AI의 확장선이 아닌, **새로운 개발 패러다임의 구축**이다.

---

## 9. Conclusion — From Memoryless Tools to Learning Systems

현재 대부분의 AI 도입은 코드 작성 중심의 **비지속형(Ephemeral) 도우미 모델**에 머물러 있다.  
이 방식은 단기적인 개발 생산성 향상에는 효과적이지만,  
AI가 맥락과 과거 결정을 기억하지 못하기 때문에  
조직 전체의 학습이나 품질 축적에는 한계가 있다.

**AI Development Framework**는 이러한 한계를 해결하기 위해  
기획, 설계, 개발, 리뷰, 문서화 전 과정을 포함하는  
**조직 단위의 지속학습형 시스템**으로 설계되었다.  
즉, 이 프레임워크의 에이전트들은 단순히 코드를 작성하는 도구가 아니라  
기획서(Planner), 아키텍처 설계(Architect), 일정 관리(PM 역할),  
코드 작성(Coder), 품질 검토(Reviewer), 문서화(Doc)를 수행하는  
**전주기(End-to-End) 협업 인공지능 구성원**이다.

이 구조를 통해 조직은  
- 개인별 세션에 의존하지 않고,  
- 동일한 맥락과 원칙을 바탕으로,  
- AI가 지속적으로 학습하고 개선하는 개발 환경을 갖출 수 있다.
