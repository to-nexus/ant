# Triage & Routing

## 개요

Triage는 사용자 입력을 분석하여 적절한 처리 경로로 라우팅하는 시스템이다. 2단계 분류(Intent -> WorkStatus)로 동작하며, 워크스페이스 상태 기반으로 진행 가능 여부를 판단한다.

## 분류 체계

### 1단계: Intent

| Intent | 설명 | 라우팅 |
|--------|------|--------|
| `ask` | 질문, 도움 요청, 모호한 입력 | Ask 시스템으로 위임 |
| `work` | 명확한 작업 요청 | 2단계 Work Status 판정 |

모호한 경우 `ask`로 분류한다.

### 2단계: Work Status

| Status | 설명 | 처리 |
|--------|------|------|
| `proceed` | 현재 Job + 준비 완료 | 기존 흐름 진행 |
| `redirect` | 다른 Job이 더 적합 | 사용자 승인 후 전환 |
| `blocked` | 준비물 부족 | 안내 + 선택지 |

## Prerequisites

### Required vs Recommended

| 구분 | 없으면 | canProceed |
|------|--------|-----------|
| Required | 진행 불가 | false |
| Recommended | 품질 저하 | true (선택) |

### Job별 Prerequisites

**Design Job (ui-design 모드)**
- Required: `inputs/references/screens/` (화면 캡처)
- Recommended: `inputs/references/components/`, `inputs/assets/`

**Design Job (system-design 모드)**
- Required: PRD 또는 directive
- Recommended: 기존 코드베이스

**Code Job (신규 개발)**
- Required: design documents (`outputs/design/`) 또는 directive
- Recommended: indexed codebase

**Code Job (수정)**
- directive만으로 진행 가능

**Learn Job**
- Required: git repository

## 워크스페이스 상태

Triage 노드는 `workspaceAnalyzer`를 통해 현재 워크스페이스 상태를 수집한다.

| 상태 필드 | 검사 대상 |
|-----------|----------|
| `hasPrd` | `inputs/sources/prd.md` 존재 및 실질 콘텐츠 유무 |
| `hasDirective` | directive 또는 채팅 입력 존재 |
| `hasScreens` | `inputs/references/screens/` 파일 존재 |
| `hasDesignDoc` | `outputs/design/` 내 설계 문서 존재 |
| `hasCodebase` | 벡터 DB 인덱스 존재 |

### 템플릿 마커 감지

Feature 초기화 시 빈 입력 파일에 `ant:template` 마커가 삽입된다. HTML 주석을 제거한 후 남은 실질 콘텐츠가 200자 미만이면 템플릿(빈 파일)으로 취급한다. 200자 이상이면 마커만 strip하고 실제 문서로 사용한다.

## Choice 시스템

### 선택이 필요한 케이스

| 상황 | needsChoice | 선택지 |
|------|-------------|--------|
| proceed | false | 없음 |
| redirect | true | 전환 확인 |
| blocked (canProceed: true) | true | 진행 여부 |
| blocked (canProceed: false) | false | 안내만 |

### ChoiceAction

| Action | 의미 |
|--------|------|
| `proceed` | 정상 진행 |
| `proceedAnyway` | 경고 무시 진행 |
| `redirect` | 다른 Job으로 전환 |
| `guide` | 가이드 제공 (부정 선택 시 항상) |

부정 선택은 항상 `guide`를 반환한다. 막다른 길이 없다.

### 처리 흐름

1. Triage 노드에서 `needsChoice = true` 판정
2. ChoiceCard를 채팅으로 전송
3. Job을 `awaiting_choice` interruption으로 일시 중단
4. 사용자 선택 시 `POST /chat/triage-choice` 호출
5. `guide`면 가이드 응답 전송, 그 외면 Job 재개

## LLM 호출

Triage는 1회 LLM 호출로 분류와 응답을 동시에 생성한다. 프롬프트는 WHAT/HOW 분리 구조를 따른다:
- `templates/triage/base.md`: 세션 정보, 사용자 입력, 워크스페이스 상태, prerequisites
- `templates/triage/rules.md`: 분류 규칙, guardrails, 응답 형식

`skipTriage` 플래그가 설정되면 Triage를 건너뛰고 바로 proceed한다.

## 경계

- Ask 의도 처리: [08-ask-system.md](08-ask-system.md)
- Choice Card UI: [12-chat-system.md](12-chat-system.md)
- 프롬프트 템플릿 구조: [13-prompt-system.md](13-prompt-system.md)
