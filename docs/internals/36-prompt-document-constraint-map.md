# Prompt-Document Constraint Map

A **path index**: when a document constraint for `system design` / `spec` / `PRD`
changes, this tells you which code and template paths need editing.

This document holds no rules of its own. Prompt-authoring policy (FPOP / SBS /
MECE) lives in [13-prompt-system.md](13-prompt-system.md) and
[AGENTS.md § Prompt Engineering](../../AGENTS.md#prompt-engineering) — do not
restate it here.

## Prompt template structure SSOT

| Axis | SSOT path | Responsibility |
|---|---|---|
| Prompt assembly | [`core/prompt/builder/PromptBuilder.ts`](../../packages/ant-cli/src/core/prompt/builder/PromptBuilder.ts) | Single `build(config)` entry point; assembles sections/system/user |
| Tier A/D injection | [`core/prompt/builder/AutoInjectionResolver.ts`](../../packages/ant-cli/src/core/prompt/builder/AutoInjectionResolver.ts) | Auto-injection based on tech / task / mode / data-presence |
| Tier N injection | [`core/prompt/builder/ArtifactRoleResolver.ts`](../../packages/ant-cli/src/core/prompt/builder/ArtifactRoleResolver.ts) | Policy injection based on RAC artifact-presence conditions |
| RAC document loading | [`agents/common/graph/loadDocumentsForRAC.ts`](../../packages/ant-cli/src/agents/common/graph/loadDocumentsForRAC.ts) | refs/context loading, `uiSource` exclusivity check |
| RAC contract | [`@ant/shared/rac.ts`](../../packages/ant-shared/src/rac.ts) | `resolveToRAC` / `getRACDocuments` contract |
| Template root | [`core/prompt/templates/`](../../packages/ant-cli/src/core/prompt/templates/) | Prompt bodies for jobs / basis / domain / injections |

## Document constraint → prompt reflection paths

### System design documents

| Stage | Path | Constraint reflection |
|---|---|---|
| Design detect/decompose | `design/nodes/detect/*`, `design/nodes/decompose/systemDesignDecompose.ts` | Decides workType/documentType and the target file group |
| Design execute (system) | `design/nodes/execute/intent/system.ts` | Injects system-design rules/guide, applies the sealed plan |
| Code consumption | `code/nodes/plan/llm/prompt.ts`, `code/nodes/execute/buildMessages.ts` | Turns it into code-work input via the `hasSystemDesign` gate |

### Spec documents

| Stage | Path | Constraint reflection |
|---|---|---|
| Design plan (spec) | `design/nodes/plan/*` | Generates the sealed `<plan>` for the spec intentGroup |
| Design execute (spec) | `design/nodes/execute/intent/spec.ts` | Spec variant templates + sealed-plan prepend |
| Code consumption | `code/nodes/decompose/*`, `code/nodes/plan/*` | Restricts spec scope via include/policy |

### PRD documents

| Stage | Path | Constraint reflection |
|---|---|---|
| Planner plan/execute | `planner/graph/plan/nodes/{plan,execute}/*` | Target-based PRD generation, clarify loop |
| Design input | `design/nodes/plan/*`, `design/nodes/execute/*` | Injects planText/PRD into `runtimeContext` |
| Code input | `code/nodes/resolve/*`, `code/nodes/decompose/*` | Injects the PRD scoped via RAC refs/context |

Paths are relative to `packages/ant-cli/src/agents/`.

## Diagram contract

[`jobs/shared/injections/diagram-contract.md`](../../packages/ant-cli/src/core/prompt/templates/jobs/shared/injections/diagram-contract.md)
is the single shared contract for plan / design / code-docgen: **Mermaid first,
ASCII fallback**. ant-ui's Markdown renderer renders `language-mermaid` as SVG,
so default output converges on Mermaid; the ASCII fallback is what keeps a
diagram minimally interpretable in render-incapable environments.

## Codebase mutation gate

Prompts for document-producing jobs (design plan/execute, planner plan, code
plan) state that the deliverable is markdown/JSON and close the semantic axis of
inputs like `decision` to "subject of description", which pre-empts attempts to
mutate the codebase. Actual blocking is owned by the tool handlers + the
FileRenderer XML guard — **the prompt does not substitute for the guard**. The
code job plan's `run_command` is an orthogonal responsibility
(`allowShellExecution`) and is not a blocking target: it has legitimate uses
(verification gates, test-runner installation, error diagnosis, dep discovery).
Policy SSOT: [15-design-job.md § Codebase mutation gate](15-design-job.md#codebase-mutation-gate).

## Boundaries

- Prompt system SSOT: [13-prompt-system.md](13-prompt-system.md)
- Code-job injection gates: [39-code-job-prompt-injection-matrix.md](39-code-job-prompt-injection-matrix.md)
- Design Job behavior: [15-design-job.md](15-design-job.md)
- Planner Job (PRD): [16-planner-job.md](16-planner-job.md)
- Code Job consumption paths: [14-code-job.md](14-code-job.md)
- Design pipeline details: [25-design-pipeline.md](25-design-pipeline.md)
- Graph structure rules: [NODE_GRAPH_LAYOUT.md](NODE_GRAPH_LAYOUT.md)
