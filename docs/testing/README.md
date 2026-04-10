# Testing

세 가지 테스트 체계:

| 구분 | 명령 | 인프라 | 용도 |
|------|------|--------|------|
| Unit/Snapshot | `pnpm test:cli` | 불필요 | 프롬프트 파이프라인 회귀 방지 (빌드 게이트) |
| E2E Mock | `pnpm test:e2e` | mock 서버 필요 | HTTP → 큐 → 워커 전체 경로 자동 검증 |
| E2E Real | curl (수동) | 서버 + LLM API key | 실제 LLM 포함 전체 파이프라인 |

참고 문서:
- `prompt-test-spec.md` — Unit/Snapshot 테스트 사양
- `e2e-runbook.md` — E2E Real 수동 절차
- `e2e-intent-reference.md` — Intent별 curl 레퍼런스

## Quick start

```bash
# 1. 유닛 테스트 (일상적으로 이것만)
pnpm test:cli                # 969 tests, ~1초, 인프라 불필요

# 2. E2E mock 테스트 (서버 띄운 후)
pnpm dev:infra               # Redis + ChromaDB
pnpm dev:local:mock          # CLI 4개 프로세스 (local + LLM mock)
pnpm test:e2e                # 별도 터미널에서 실행

# 3. 빌드 (유닛 테스트 자동 포함)
pnpm build                   # prebuild → vitest run → esbuild
```

## 핵심 테스트

### Intent Acceptance (80 tests, ~270ms)

16개 intent × basis 변형 = 22개 fixture로 전체 프롬프트 파이프라인을 검증.
서버/LLM 없이 순수 함수 호출만으로 동작.

- Config Matrix 정합성 (intent + basis 조합 유효성)
- RAC 라우팅 (intent → agent/jobType/jobMode/workType/environment)
- ModeController injection 정확성 (환경/언어/프레임워크 판단 → injection 선택/배제)
- 프롬프트 텍스트 키워드 포함 + injection 목록 스냅샷 회귀 방지

상세: `prompt-test-spec.md` > Intent Acceptance 참조.

### E2E Mock Smoke

`ANT_LLM_MOCK=true`로 서버를 띄우면 모든 LLM 호출이 `MockLLMClient`의 canned response를 반환.
테스트는 HTTP 요청만 보내서 job enqueue/status를 검증.
서버 미기동 시 자동 skip (빌드 깨지지 않음).

## Definition of green

- `pnpm test:cli`가 PASS (~1초)
- `pnpm test:e2e`가 PASS (mock 서버 기동 상태에서)
