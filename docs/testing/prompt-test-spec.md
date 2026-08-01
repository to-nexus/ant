# Prompt System Test Specification

Automated test specification for the prompt system. Everything runs with a single `pnpm test:cli`. The gate is CI, not the build.

---

## Test Layers (MECE)

```
A. Coverage (reachability)
│  template-reverse-matrix.test.ts ─── reverse reachability for all 148 .md files + JSON matrix generation
│  tech-tier-registry.test.ts ──────── TECH_TIER_TEMPLATE_PATHS ↔ on-disk file sync
│
B. Integrity
│  invariant-audit.test.ts ─────────── manifest↔file consistency, legacy variables forbidden,
│                                      TS→template path back-references, file existence per resolve() combination
│  prompt-smoke.test.ts ────────────── exhaustive partial registration, render of every template including basis/, manifest consistency
│
C. Injection Resolution (injection paths)
│  injection-resolution-matrix.test.ts  Tier I/A/D/N 4-layer combination matrix
│  intents/intent-acceptance.test.ts ── 16 intents × required/forbidden injections + snapshots
│
D. Build Pipeline
│  prompt-build-e2e.test.ts ────────── PromptBuilder.build() 8-scenario E2E
│                                      Stage 1: path resolution / Stage 2: render success / Stage 3: content injection
│  artifact-injection-e2e.test.ts ──── forward E2E of per-role artifact injection + per-path directive injection (12 scenarios)
│                                      + JSON matrix generation (__generated__/artifact-injection-matrix.json)
│  artifact-injection-audit.test.ts ── static audit of artifacts passing at build() call sites + decompose include (single injection SSOT)
│  prompt-integration.test.ts ──────── ArtifactPipeline, document assembly scenarios
│  documents-pipeline-audit.test.ts ── regression mirror of the documents pipeline
│
E. Hardening
│  prompt-immutability.test.ts ─────── resolve/render input immutability
│  techtier-propagation.test.ts ────── techTier propagation with/without decompose
│  threshold-boundary.test.ts ──────── EXECUTE/DECOMPOSE_SOURCE_THRESHOLD boundary values
│  rac-serialization.test.ts ───────── RAC JSON roundtrip preservation
│
F. Context & Routing
│  runtime-context.test.ts ─────────── buildRuntimeContext, generateFileTree
│  triage-prompt.test.ts ──────────── buildTriagePrompt structure + snapshots
│  rac.test.ts ─────────────────────── resolveToRAC, deriveFromIntent
│  rac-matrix.test.ts ──────────────── config-matrix completeness
│  rac-creation-audit.test.ts ──────── RAC creation (explicit/infer/derive)
│
G. Non-prompt
   triage-parser.test.ts, triage-guard.test.ts, classify-parser.test.ts,
   tool-registry.test.ts, command-allowlist.test.ts, content-compactor.test.ts,
   artifact-ownership-routing.test.ts, ask-knowledge.test.ts,
   batch-split-fix.test.ts, human-id.test.ts
```

---

## A. Coverage (Reachability)

### template-reverse-matrix.test.ts

For each of the 148 `.md` files under `templates/`, traces back 7 kinds of reachability sources.

| Source | Meaning |
|------|------|
| `build-callsite` | Hard-coded in `promptBuilder.build()`'s `templates.base/rules/system` |
| `auto-injection` | Result of exhaustively executing `AutoInjectionResolver.resolve()` over all combinations |
| `policy-map` | Registered in `POLICY_TEMPLATE_MAP` (Tier I/N) |
| `render-call` | Direct `render()`/`readFileSync()` call from agent TS code |
| `partial-ref` | Handlebars partial reference `{{> path}}` from another template |
| `basis-registry` | `buildBasisSection` injection based on `TECH_TIER_TEMPLATE_PATHS` |
| `manifest` | Contract registration in `injection-manifest.json` |

Verification:
- **A file with zero sources = orphan → test failure** (fail, not warn)
- Injection templates must be registered in the manifest
- `tests/__generated__/template-matrix.json` is auto-generated (for debugging/review)

### tech-tier-registry.test.ts

Verifies 1:1 sync between the paths pointed to by the `TECH_TIER_TEMPLATE_PATHS` registry in `@ant/shared` and the `.md` files on disk. Also detects orphan files in the reverse direction.

---

## B. Integrity

### invariant-audit.test.ts

4 audit items:

| ID | Verification | On failure |
|----|------|---------|
| 6A | Every manifest entry is used by at least one of AutoInjectionResolver, partial, POLICY_TEMPLATE_MAP, agent render | **fail** |
| 6B | Legacy variables `{{designDoc}}`, `{{prdSpec}}`, `{{uiDoc}}` are forbidden in templates | fail |
| 6C | A `.md` file exists at every `render('path')`/`templates: { base: 'path' }` path in agent TS code | fail |
| 6D | A `.md` file exists at every path produced by exhaustively executing `AutoInjectionResolver.resolve()` over all combinations | fail |

6C expands `${var}` variables in template literals into UI suffixes (`by-figma`/`by-desc`), languages (`typescript`/`go`), tool names (`run_command`), etc.

### prompt-smoke.test.ts

| Verification | Target |
|------|------|
| Exhaustive partial loading | 0 `initPartials()` failures |
| All-template render | All 148 files, **including basis/**. Non-empty output with no errors using `SAMPLE_VARS` |
| Manifest consistency | Every `.md` under an `/injections/` path exists in the manifest |
| Partial reference integrity | The partial pointed to by `{{> path}}` is registered |
| Catalog references | `§` references in design templates match canonical catalog names |

---

## C. Injection Resolution (Injection Paths)

### injection-resolution-matrix.test.ts

Exhaustive combinatorial verification of the 4-layer injection system:

| Layer | Verification |
|------|------|
| Tier I (Intent) | prompt-policy exists for every intent, PolicyKey→path mapping |
| Tier N (Artifact) | Conditional policy activation/deactivation based on artifact presence |
| Tier A (Auto-tech) | taskType × stack × mode × node matrix |
| Tier D (Data) | Injection conditions per 12 data flags (directive, memory, gitDiff...) |

### intents/intent-acceptance.test.ts

16 fixtures × 3 stages:

| Stage | Verification |
|-------|------|
| 1. Config Matrix | `getConfigSlots(intent)` is valid |
| 2. RAC Routing | `resolveToRAC()` → agent/jobType/mode/intentGroup match |
| 3. Prompt Build | `PromptBuilder.build()` → requiredInjections included, forbiddenInjections excluded, snapshot |

---

## D. Build Pipeline

### prompt-build-e2e.test.ts

8 scenarios mirroring the 5 production call sites:

| Scenario | Pipeline config | Key verification |
|----------|---------------|-----------|
| Code execute (default/feature) | full | system+basis+rules+injections+examples all non-empty |
| Code execute (verification) | includeExamples=off | static policies skipped, tool-calling not included in injections |
| Code execute (error+fullstack) | includeExamples=off | preview-setup + backend-safety + behavioral-debugging |
| Code execute (refactor) | includeBasis=off | refactor-guidance + behavioral-debugging |
| Design system-design (FE) | includeBasis=on | Tier I frontend-guide, document-language |
| Design spec | minimal | 0 injections |
| Ask | no pipeline | base+rules only |
| Plan | no techContext | Tier A/D inactive |

In each scenario, **3-stage runtime injection verification**:

1. **Stage 1 (paths)**: expected paths included/excluded in `result.injections`
2. **Stage 2 (render)**: 0 entries in `result.sections.failedTemplates`
3. **Stage 3 (content)**: each injection template's fingerprint text present in `result.system`

### artifact-injection-e2e.test.ts

Verifies per-role artifact injection (`ref`/`context`/`directive`) and per-path directive injection in the forward direction. 12 scenarios:

| Scenario | Template | Key verification |
|----------|--------|-----------|
| A1. code execute: ref+context | code/execute/default | ref→Primary, context→Background, no cross-over |
| A2. code execute: ref only | code/execute/default | ref→Primary, Background header empty |
| A3. code execute: context only | code/execute/default | context→Background, no ref |
| A4. no artifacts, no resolvedAction | code/execute/default | Primary/Background headers absent altogether |
| A5. defensive bridge | code/execute/default | resolvedAction.artifacts only, without config.artifacts → bridge kicks in |
| A6. spec: partial path | design/spec | marker in result.user (partial path, not injections) |
| A7. verification | code/execute/verification | action-context skipped |
| A8. directive role: silent drop | code/execute/default | `role='directive'` omitted from both |
| D1. code execute: directive truthy | code/execute/default | `# Directive` in sections.injections |
| D2. code execute: directive empty | code/execute/default | no directive injection |
| D3. spec: runtimeContext | design/spec | directive in result.user (partial path) |
| D4. plan: base template | plan/default | directive in result.user (direct `{{directive}}`) |

`tests/__generated__/artifact-injection-matrix.json` is auto-generated.

### artifact-injection-audit.test.ts

Reverse static audit (7 cases):

| Group | Target files | Verification |
|------|-----------|------|
| 2-A. build() call sites | code/execute/buildMessages, design/execute/intent/system, design/execute/intent/spec | `artifacts` keyword present |
| 2-B. decompose nodes | code/decompose/responseParser, design/decompose/uiDesign·systemDesign·spec | `include` keyword present + `artifactPolicy` absent |

### prompt-integration.test.ts

`ArtifactPipeline`'s `selectArtifacts`, document assembly scenarios (per-taskType selection/exclusion).

### documents-pipeline-audit.test.ts

Regression mirror test of the documents-pipeline logic. Verifies by replicating the real code patterns as pure functions.

---

## E. Hardening

| Test | Verification |
|--------|------|
| prompt-immutability.test.ts | Input immutability of `resolve()`, `compactContent`, `resolveToRAC` |
| techtier-propagation.test.ts | techTier propagation with/without going through decompose + injection results |
| threshold-boundary.test.ts | EXECUTE/DECOMPOSE_SOURCE_THRESHOLD boundary-value transitions |
| rac-serialization.test.ts | RAC JSON roundtrip: explicit/infer, special chars, undefined fields |

---

## F. Context & Routing

| Test | Verification |
|--------|------|
| runtime-context.test.ts | `buildRuntimeContext`, `generateFileTree` output strings |
| triage-prompt.test.ts | `buildTriagePrompt` system/user structure + snapshots |
| rac.test.ts | Unit tests for `resolveToRAC`, `deriveFromIntent` |
| rac-matrix.test.ts | config-matrix completeness, exhaustive `resolveToRAC` |
| rac-creation-audit.test.ts | RAC creation (explicit/infer/derive) variants |

---

## Change Workflows

### Adding a template (.md)

1. Create the file under `templates/`
2. If it is an injection, add it to `injection-manifest.json`
3. `pnpm test:cli` → `template-reverse-matrix` verifies reachability
4. If it is an orphan, the test fails → wiring code (render call, partial reference, etc.) must be added

### Deleting a template

1. Delete the file
2. `pnpm test:cli` → `invariant-audit` 6C detects the reference-integrity failure
3. Remove the references from code and re-run

### Changing AutoInjectionResolver

1. Modify the code
2. `pnpm test:cli` → injection-resolution-matrix + invariant-audit 6D verify the paths
3. If an intent-acceptance snapshot diff appears, run with `--update`

### Changing PromptBuilder / the pipeline

1. Modify the code
2. `pnpm test:cli` → prompt-build-e2e runs the 8-scenario E2E verification
3. intent-acceptance Stage 3 compares the injection-list snapshot

### Changing artifact/directive injection

1. Modify action-context.md, directive.md, the PromptBuilder bridge, and the build() call sites
2. `pnpm test:cli` → artifact-injection-e2e verifies per-role rendering across the 12 scenarios
3. artifact-injection-audit audits artifacts passing at call sites + the decompose include configuration (and artifactPolicy absence)
4. Track injection-path changes via the `artifact-injection-matrix.json` diff

---

## Injection Matrix by TaskType

| injection | feature | setup | verification | error | test-code | doc |
|-----------|---------|-------|-------------|-------|-----------|-----|
| tool-calling-rules-compact | O | O | X | X | X | X |
| preview-setup (frontend) | O | O | X | O | X | X |
| preview-env-contract | O | O | O | O | X | X |
| port-management | O | O | O | O | X | X |
| backend-safety (backend) | O | O | X | O | O | X |
| visual-source-authority (frontend) | O | O | X | O | X | X |
| test-code hints | X | X | X | X | O | X |
| ui-source-dispatch | X(feature) | X | X | X | X | X |
| ui-source-dispatch (taskType=ui OR design-system) | O | - | - | - | O | - |

---

## Prompt Build Path Map

```
RAC creation ─→ Documents pipeline ─→ PromptBuilder.build() (execute/execute) ─→ LLM
                                   └→ promptBuilder.render() (plan/decompose/detect) ─→ LLM
```

- **build() path**: Tier I/A/D/N injection resolution → assembly of system + profiles + rules + injections + examples → guardrails wrapping
- **render() path**: direct rendering of a single template (plan, decompose, detect, revise, triage, visual, learn)

---

## References

- Prompt system architecture: `docs/internals/13-prompt-system.md`
- RAC types: `packages/ant-shared/src/rac.ts`
- PromptBuilder: `packages/ant-cli/src/core/prompt/builder/PromptBuilder.ts`
- AutoInjectionResolver: `packages/ant-cli/src/core/prompt/builder/AutoInjectionResolver.ts`
- ArtifactRoleResolver: `packages/ant-cli/src/core/prompt/builder/ArtifactRoleResolver.ts`
- prompt-policy-matrix: `packages/ant-shared/src/prompt-policy-matrix.ts`
- injection-manifest: `packages/ant-cli/src/core/prompt/injection-manifest.json`
- Auto-generated matrix: `packages/ant-cli/tests/__generated__/template-matrix.json`
- Artifact injection matrix: `packages/ant-cli/tests/__generated__/artifact-injection-matrix.json`
