# Testing

## 테스트 체계

| 구분 | 명령 | 인프라 | 용도 |
|------|------|--------|------|
| Unit/Snapshot | `pnpm test:cli` | 불필요 | 프롬프트·RAC·유틸 회귀 방지 (빌드 게이트) |
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
pnpm dev:local:mock          # CLI 4개 프로세스 (local + LLM mock)
pnpm test:e2e                # 별도 터미널에서 실행

# 3. 빌드 (유닛 테스트 자동 포함)
pnpm build                   # prebuild → vitest run → esbuild
```

## Pre-build 게이트

`packages/ant-cli/package.json`의 `prebuild` 스크립트가 `vitest run`을 실행한다.
`vitest.config.ts`에서 `tests/**/*.test.ts`를 include하므로, 해당 경로에 `.test.ts` 파일을 추가하면 자동으로 빌드 게이트에 포함된다.

```
prebuild: vitest run → FAIL이면 빌드 중단 (dist/ 미생성)
```

## Definition of green

- `pnpm test:cli`가 PASS (~1초)
- `pnpm test:e2e`가 PASS (mock 서버 기동 상태에서)
