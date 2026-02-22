# Prompt Safety Gate

## Purpose

Prompt Safety Gate ensures that **template changes never silently break LLM behavior**.

When you modify any `.md` template, injection mapping, or runtime assembly function,
`npm test` catches regressions before they reach production.

## What it covers

| Test Type | What it checks | File |
|-----------|----------------|------|
| Partial registration | All Handlebars partials load without errors | `prompt-smoke.test.ts` |
| Template smoke | Every `.md` template renders without crash | `prompt-smoke.test.ts` |
| Injection manifest | All injection templates are listed in manifest | `prompt-smoke.test.ts` |
| Runtime assembly (code) | `buildRuntimeContext`, `generateFileTree` produce expected sections | `runtime-context.test.ts` |
| Runtime assembly (design) | Design `buildRuntimeContext` produces expected sections | `runtime-context.test.ts` |

## Developer workflow

```
1. Edit a template (.md) or prompt assembly function
2. Run: npm test                  (dev 중 수동 확인)
3. If PASS -> commit
4. If FAIL -> fix before commit
5. Run: npm run build             (prebuild가 자동으로 test 실행)
6. If test FAIL -> build 중단     (dist/ 미생성)
7. If test PASS -> esbuild + 배포
```

Monorepo root에서 실행:
```
pnpm test:cli                     # ant-cli 테스트만 실행
pnpm build:cli                    # test -> build (자동)
```

### What a failure means

- **Partial registration failed**: A `.md` template file is missing or unreadable.
- **Template rendered empty**: A template produced empty output when given sample context (check `ALLOWED_EMPTY` if intentional).
- **Injection manifest mismatch**: A new injection template was added but not registered in `injection-manifest.json`.
- **Runtime assembly assertion failed**: A prompt assembly function is missing expected sections given sample state.

## Safety mechanisms (what changed)

### Before (silent failures)

- 41 `.catch(() => {})` blocks in FilePromptAdapter swallowed all errors
- TemplateComposer returned empty string on failure, job continued with half-empty prompt
- No tests existed; broken templates discovered only in production

### After (fail-fast)

- `initPartials()` is awaited at server startup; failures are reported
- TemplateComposer throws on base/rules template failure (critical path)
- Non-critical templates (injections, examples) log warnings
- `npm test` gate catches template and assembly regressions

## Prompt injection paths

All LLM prompts flow through exactly 2 paths:

| Path | Description | Safety |
|------|-------------|--------|
| A: Template rendering | `.md` templates rendered via FilePromptAdapter | Smoke tested (all 90 templates) |
| B: Runtime assembly | TypeScript functions assemble dynamic context from state | Unit tested (buildRuntimeContext, generateFileTree) |

## Adding a new template

1. Create `templates/<job>/phases/<phase>/<type>.md`
2. If it's an injection: add entry to `injection-manifest.json`
3. If it needs partials: add to `PARTIAL_DEFINITIONS` in `FilePromptAdapter.ts`
4. Run `npm test` to verify

## Adding a new runtime context function

1. Implement the function in the appropriate `promptBuilder.ts`
2. Add test cases to `runtime-context.test.ts` with sample state
3. Run `npm test` to verify

## CI integration

This gate runs as part of the standard `npm test` command.
See [03-ci-gate-minimum.md](03-ci-gate-minimum.md) for PR merge policy.
