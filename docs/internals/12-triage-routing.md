# Triage & Routing

## Overview

Triage is the system that analyzes user input and routes it to the appropriate processing path. It operates as a two-stage classification (Intent → WorkStatus) and decides whether work can proceed based on workspace state.

## Architecture: 3-Layer Classification Pipeline

Classification decisions pass through 3 layers in order, each with a clearly distinct role.

```
User Input
    │
    ▼
┌─────────────────────────────────────────────┐
│  Layer 1: Prompt (LLM classification)       │
│  rules.md + base.md + YAML job data         │
│  Role: single source for all               │
│        classification decisions             │
│  Output: <triage> JSON (intent, workStatus, │
│        suggestedJob, suggestedAgent, ...)    │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│  Layer 2: Parser (symmetric correction)     │
│  parser.ts - parseTriageResponse()          │
│  Role: JSON format validation +             │
│        hallucination correction             │
│  Rules (applied uniformly to all boundaries)│
│   1. redirect-to-same → proceed             │
│   2. explicit redirect → redirect           │
│   3. proceed + job/agent mismatch leak      │
│      + redirectReason → redirect (force)    │
│   4. everything else → LLM verdict as-is    │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│  Layer 3: Guard (plan outbound only)        │
│  index.ts - hasTargetJobPrerequisites()     │
│  Role: on plan→other redirect, verify the   │
│        target job's input material exists   │
│  Design decision: directive intentionally   │
│  excluded (directive is always true →       │
│  including it would neutralize the guard)   │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
              TriageResult
```

### Per-Layer Design Principles

**Layer 1 (Prompt)**: The LLM is the sole classifier. Follows FPOP principles. All classification rules are concentrated in rules.md.

**Layer 2 (Parser)**: Performs only format validation of the LLM response and hallucination correction. Makes no business-logic judgments. Applies the same logic uniformly to every boundary (job-transition direction) — no boundary-specific special-casing.

**Layer 3 (Guard)**: Applies only to plan outbound redirects. Because the plan job enforces the PRD-generation workflow, the redirect is blocked when the target job lacks input material (PRD, screens, etc.). Other jobs don't apply the guard, since a chat directive alone is sufficient for them.

## Classification Scheme

### Stage 1: Intent

| Intent | Description | Routing |
|--------|------|--------|
| `ask` | Questions, help requests, ambiguous input | Delegated to the Ask system |
| `work` | Clear work requests | Proceeds to Stage 2 Work Status determination |

Ambiguous cases are classified as `ask`.

### Stage 2: Work Status

| Status | Description | Handling |
|--------|------|------|
| `proceed` | Current Job + ready | Continue the existing flow |
| `redirect` | Another Job is a better fit | Switch after user approval |
| `blocked` | Missing prerequisites | Guidance + choices |

### Classification Rules (rules.md)

Classification Protocol steps in rules.md:

| Step | Role | Applies when |
|------|------|----------|
| Step 1 | Intent classification (ask vs work) | Always |
| Step 2 | Job Match (request target → job) | work intent |
| Step 2.5 | Spec Suggestion | code job + work + Step 2 classified as code |
| Step 2.7 | Agent Match (architect vs planner) | work intent |
| Step 3 | Status determination (proceed/redirect/blocked) | work intent |

**Design ↔ Plan Boundary**: Canonically defined in Step 2. In the design/plan jobs, do not redirect unless the user explicitly names the other job's artifact, and the `suggestedJob`/`suggestedAgent` fields must be omitted from the response entirely.

## Parser Correction Rules

`parseTriageResponse()` parses the LLM response JSON and applies the following corrections uniformly:

| Rule | Trigger | Action | Intent |
|------|--------|------|------|
| redirect-to-same | `workStatus=redirect` + target=current job | → `proceed` | Defense against LLM hallucination |
| force-redirect (job) | `workStatus=proceed` + `suggestedJob≠current` + `redirectReason` present | → `redirect` | Catches confused LLM state |
| force-redirect (agent) | `workStatus=proceed` + `suggestedAgent≠current` | → `redirect` | Catches cross-agent confusion |

These rules apply identically to every job-transition direction (no asymmetric exceptions).

## Prerequisites

### Required vs Recommended

| Category | If missing | canProceed |
|------|--------|-----------|
| Required | Cannot proceed | false |
| Recommended | Quality degradation | true (optional) |

### Per-Job Prerequisites

**Design Job (ui-design mode)**
- Required: `visual/ui/figma/figma.json` (Figma mode) or PRD/directive (description mode)
- Recommended: `assets/` (user-provided assets)

**Design Job (system-design mode)**
- Required: PRD or directive
- Recommended: existing codebase

**Code Job (new development)**
- Required: design documents (`architecture/system/`, `architecture/spec/`, `visual/ui/`) or directive
- Recommended: indexed codebase

**Code Job (modification)**
- Can proceed with a directive alone

**Learn Job**
- Required: git repository

### Plan Outbound Prerequisite Guard

When redirecting from the plan job to another job, `hasTargetJobPrerequisites()` checks whether the target job has input material.

| Target Job | Required condition |
|------------|----------|
| design | hasPrd \|\| hasAssets \|\| hasFigmaConfig |
| code | hasPrd \|\| hasDesignDoc \|\| hasCodebase |
| learn | hasCodebase |
| visual | Always true (a directive alone is sufficient) |
| plan | Always true |

**Design decision**: `hasDirective` is intentionally excluded. A directive is always true whenever there is chat input, so including it would neutralize the guard. This guard applies only to plan outbound; for other jobs a directive alone is sufficient input.

## Workspace State

The Triage node collects the current workspace state via `workspaceAnalyzer`.

| State field | What it checks |
|-----------|----------|
| `hasPrd` | `plan/prd.md` exists and has substantive content |
| `hasDirective` | A directive or chat input exists |
| `hasFigmaConfig` | `visual/ui/figma/figma.json` populated |
| `hasAssets` | Asset files exist under `assets/` |
| `hasDesignDoc` | Design documents exist under `architecture/` or `visual/` |
| `hasCodebase` | Vector DB index exists |
| `hasArchitectureSpec` | `architecture/spec/spec-*.md` files exist |
| `hasArchitectureSystem` | `architecture/system/{fe,be}-system-*.md`, `architecture/system/api-contract-*.md` files exist |

### Template Marker Detection

During feature initialization, an `ant:template` marker is inserted into empty input files. After stripping HTML comments, if the remaining substantive content is under 200 characters, the file is treated as a template (empty file). At 200 characters or more, only the marker is stripped and the file is used as a real document.

## Choice System

### Cases Requiring a Choice

| Situation | needsChoice | Choices |
|------|-------------|--------|
| proceed | false | None |
| redirect | true | Confirm the switch |
| blocked (canProceed: true) | true | Whether to proceed |
| blocked (canProceed: false) | false | Guidance only |

### ChoiceAction

| Action | Meaning |
|--------|------|
| `proceed` | Proceed normally |
| `proceedAnyway` | Proceed ignoring the warning |
| `redirect` | Switch to another Job |
| `guide` | Provide guidance (always offered on a negative choice) |
| `dismiss` | Cancel the work |

A negative choice always returns `guide`. There are no dead ends.

### Processing Flow

1. The Triage node determines `needsChoice = true`
2. A ChoiceCard is sent to chat + a pending choice is registered in Redis
3. The Job is routed to `__end__` and paused
4. When the user chooses, `POST /chat/triage-choice` is called
5. ChoiceService looks up the pending choice in Redis and processes it
6. `redirect` → start a new Job, `proceed` → restart the current Job (skipTriage=true), `dismiss` → cancel

## LLM Invocation

Triage generates the classification and the response in a single LLM call. The prompt follows the WHAT/HOW split structure:
- `templates/triage/base.md`: session info, user input, workspace state
- `templates/triage/rules.md`: classification rules, guardrails, response format

Job capability information is loaded from YAML data (`core/data/triage/jobs/*.yaml`) and injected into the prompt's `## AVAILABLE JOBS` section. The YAML's `redirect_signals` are described in FPOP observation terms (observing the request target, not keyword matching).

When the `skipTriage` flag is set, Triage is skipped and the job proceeds directly. This flag is set only when restarting after the user made a selection on a ChoiceCard.

## Tests

### Test Structure

| File | Cases | Role |
|------|--------|------|
| `tests/triage-parser.test.ts` | 25 | Full coverage of parser correction logic |
| `tests/triage-guard.test.ts` | 15 | Prerequisite guard function |
| `tests/triage-prompt.test.ts` | 3 | Prompt structure validation + snapshot |

All tests are **deterministic** (no LLM required, run with vitest).

### How to Run

```bash
# Full test suite
cd packages/ant-cli && pnpm test

# Triage tests only
npx vitest run tests/triage-parser.test.ts tests/triage-guard.test.ts tests/triage-prompt.test.ts

# Update snapshots after a prompt change
npx vitest run tests/triage-prompt.test.ts --update
```

### Parser Test Coverage

| Category | What is verified |
|----------|----------|
| Format validation | No triage block, malformed JSON, missing intent → null |
| Ask intent | inScope true/false branches |
| Work proceed | Normal proceed |
| Explicit redirect | code→design (spec labels), design→code (normal labels) |
| Redirect-to-same (M1) | Redirect to the same job → corrected to proceed |
| Force-redirect (M3) | proceed + suggestedJob mismatch + redirectReason → redirect |
| Force-redirect (M4) | proceed + suggestedAgent mismatch → redirect |
| Symmetry | Confirms the same logic applies to plan outbound and design→plan alike |
| Blocked | canProceed true/false, proceedAnywayOption combinations |

### Guard Test Coverage

| What is verified |
|----------|
| design: PRD/screens/components/assets each → true |
| design: all false → false |
| code: PRD/designDoc/codebase each → true |
| code: all false → false |
| learn: codebase true/false |
| plan: always true |
| directive exclusion confirmed (directive only → false for design, code) |

### Notes When Changing Prompts

1. After editing rules.md, run `npx vitest run tests/triage-prompt.test.ts` to review the snapshot diff
2. If the change is intended, refresh the snapshot with `--update`
3. Edits to YAML redirect_signals are also reflected in the snapshot (YAML → injected into the prompt)

## File Structure

```
packages/ant-cli/src/
├── agents/common/nodes/triage/
│   ├── index.ts              # Triage node + guard + router
│   ├── parser.ts             # LLM response parsing + symmetric correction
│   ├── types.ts              # TriageResult, WorkspaceState, etc.
│   ├── workspaceAnalyzer.ts  # Workspace state collection
│   └── AgentRegistry.ts      # YAML job data loading + prompt generation
├── core/
│   ├── prompt/templates/triage/
│   │   ├── base.md           # WHAT: session, input, state
│   │   └── rules.md          # HOW: classification rules, reminders
│   └── data/triage/jobs/
│       ├── code.yaml         # Code job definition
│       ├── design.yaml       # Design job definition
│       ├── learn.yaml        # Learn job definition
│       ├── plan.yaml         # Plan job definition
│       └── visual.yaml       # Visual job definition
└── infrastructure/choice/
    └── ChoiceService.ts      # User choice management (Redis)

tests/
├── triage-parser.test.ts     # Parser correction logic
├── triage-guard.test.ts      # Prerequisite guard
└── triage-prompt.test.ts     # Prompt structure snapshot
```

## Boundaries

- Ask intent handling: [17-ask-system.md](17-ask-system.md)
- Choice Card UI: [31-chat-system.md](31-chat-system.md)
- Prompt template structure: [13-prompt-system.md](13-prompt-system.md)
