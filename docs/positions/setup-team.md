# 📘 Ant AI-Native AutoDev Platform — 기술 조직 구성안

본 문서는 Ant의 AI-Native 개발 자동화 플랫폼 구축을 위해  
필요한 핵심 기술 조직(5개 Role)의 구성, 역할(R&R), 채용 요건을 제안하기 위해 작성됨.

---

# 1. 조직도 (Org Structure)

```
Chief AI Architect (기존 인력: 1명)
 ├── AI Systems Engineer (신규 채용: 1명)
 ├── AI Orchestration Engineer (신규 채용: 1명)
 ├── Platform/Backend Engineer (신규 채용: 1명)
 ├── Frontend Engineer (기존 인력 차출: 1명)
 └── Product Designer (신규 채용: 1명)
```

---

# 2. Role & Responsibility (R&R)

## 2.1 Chief AI Architect *(기존 인력 – Harvey)*

**역할:**  
Ant AutoDev 엔진의 전체 기술 구조를 설계하며,  
AI·플랫폼·오케스트레이션·백엔드·프론트 등 시스템 전반의 기술 방향성을 총괄한다.  
기획/설계 능력 또한 보유하여 제품의 핵심 기능 정의와 기술적 검증을 담당한다.

**주요 R&R**  
- AutoDev 엔진 전체 아키텍처 설계  
- LLM Orchestration(Agent Graph, Tool Calling, State Machine) 총괄  
- 플랫폼/백엔드/프론트 전반의 기술 구조 및 기준 수립  
- 기능 기획 및 기술 검증  
- 코드 구조·품질 기준 정의  
- 채용 인력의 기술 리딩 및 리뷰  
- AI Systems, Orchestration, Platform, Frontend 조직의 최종 기술 의사결정

---

## 2.2 AI Systems Engineer (신규 채용: 1명)

**역할 요약:**  
AutoDev 엔진이 코드베이스·문서·설계를 정확히 이해하도록 지원하는  
RAG/Chunking/Embedding/VectorDB 기반의 “지식 품질 담당자”.

**주요 R&R**  
- 코드·문서·설계 기반 chunking 전략 개발  
- Embedding 및 Vector DB 파이프라인 구축  
- Hybrid Retrieval, Re-ranking 구조 설계  
- Query Routing 및 Metadata schema 설계  
- Context 품질 최적화(Recall/Precision 기반)  
- LLM 입력 데이터 품질 유지 및 개선

**필수 자격 요건**  
- ML/DL 기반 실무 경험 2~7년  
- Python 기반 ML 스택(PyTorch/Transformers) 숙련  
- Vector DB / RAG / Retrieval 경험  
- 코드 또는 문서 기반 Embedding 경험

**우대 요건 (학력 포함)**  
- NLP/IR/Information Retrieval 전공 **석사 이상 우대**  
- LLM-Reranker, Hybrid Retrieval 연구/경험  
- 코드 RAG 프로젝트 경험  
- AI 연구 경력 또는 논문 실적 보유자 우대

---

## 2.3 AI Orchestration Engineer (신규 채용: 1명)

**역할 요약:**  
AI 에이전트가 “PRD → 설계 → 코드 → 검증 → 배포”를 자동으로 수행하도록  
Agent Graph·Prompt System·Tool Calling 구조를 만드는 핵심 엔지니어.

**주요 R&R**  
- LangGraph 기반 agent workflow 설계  
- 멀티 스텝 LLM 오케스트레이션 개발  
- Tool Calling/Function Calling 시스템 구축  
- Prompt Template 구조화  
- Retry Logic / Resume / Session State 개발  
- AI Systems / Backend와의 end-to-end 통합

**필수 자격 요건**  
- LLM 기반 제품 개발 경험 2~6년  
- LangChain/LangGraph 실무 경험  
- Multi-Step Workflow 설계 경험  
- Typescript 또는 Python 숙련

**우대 요건 (학력 포함)**  
- LLM Orchestration/Prompt Automation 관련 **석사 우대**  
- Agent 기반 AutoDev, 코드 생성 워크플로우 경험  
- Model function-calling 활용 경험 다수

---

## 2.4 Platform/Backend Engineer (신규 채용: 1명)

**역할 요약:**  
AI가 생성한 코드를 실제로 저장·실행·관리할 수 있도록  
플랫폼 백엔드 및 클라우드 기반 시스템을 구축하는 핵심 역할.

**주요 R&R**  
- Backend API 서버(Node/Go/Python) 설계 및 개발  
- 조직/계정/권한(RBAC) 모델 설계  
- 멀티테넌시 기반 workspace 격리 구조 개발  
- AI 엔진과 통신하는 Backend Endpoints 개발  
- 파일 시스템 abstraction API 개발  
- Worker/Job 실행 API 및 클라우드 리소스 orchestration  
- DB·로그·세션 아키텍처 구축  
- DevOps와 협업하여 CI/CD 및 배포 구조 연동

**필수 자격 요건**  
- 백엔드 개발 4~10년  
- REST/GraphQL API 설계 경험  
- RBAC/Account/Organization 구조 개발 경험  
- AWS/GCP 기반 서비스 운영 경험  
- DB 스키마 설계 및 트랜잭션 처리 능숙

**우대 요건**  
- 멀티테넌시 SaaS 플랫폼 경험  
- 분산 시스템/메시징 구조 경험  
- AI 플랫폼 Backend 개발 경험  
- 파일시스템 abstraction 구조 이해

---

## 2.5 Frontend Engineer *(기존 인력 차출 – 1명 고려중)*

**역할 요약:**  
AutoDev 엔진의 동작 과정을 사용자에게 직관적으로 보여주는  
고난도 대시보드·툴링 기반 UI를 개발하는 역할.

**주요 R&R**  
- React/Next.js 기반 앱 개발  
- 디자인 시스템 기반 컴포넌트 구축  
- 파일 탐색기/File Diff Viewer 개발  
- LLM 스트리밍 인터페이스 개발  
- Graph/Node 기반 파이프라인 UI 개발  
- 상태관리·성능 최적화  
- Product Designer와의 협업으로 UX 품질 극대화

**필수 자격 요건**  
- React/Next.js 실무 3~8년  
- Design System/Storybook 개발 경험  
- 대시보드·툴링류 UI 프로젝트 경험  
- 상태관리(Zustand/Recoil/Redux) 숙련

**우대 요건**  
- 개발자 툴/IDE류 UI 경험  
- Code Diff Viewer / Graph UI 구현 경험  
- AI 모델 기반 인터페이스 경험  
- Framer Motion 등 인터랙션 능력

---

## 2.6 Product Designer (신규 채용: 1명)

**역할 요약:**  
AutoDev 제품의 UX·UI 각 요소를 구조화하고  
복잡한 개발 툴링 인터페이스를 시각화하는 핵심 디자이너.

**직속 배치 사유:**  
본 플랫폼은 일반적인 서비스 UI가 아니라  
복잡한 기술 흐름·노드 그래프·파일 구조·코드 변화를 다루는  
특수한 UX 영역을 포함하고 있다.  
회사 내부 디자인팀과는 역할 및 작업 방식이 상이하여  
기술·UX 간 빠른 의사결정, 요구사항의 즉시 반영,  
개발 워크플로우에 밀접한 UI 개선을 위해  
Chief AI Architect 조직에 **전담 디자이너를 직속 배치하는 것이 가장 효율적**이다.

**주요 R&R**  
- 전체 UX Flow 설계  
- 컴포넌트 기반 디자인 시스템 구축  
- Graph/Node 기반 Workflow UI 디자인  
- 복잡한 기술 기능을 직관적으로 시각화  
- Frontend Engineer와 협업해 구현 품질 확보  
- 내부 데모·고객용 화면 품질 향상

**필수 자격 요건**  
- UX/UI 실무 3~8년  
- 웹앱·툴링 기반 디자인 경험  
- 컴포넌트 기반 디자인 시스템 구축 경험  
- Figma 고급 활용 능력

**우대 요건**  
- 개발자 도구/대시보드/관리 콘솔 UX 경험  
- 그래프/플로우 기반 UI 설계 경험  
- B2B SaaS UX 경험

---

# 3. 결론 (Conclusion)

본 조직 구성안은 AutoDev 플랫폼 개발에 필요한 역할을 체계적으로 분리하고,  
각 직군의 책임 범위와 기술적 필요성을 명확히 정의하는 것을 목표로 한다.  
이를 통해 기술 조직이 효율적으로 제품 개발에 집중할 수 있는 기반을 마련하며,  
플랫폼 고도화 및 서비스 안정성 확보에 기여할 것으로 기대된다.

---

# End of Document
