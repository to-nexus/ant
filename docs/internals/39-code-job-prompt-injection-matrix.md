# Code-Job Prompt Injection Matrix

> Companion to [13-prompt-system.md](13-prompt-system.md) (PromptBuilder + 4-tier) and
> [14-code-job.md](14-code-job.md) (code-job graph). This document is the **structural
> reference** for *which prompt templates/partials are injected, for a code job, as a
> deterministic function of the runtime axes* — and the **invariant that prevents the most
> common false positive** when auditing prompt quality.

## Why this exists

The injected prompt for a code-job node is a **pure function** of a fixed set of axes. The gates
are independent (a set of `if`s), so the surface is *not* a cartesian explosion — it is a base
set plus per-gate additions. Auditing prompt quality (FPOP / MECE / SBS / fragmentation) requires
knowing exactly what renders where, because **the same file renders under opposite constraints in
different nodes** (decompose context-blind vs execute gated). Missing that fact produces audit
false positives (see [§5](#5-the-dispatch-table-invariant-audit-false-positive-guard)).

## 1. The injection-decision engine (SSOT modules)

| Layer | SSOT | What it decides |
|---|---|---|
| **Tier I — intent policies** | [`PromptBuilder.resolveInjections`](../../packages/ant-cli/src/core/prompt/builder/PromptBuilder.ts) + [`prompt-policy-matrix.ts`](../../packages/ant-shared/src/prompt-policy-matrix.ts) | Always injects `jobs/shared/injections/output-tag-policy`; then `getPromptPolicies(intent)` → `POLICY_TEMPLATE_MAP`. Code intents inject UI / game-art design policy *only when* a `visual/ui` \| `visual/game-art/ant` slot is present (conditional). |
| **Tier A/D — auto** | [`AutoInjectionResolver.resolve`](../../packages/ant-cli/src/core/prompt/builder/AutoInjectionResolver.ts) | ~18 independent gates (see [§2](#2-autoinjectionresolver-gate-inventory)). |
| **Basis section** | [`PromptBuilder.buildBasisSection`](../../packages/ant-cli/src/core/prompt/builder/PromptBuilder.ts) | Matrix-gated (`isTierActive`) tier render: domain → techTier → visualTier → gameArtTier → gameContentTier. |
| **taskType → variant** | [`templatePaths.ts`](../../packages/ant-cli/src/core/prompt/builder/templatePaths.ts) + `hooksForTaskType` | Per-node base/rules variant selection. |
| **Per-node composition** | each node | How the node assembles the above. |

### Axes (all read independently)

`node` · `taskType` · `mode` · `job` · `language` · `framework` · `stack` · `domain` · `intent` ·
data flags (`hasDirective`, `hasMemory`, `hasRetryContext`, `hasLessons`, `hasSessionContext`,
`hasMissingDependency`, `hasRuntimeError`, `hasCodebase`) · derived (`hasFrontend`, `hasBackend`) ·
matrix flags (`visualTierActive`, `gameArtTierActive`, `gameContentTierActive`).

Strict allowlists (no silent fallback — prevents injecting a file that does not exist):
- language hints: `{typescript-node, typescript-browser, go}`
- framework hints (code): `{nextjs, react, react-native, nestjs, gin}`
- techTier-hint taskType allowlist: `{verification, error, ui, feature, setup, test-code}` (NOT `doc`/`explain`).

## 2. AutoInjectionResolver gate inventory

Predicate → injected path. Citations are to [`AutoInjectionResolver.ts`](../../packages/ant-cli/src/core/prompt/builder/AutoInjectionResolver.ts).

| Predicate | Injects |
|---|---|
| `data.hasDirective` | `jobs/shared/injections/directive` |
| `data.hasMemory` | `jobs/shared/injections/memory` |
| `!skipStaticPolicy && hasFrontend` (skip on verification/error/test-code/doc) | `jobs/shared/injections/visual-source-authority` |
| `taskType === 'setup' && job === 'code'` | `…/execute/basis/techTier/{lang}/setup/constraints` |
| `job ∈ {code,design}` | `resolveTechTierInjections()` → `basis/techTier/framework/{fw}` + `language/{lang}` |
| `mode==='refactor' \|\| taskType==='error'` | `…/injections/behavioral-debugging` |
| `node==='execute' && !skipEnvRules && language && hasFrontend` | `…/injections/preview-setup` |
| `node==='execute' && isError && hasFrontend` | `…/injections/preview-setup` |
| `node==='execute' && isTestCode && language` | `…/execute/basis/techTier/{lang}/test-code/hints` |
| `node==='execute' && hasBackend && !verification && !doc` | `…/execute/injections/backend-safety` |
| `node==='execute' && !isTestCode && !isDoc` | `…/injections/preview-env-contract` + `…/execute/injections/port-management` |
| `node==='execute' && taskType ∈ {ui,design-system}` | `ui-source-dispatch` (service) \| `game-art-source` (game) |
| `job==='code'` (execute) | `…/injections/response-language` (self-gated on non-en) |
| `node==='execute' && data.has{Retry,Lessons,Session,MissingDependency,Runtime}…` | matching `…/execute/injections/{retry-context,lessons,session-context,missing-dependency-fix,runtime-error-fix}` |
| `node==='execute' && taskType==='setup' && language` | `…/execute/basis/techTier/{lang}/setup/config` |
| `deriveCodebaseRole(intent,{hasCodebase})` truthy | `jobs/shared/injections/codebase-channel` (self-gated) |
| `resolvedAction` present | `action-context` (+ `refactor-guidance` \| `explain-guidance` by mode) |

`computeStackFlags`: `hasFrontend` = tiers empty OR any `stack ∈ {frontend,fullstack}`; `hasBackend` = any `stack ∈ {backend,fullstack}`.

## 3. Per-node composition (critical asymmetry)

| Node | Assembly | Tier A? | Renders shared injections… |
|---|---|---|---|
| `direct`, `execute` | full `build(config)` | **yes** | **gated** (language/framework known) |
| `plan` | `renderBasis()` + `render(base, vars)` | basis only | basis gated; does **not** render `preview-env-contract` |
| `decompose` | manual `render(path, {})` ([decompose/index.ts:472-500](../../packages/ant-cli/src/agents/architect/graph/code/nodes/decompose/index.ts)) | **NO** | **whole / context-blind** — framework hints + `preview-env-contract` rendered with `{}` |
| `revise` | single decision template | no | — |

`execute` variants: dedicated `{verification, error, docgen}`, else `default`.
`plan` variants: dedicated `{verification, error}`, else generic. `decompose`: single variant.

## 4. Worked matrix cells — `{typescript, nextjs, frontend, service}`

| Cell (node · taskType) | Basis | Notable Tier A/D | Variant base/rules |
|---|---|---|---|
| execute · feature | domain/service, stack/frontend, ts `_common`+browser, nextjs(+`_react-core`,+entry-points) | output-tag, preview-setup, preview-env-contract, port-management, response-language, techTier hints, action-context | execute/variants/default |
| execute · ui | + ui-source-dispatch→ui-source-ant | + ui-design-policy (conditional) | execute/variants/default |
| execute · setup | + setup/{constraints,config} | preview-* + setup seed | execute/variants/default |
| execute · error | techTier hints | behavioral-debugging, preview-setup, backend-safety (if hasBackend) | execute/variants/error |
| execute · verification | techTier hints | **no** preview-setup (skipEnvRules), **no** visual-source-authority | execute/variants/verification |
| plan · feature | renderBasis (gated) | basis only | plan/base+rules |
| decompose | rendered whole, context-blind | framework/nextjs hint + **whole** preview-env-contract (`{}`) | decompose/variants/default |

## 5. The dispatch-table invariant (audit false-positive guard)

**Shared / job-base injections legitimately enumerate framework / package-manager / language
specifics in tables. This is NOT an FPOP "Universal over Specific" violation. Do not "fix" it by
gating.** Two structural reasons mandate the whole enumeration:

1. **`decompose` has no Tier A and renders context-blind (`{}`).** It plans across the *whole*,
   possibly fullstack (FE + BE) project. A `preview-env-contract` that hid its Go-TOML section
   behind `{{#if (eq language "go")}}` would render **nothing** at decompose (no `language` var),
   breaking cross-stack planning for a Next.js-FE + Go-BE project.
2. **The resolver knows `language` but not `packageManager`** (manager ≠ language: a TS project
   may be pnpm / npm / yarn / bun). So files like `missing-dependency-fix` and
   `monorepo-install-locality` **must** present the full per-manager table — the LLM picks by
   observing the lockfile, which is more robust than trusting a tier value.

These are **dispatch tables**: the LLM selects the applicable row from observed evidence. The
specificity floor (SBS) is satisfied because the table's *gate* is "the project uses one of
these," not "the project uses framework X."

Corollary — **genuine FPOP leaks vs dispatch tables**: a file that hardcodes **one** framework as
*the* canonical example (e.g. an execute-default few-shot saying "use Tailwind classes") IS a leak
— it misdirects every other stack. A file that **enumerates all** options for the LLM to choose
from is a dispatch table. Audit on this distinction.

Likewise verified-deliberate (do not re-flag): `persistent-process-policy` separates
*persistent* (`keep_running:true`, self-kill) from *bounded smoke check* (`keep_running:false`,
auto-kills) — two tool modes, not a contradiction.

## 6. How to audit prompt quality (method)

1. Resolve the injected set for the cell under review using [§1–§4](#1-the-injection-decision-engine-ssot-modules).
2. Apply the six axes: injection structure · FPOP · MECE · SBS · fragmentation · SSOT consistency.
3. For every candidate finding, run a **side-effect review across all nodes that render the file**
   (decompose context-blind vs execute gated), then classify:
   - **A — deliberate** (dispatch table / context-blind necessity / intentional design) → no edit.
   - **B — real defect**, side-effect-free → safe to fix (e.g. single-framework hardcode, stale path).
   - **C — investigate** (load-bearing behavioral rule, or a design change with regression surface) → report, do not pre-edit.
4. The healthy reference layer is `basis/techTier/**` — gated, SBS-compliant, version-current.
   Converge toward it; do not rewrite it.

## Related

- [13-prompt-system.md](13-prompt-system.md) — PromptBuilder tiers, partial auto-registration.
- [14-code-job.md](14-code-job.md) — code-job graph nodes.
- [36-output-tag-matrix.md](36-output-tag-matrix.md) — canonical tag rendering SSOT.
- [38-service-virtualization.md](38-service-virtualization.md) — the SV partials + `USE_MOCK_*` toggle SSOT referenced by `preview-env-contract §4.5`.
- Regression guards: `tests/prompt/**`, `tests/policy/**`.
