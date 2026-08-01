# Testing

## 테스트 체계

| 구분 | 명령 | 인프라 | 용도 |
|------|------|--------|------|
| Unit/Snapshot | `pnpm test:cli` | 불필요 | 프롬프트·RAC·유틸 회귀 방지 (CI 게이트) |
| Verification Scenarios | `pnpm --filter @ant/cli scenario [id\|--all]` | LLM mock (process-internal) | verification 루프 분기 회귀 |
| E2E Mock | `pnpm test:e2e` | mock 서버 필요 | HTTP → 큐 → 워커 전체 경로 자동 검증 |
| E2E Real | curl (수동) | 서버 + LLM API key | 실제 LLM 포함 전체 파이프라인 |

참고 문서:
- `prompt-test-spec.md` — Unit/Snapshot 테스트 사양 (프롬프트 전용)
- `verification-scenarios.md` — code job verification 루프 분기 회귀 하네스 (L1 + L2)
- `e2e-runbook.md` — E2E Real 수동 절차
- `e2e-intent-reference.md` — Intent별 curl 레퍼런스

## Quick start

```bash
# 1. 유닛 테스트 (일상적으로 이것만)
pnpm test:cli                # 44 files, 1069 tests, ~1초, 인프라 불필요

# 1b. Verification scenarios (L2 회귀)
pnpm --filter @ant/cli scenario --all    # 10 시나리오 (S00~S09), ~25초, mock LLM, Redis 불필요
pnpm --filter @ant/cli scenario S08      # 단일 시나리오
pnpm --filter @ant/cli scenario --list   # 메타데이터만 JSON 출력

# 2. E2E mock 테스트 (서버 띄운 후)
pnpm dev:infra               # Redis + ChromaDB
pnpm dev:mock                # CLI 4개 프로세스 + LLM mock
pnpm test:e2e                # 별도 터미널에서 실행

# 3. 빌드 (테스트를 실행하지 않는다)
pnpm build                   # esbuild only
```

## CI 게이트

**빌드는 테스트를 실행하지 않는다.** `prebuild` 훅은 없으며 추가해서도 안 된다 —
`packages/ant-cli/Dockerfile` 이 `pnpm build:cli` 로 빌드하므로 모든 이미지 빌드에 전체
스위트를 물리는 것은 의도적 non-goal 이다.

유일한 게이트는 CI ([.github/workflows/ci.yml](../../.github/workflows/ci.yml)) 이며
`typecheck:cli` · `typecheck:ui` · `typecheck:tests` · `test:cli` · `@ant/ui test` 와
`oss-guard` · `boot-smoke` 잡을 실행한다. `vitest.config.ts` 가 `tests/**/*.test.ts` 를
include 하므로 해당 경로에 `.test.ts` 를 추가하면 자동으로 CI 게이트에 포함된다.

```
CI: test:cli FAIL → PR 머지 차단
```

## Definition of green

- `pnpm test:cli`가 PASS (~1초)
- `pnpm test:e2e`가 PASS (mock 서버 기동 상태에서)
