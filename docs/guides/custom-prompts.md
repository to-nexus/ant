# Customizing prompts

Ant's prompts live as Handlebars templates under
`packages/ant-cli/src/core/prompt/templates/`. They auto-register as
partials at server startup, so adding or editing a `.md` file requires no
code change. This guide covers the practical workflow for extending or
overriding prompts.

For binding rules — FPOP, SBS, WHAT/HOW separation — see
[AGENTS.md § Prompt Engineering](../../AGENTS.md#prompt-engineering).

## When (and when not) to customize

Customize prompts when you want to:

- Bake a coding convention specific to your team into every code job.
- Add a framework hint for a stack the default templates don't cover.
- Tighten the UI source contract for your codebase.
- Adjust verification gate language.

**Don't** customize prompts to:

- Change the orchestration logic. Phase order is hard-coded; prompts only
  shape what each phase says.
- Hard-code project-specific examples (`Hero.tsx`, `page.tsx`). Templates
  must stay platform-neutral.

## Directory layout

```
templates/
├── domain/{d}.md                       Workspace-level domain identity
├── basis/                              Tier-gated content (NOT auto-registered)
├── jobs/{job}/
│   ├── base/{system,user,injections}/  Job-level shared blocks
│   ├── domain/{d}.md                   Job × domain overlay
│   ├── basis/                          Job × tier overlay
│   └── nodes/{node}/
│       ├── {base,rules}.md             Default
│       └── variants/{v}/{base,rules}.md  Variant-specific
├── jobs/shared/nodes/{node}/variants/{v}/{base,rules}.md
└── infra/                              Compaction, etc.
```

Files under `templates/basis/**` are intentionally NOT registered as
partials. To use a private partial near a basis file, name it
`_*-private.md` and put it in `jobs/.../basis/...` (which IS registered).

## The four-tier prompt

Every prompt is built by `PromptBuilder.build(config)`. Internally it
composes:

| Tier         | Source                                                      |
|--------------|-------------------------------------------------------------|
| **I**njections | `injections/*.md` — service virtualization, role guide, etc. |
| **A**gents     | `agents/{agent}/system.md` (no top-level `templates/agents/` — agent system prompts live elsewhere) |
| **D**omain/job | `domain/{d}.md`, `jobs/{job}/domain/{d}.md`, `jobs/{job}/base/system.md`, `jobs/{job}/basis/...` |
| **N**odes     | `jobs/{job}/nodes/{node}/{base,rules}.md` and variants     |

The output is two strings (system + user) plus granular sections for
cache-block-aware callers.

## WHAT vs HOW

| Prefix       | Role | Content                                    |
|--------------|------|--------------------------------------------|
| `base*.md`   | WHAT | Context, data, current state, dynamic interpolation (`{{...}}`) |
| `rules*.md`  | HOW  | Rules, formats, constraints, prohibitions  |

For new files, keep them strictly separated: no `⚠️ You MUST` in
`base*.md`, no `{{...}}` interpolations in `rules*.md`.

## FPOP — write principles, not examples

Six rules:

1. **Principles over Examples** — "Each container decides direction
   independently" beats "Footer is column".
2. **What over How** — "Observe cross-axis position" beats "Top → flex-start".
3. **Observable over Assumed** — "If not observed, do NOT add" beats
   "Add overlay".
4. **Universal over Specific** — "component" beats "React component".
5. **Constraints over Instructions** — "Do NOT assume" beats "Do this way".
6. **Reminders for Blind Spots** — "⚠️ Cross-axis REQUIRED" beats a
   generic checklist.

Skip concrete project examples (`Hero.tsx`, `page.tsx`), edge-case
enumerations, value mappings (`Top=flex-start`), and platform-specific
terms (`React`, `Tailwind`, `Next.js`). Templates are platform-neutral.

## SBS — gated specificity

A template's specificity floor equals its activation gate:

| Activation               | Specificity floor                                    |
|--------------------------|------------------------------------------------------|
| Always-on (system)       | Universal — FPOP only                                |
| `framework=nextjs` gate  | Next.js's versions / APIs / toolchain — REQUIRED     |
| `intent=gen-ui-figma`    | Figma MCP / live-fetch contract — REQUIRED            |
| `mode=refactor`          | Refactor-mode invariants — REQUIRED                   |
| `uiSource=handoff`       | FPOP "observe-only" contract — REQUIRED               |

A gated file MUST be specific along the gate; an always-on file MUST
stay universal. Asking `nextjs.md` to drop "Next.js" wording is an SBS
violation.

For each paragraph in a template:

1. **SBS check**: specific along the file's gate?
2. **FPOP check**: specific along an axis other than the file's gate? If
   yes, scope creep — lift it out.

## Common customizations

### Add a framework hint

Example: add a Remix framework variant.

```bash
# 1. Create the techTier framework partial
mkdir -p packages/ant-cli/src/core/prompt/templates/jobs/code/basis/techTier/framework
cat > packages/ant-cli/src/core/prompt/templates/jobs/code/basis/techTier/framework/remix.md <<'EOF'
**Remix conventions**

- Loaders/actions live in `app/routes/*.tsx`.
- Use `useLoaderData()` for server-rendered data; do not duplicate
  in `useEffect`.
- Mutations go through `<Form method="post">`; avoid `fetch()` in
  components for state-changing operations.
EOF
```

Register Remix in the techTier registry (`@ant/shared/tier-matrix.ts`).
Once it's in the registry, the gate fires automatically when the
workspace's techTier matches.

### Override a node template

Want different `decompose` rules for your team's coding style? Create a
local override file:

```
templates/jobs/code/nodes/decompose/variants/<your-variant>/{base,rules}.md
```

Then trigger your variant via a new intent or a custom selector. Variant
selection lives in `nodeNameForVariant()` per node.

### Add a custom injection

Need every code job to remember a project rule (e.g. "all React
components must be functional, no class components")? Add a partial:

```
templates/jobs/code/base/injections/team-conventions.md
```

Wire it in the relevant `jobs/code/base/system.md` with `{{> jobs/code/base/injections/team-conventions}}`.

For codebase-local deviations, prefer `codebase/ANTRULES.md` (per-feature
ledger) over a global injection. See
[AGENTS.md § Codebase Meta Document Policy](../../AGENTS.md#codebase-meta-document-policy).

## Test your changes

Two helpful smoke tests:

```bash
cd packages/ant-cli

# Render every prompt with sample inputs, fail on missing partials
pnpm vitest run tests/prompt/prompt-smoke.test.ts

# Validate FPOP + SBS surface invariants
pnpm vitest run tests/prompt/
```

If you added a new gate, write a regression test that asserts the gate's
discriminator name appears in the rendered prompt.

## Read next

- [internals/13-prompt-system.md](../internals/13-prompt-system.md) —
  full prompt system reference.
- [AGENTS.md § Prompt Engineering](../../AGENTS.md#prompt-engineering) —
  binding rules.
- [internals/35-codebase-meta-policy.md](../internals/35-codebase-meta-policy.md)
  — `ANTRULES.md` per-codebase deviation ledger.
