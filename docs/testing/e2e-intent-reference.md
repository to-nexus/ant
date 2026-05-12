# Intent E2E Reference

수동 E2E 테스트 시 참조용. 실제 서버를 띄운 상태에서 각 intent별로 API를 호출한다.

## 사전 조건

```bash
pnpm dev:infra        # Redis + ChromaDB
pnpm dev:all    # API + Realtime + Job + Preview + UI + site
```

워크스페이스와 피처가 미리 생성되어 있어야 함.

---

## Plan

### gen-plan

```bash
curl -X POST http://localhost:4100/api/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "directive": "팀 협업 프로젝트 관리 웹 서비스를 기획해줘",
    "actionMetadata": {
      "explicit": true,
      "intent": "gen-plan"
    }
  }'
```

- **예상 Triage**: agent=planner, jobType=plan
- **예상 산출물**: `plan/prd.md`
- **PASS 기준**: prd.md 생성되고 "프로젝트 관리" 키워드 포함

### rev-plan

```bash
curl -X POST http://localhost:4100/api/jobs \
  -d '{
    "directive": "소셜 로그인을 추가하고 게스트 모드를 삭제해줘",
    "actionMetadata": {
      "explicit": true,
      "intent": "rev-plan",
      "refs": ["plan/prd.md"]
    }
  }'
```

- **예상 Triage**: agent=planner, jobType=plan, mode=refactor
- **예상 산출물**: `plan/prd.md` (수정)
- **PASS 기준**: 소셜 로그인 관련 내용 추가, 게스트 모드 삭제

---

## System Design

### gen-sys-fe

```bash
curl -X POST http://localhost:4100/api/jobs \
  -d '{
    "directive": "React로 프론트엔드 시스템 설계해줘",
    "actionMetadata": {
      "explicit": true,
      "intent": "gen-sys-fe",
      "refs": ["plan/prd.md"]
    }
  }'
```

- **예상 Triage**: agent=architect, jobType=design, workType=system-design, environment=frontend
- **예상 산출물**: `architecture/system/fe-system-*.md`
- **PASS 기준**: fe-system-main.md 생성, React/frontend 관련 내용 포함

### gen-sys-be

```bash
curl -X POST http://localhost:4100/api/jobs \
  -d '{
    "directive": "Express 백엔드 시스템 설계해줘",
    "actionMetadata": {
      "explicit": true,
      "intent": "gen-sys-be",
      "refs": ["plan/prd.md"]
    }
  }'
```

- **예상 Triage**: agent=architect, jobType=design, workType=system-design, environment=backend
- **예상 산출물**: `architecture/system/be-system-*.md`, `architecture/system/api-contract-*.md`
- **PASS 기준**: be-system-main.md 및 api-contract-main.md 생성

### gen-sys-full

```bash
curl -X POST http://localhost:4100/api/jobs \
  -d '{
    "directive": "풀스택 시스템 설계해줘",
    "actionMetadata": {
      "explicit": true,
      "intent": "gen-sys-full",
      "refs": ["plan/prd.md"]
    }
  }'
```

- **예상 Triage**: agent=architect, jobType=design, workType=system-design, environment=fullstack
- **예상 산출물**: `architecture/system/fe-system-*.md`, `architecture/system/be-system-*.md`, `architecture/system/api-contract-*.md`
- **PASS 기준**: 프론트엔드 + 백엔드 + API 계약 문서 모두 생성

### rev-sys

```bash
curl -X POST http://localhost:4100/api/jobs \
  -d '{
    "directive": "인증 방식을 OAuth로 변경해줘",
    "actionMetadata": {
      "explicit": true,
      "intent": "rev-sys",
      "refs": ["architecture/system/fe-system-main.md"]
    }
  }'
```

- **예상 Triage**: agent=architect, jobType=design, mode=refactor, workType=system-design
- **예상 산출물**: `architecture/system/fe-system-main.md` (수정)
- **PASS 기준**: OAuth 관련 내용으로 수정

---

## UI Design

### gen-ui-figma

```bash
curl -X POST http://localhost:4100/api/jobs \
  -d '{
    "directive": "Figma 파일에서 UI 설계를 추출해줘",
    "actionMetadata": {
      "explicit": true,
      "intent": "gen-ui-figma",
      "refs": ["visual/ui/figma/figma.json"]
    }
  }'
```

- **예상 Triage**: agent=architect, jobType=design, workType=ui-design
- **예상 산출물**: `visual/ui/ant/ui-tokens.json`, `visual/ui/ant/ui-assets.json`, `visual/ui/ant/ui-spec.json`
- **PASS 기준**: 3개 UI 설계 파일 생성
- **참고**: figma.json은 `{ "file": "<figma-url>" }` 형식의 설정 파일. 프롬프트에 내용 주입 없음.

### gen-ui-desc

```bash
curl -X POST http://localhost:4100/api/jobs \
  -d '{
    "directive": "PRD 기반으로 UI 설계해줘",
    "actionMetadata": {
      "explicit": true,
      "intent": "gen-ui-desc",
      "refs": ["plan/prd.md"]
    }
  }'
```

- **예상 Triage**: agent=architect, jobType=design, workType=ui-design
- **예상 산출물**: `visual/ui/ant/ui-tokens.json`, `visual/ui/ant/ui-assets.json`, `visual/ui/ant/ui-spec.json`
- **PASS 기준**: 3개 UI 설계 파일 생성

### rev-ui

```bash
curl -X POST http://localhost:4100/api/jobs \
  -d '{
    "directive": "색상 팔레트를 다크 테마로 변경해줘",
    "actionMetadata": {
      "explicit": true,
      "intent": "rev-ui",
      "refs": ["visual/ui/ant/ui-tokens.json"]
    }
  }'
```

- **예상 Triage**: agent=architect, jobType=design, mode=refactor, workType=ui-design
- **예상 산출물**: `visual/ui/ant/ui-tokens.json` (수정)
- **PASS 기준**: 다크 테마 색상으로 변경

---

## Spec

### gen-spec

```bash
curl -X POST http://localhost:4100/api/jobs \
  -d '{
    "directive": "설계 문서 기반으로 태스크 검색 API 스펙을 작성해줘",
    "actionMetadata": {
      "explicit": true,
      "intent": "gen-spec",
      "refs": ["architecture/system/be-system-main.md"]
    }
  }'
```

- **예상 Triage**: agent=architect, jobType=design, workType=spec
- **예상 산출물**: `architecture/spec/spec-*.md`
- **PASS 기준**: 스펙 파일 생성

### rev-spec

```bash
curl -X POST http://localhost:4100/api/jobs \
  -d '{
    "directive": "페이지네이션을 offset에서 cursor로 변경해줘",
    "actionMetadata": {
      "explicit": true,
      "intent": "rev-spec",
      "refs": ["architecture/spec/spec-search-api.md"]
    }
  }'
```

- **예상 Triage**: agent=architect, jobType=design, mode=refactor, workType=spec
- **예상 산출물**: `architecture/spec/spec-search-api.md` (수정)
- **PASS 기준**: cursor 기반 페이지네이션으로 변경

---

## Code

### gen-code-sys

```bash
curl -X POST http://localhost:4100/api/jobs \
  -d '{
    "directive": "설계 문서 기반으로 코드 생성해줘",
    "actionMetadata": {
      "explicit": true,
      "intent": "gen-code-sys",
      "refs": ["architecture/system/fe-system-main.md"],
      "context": ["visual/ui/ant/ui-spec.json"]
    }
  }'
```

- **예상 Triage**: agent=architect, jobType=code, mode=generate
- **예상 산출물**: 코드베이스에 소스 코드 파일
- **PASS 기준**: 프론트엔드 코드 생성 (React 컴포넌트, 라우팅 등)

### gen-code-spec

```bash
curl -X POST http://localhost:4100/api/jobs \
  -d '{
    "directive": "스펙 기반으로 태스크 검색 API를 구현해줘",
    "actionMetadata": {
      "explicit": true,
      "intent": "gen-code-spec",
      "refs": ["architecture/spec/spec-search-api.md"],
      "context": ["architecture/system/be-system-main.md"]
    }
  }'
```

- **예상 Triage**: agent=architect, jobType=code, mode=generate
- **예상 산출물**: 코드베이스에 API 엔드포인트 코드
- **PASS 기준**: 태스크 검색 API 엔드포인트 구현

### gen-code-directive

```bash
curl -X POST http://localhost:4100/api/jobs \
  -d '{
    "directive": "간단한 TODO 앱을 만들어줘",
    "actionMetadata": {
      "explicit": true,
      "intent": "gen-code-directive"
    }
  }'
```

- **예상 Triage**: agent=architect, jobType=code, mode=generate
- **예상 산출물**: 코드베이스에 소스 코드 파일
- **PASS 기준**: 지시문만으로 앱 골격 또는 요청 범위에 맞는 코드 생성

### rev-code (스펙·문서 기준)

```bash
curl -X POST http://localhost:4100/api/jobs \
  -d '{
    "directive": "스펙 문서 기반으로 코드를 리팩토링해줘",
    "actionMetadata": {
      "explicit": true,
      "intent": "rev-code",
      "refs": ["architecture/spec/spec-search-api.md"]
    }
  }'
```

- **예상 Triage**: agent=architect, jobType=code, mode=refactor
- **예상 산출물**: 기존 코드 수정
- **PASS 기준**: 스펙에 맞게 코드 수정, behavioral debugging injection 포함

### rev-code (지시문만)

```bash
curl -X POST http://localhost:4100/api/jobs \
  -d '{
    "directive": "성능 최적화를 위해 코드를 리팩토링해줘",
    "actionMetadata": {
      "explicit": true,
      "intent": "rev-code"
    }
  }'
```

- **예상 Triage**: agent=architect, jobType=code, mode=refactor
- **예상 산출물**: 기존 코드 최적화
- **PASS 기준**: refactor-guidance injection 포함

---

## 디버그 절차

자동 테스트 실패 시:
1. vitest 스냅샷 diff 확인 (어떤 injection이 바뀌었는지)
2. 실제 서버에서 해당 intent 실행
3. `sessions/{agent}/debug/prompts/prompt-{jobId}.md` 확인
4. `sessions/{agent}/debug/logs/log-{jobId}.json` 확인
