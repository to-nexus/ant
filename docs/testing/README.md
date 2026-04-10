# Testing

두 가지 테스트 체계:

| 문서 | 성격 | 실행 방법 |
|------|------|----------|
| `e2e-runbook.md` | 수동 E2E (인프라 필요) | 서버 4개 + Redis 띄우고 curl |
| `prompt-test-spec.md` | 자동 테스트 (인프라 불필요) | `pnpm test:cli` (~1초) |

## Quick start

```bash
# 자동 테스트 (일상적으로 이것만 하면 됨)
pnpm test:cli                # 889 tests, ~1초

# 빌드 (테스트 자동 포함)
pnpm build                   # prebuild → vitest run → esbuild
```

## Definition of green

- `pnpm test:cli`가 PASS (~1초)
- E2E smoke 5개가 PASS (서버 띄운 상태에서)
