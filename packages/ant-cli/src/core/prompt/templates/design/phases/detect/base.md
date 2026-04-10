## Design Work Type + Mode + Domain + Environment Detection

You are analyzing a design directive to determine:

1. **workType**: spec | ui-design | system-design | clarify | error
2. **jobMode**: generate | refactor | explain
3. **domain** (system-design only): game | service
4. **environment** (system-design only): frontend | backend | fullstack

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## STEP 1: Determine workType (MECE Classification)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### Observation Protocol

Observe the **scope of work** described in the directive. Every directive falls into exactly one of these categories:


| workType          | Scope Criterion                                                                | Output                                                  |
| ----------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------- |
| **spec**          | Directive scopes to **one feature, task, or bounded change unit**              | `spec-{slug}.md`                                        |
| **ui-design**     | Directive scopes to **visual appearance, interface layout, or design tokens**  | `ui-*.json`                                             |
| **system-design** | Directive scopes to **whole-system architecture or multi-component structure** | `api-contract-*.md`, `be-system-*.md`, `fe-system-*.md` |
| **clarify**       | Scope is **genuinely ambiguous** between spec and system-design                | Asks user to choose                                     |
| **error**         | Modification requested but **target documents do not exist**                   | Error message                                           |


### Constraint: Scope Determines workType, NOT Document Existence

⚠️ **CRITICAL**: The presence or absence of existing documents (`api-contract-*.md`, `be-system-*.md`, `fe-system-*.md`, etc.) MUST NOT influence your workType decision. Document existence only affects `jobMode` (Step 2).

- Existing system docs present + feature-scoped directive → **still spec** (NOT system-design refactor)
- Existing system docs absent + architecture-scoped directive → **still system-design**

### Principle: Feature Scope vs Architecture Scope

**Observe what the directive names:**


| Observation                                                                             | workType          |
| --------------------------------------------------------------------------------------- | ----------------- |
| Directive names a **single feature, endpoint, flow, or change**                         | **spec**          |
| Directive references **existing spec-*.md** by name                                     | **spec**          |
| Directive references **visual design, screens, or appearance**                          | **ui-design**     |
| Directive references **overall architecture, system structure, or multiple components** | **system-design** |
| Directive explicitly uses **"시스템 디자인"**, **"아키텍처"**, **"system design"**                | **system-design** |


### Constraint: When to Output clarify

Output `"clarify"` ONLY when you **genuinely cannot determine** whether the directive is feature-scoped (spec) or architecture-scoped (system-design).

**Do NOT output clarify when:**

- The directive clearly names a specific feature → **spec** (confident)
- The directive clearly references system architecture → **system-design** (confident)
- The directive clearly references visual/UI work → **ui-design** (confident)

**Output clarify when:**

- The directive is vague AND could equally mean "create a spec for feature X" or "redesign the system architecture"
- The directive uses ambiguous terms without naming a specific feature OR system structure

⚠️ **Blind Spot**: Feature addition requests (e.g., "add payment feature", "결제 기능 추가") are almost always **spec**, not system-design refactor. Adding a feature means specifying NEW work, not modifying the existing architecture document.

### Constraint: Error Conditions

Output `"error"` ONLY when directive explicitly requests **modification of specific existing documents** that do not exist:

- UI modification requested but no UI docs exist → error
- System doc modification requested but no system docs exist → error

### Constraint: PRD Analysis is Out of Scope

If the directive ONLY asks to analyze, explain, or query PRD content (without requesting design artifacts), this is NOT a design job task.

- Do NOT classify PRD-only analysis as `spec`
- Do NOT classify PRD-only analysis as `system-design`
- Output `error` with errorType `out_of_scope` and message directing user to the plan job

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## STEP 2: Determine jobMode

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### Observation Protocol

Observe the **intent** of the directive with respect to existing documents:


| Observation                                                                                                      | jobMode    |
| ---------------------------------------------------------------------------------------------------------------- | ---------- |
| Directive explicitly asks to **understand, summarize, or explain the content of existing design/spec documents** | `explain`  |
| Directive asks to **modify, update, or improve** a specific part of existing documents                           | `refactor` |
| Directive asks to **create new** content, **solve a problem**, or **plan implementation**                        | `generate` |


**Constraint**: `explain` and `refactor` require that **documents for the same tier** exist. If they do not exist, fall back to `generate`.

**Constraint**: `explain` ONLY applies when the **subject of analysis is an existing design/spec document itself**. If the directive asks to analyze a **problem, bug, codebase behavior, or issue**, the intent is to produce a new spec — use `generate`.

⚠️ **Blind Spot — "analyze" ≠ explain**: Directives like "analyze why X fails", "investigate the problem", "debug this issue", or "분석해라" (analyze) are requests to **create a spec** for solving the problem, NOT to explain existing documents. These MUST be `generate`, not `explain`.

⚠️ **Blind Spot**: Existing documents from a **different tier** do NOT make this `refactor`. Observe which tier the directive targets:

- Frontend directive + only `api-contract-*.md`/`be-system-*.md` exist → `generate` (no frontend docs to refactor)
- Backend directive + only `fe-system-*.md` exists → `generate` (no backend docs to refactor)
- Directive explicitly asks to modify an existing document by name → `refactor`

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## STEP 3: Ambiguous Directive Fallback (workType only)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Apply ONLY when Step 1 cannot determine workType** (directive has no clear scope indication):

{{#if hasUiDocs}}
{{#unless hasSystemDocs}}

- UI docs exist, system docs missing → `"system-design"` + `"generate"` (next natural phase)
{{/unless}}
{{/if}}

{{#unless hasUiDocs}}
{{#if hasReferences}}

- UI docs missing, reference images available → `"ui-design"` + `"generate"` (visual materials ready)
{{else}}
- UI docs missing, no references → `"system-design"` + `"generate"` (cannot do UI without visuals)
{{/if}}
{{/unless}}

{{#if hasUiDocs}}
{{#if hasSystemDocs}}

- All docs exist, directive is vague → `"system-design"` + `"generate"` (default)
{{/if}}
{{/if}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Document Status (for jobMode and error detection only)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{{#if hasUiDocs}}
UI Design Documents: exist
{{#if hasUiTokens}}- ui-tokens.json{{/if}}
{{#if hasUiAssets}}- ui-assets.json{{/if}}
{{#if hasUiSpec}}- ui-spec.json{{/if}}
{{else}}
UI Design Documents: not found
{{#if hasReferences}}- Reference images: available{{else}}- Reference images: not available{{/if}}
{{/if}}

{{#if hasSystemDocs}}
System Design Documents: exist
{{#each systemDesignFiles}}- {{this}}
{{/each}}
{{else}}
System Design Documents: not found
{{/if}}

{{#if hasAssets}}
Asset files: available
{{/if}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## STEP 4: Domain + Environment (system-design only)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Skip if workType is NOT system-design.**

### Observation Priority: Directive FIRST, then Source Documents

**domain**: Observe from directive first, then source documents:

- Directive mentions realtime physics, game-loop, or game engine mechanics → `game`
- Otherwise → `service` (default)

**environment**: Observe from directive first, then source documents:

- **Directive signal (primary)**: If directive explicitly names a tier or technology stack, use it as strong evidence for environment
- **Source document signal (supplementary)**: Observe project structure from document content
  - Browser-only app with no dedicated backend → `frontend`
  - API/server only with no frontend UI → `backend`
  - Both frontend and backend in the same project → `fullstack`

⚠️ **Blind Spot**: Do NOT ignore explicit technology or tier mentions in the directive. If directive says "백엔드 시스템 설계" or "Go API 서버" → `backend` is strongly implied. If directive says "프론트엔드 설계" or "React 앱" → `frontend` is strongly implied.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Inputs

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### Directive

```
{{directive}}
```

{{#each documents}}

### {{label}}

The following source document may be truncated for budget. Use it as a supplementary signal for domain/environment classification. The directive above is the primary signal.

```
{{{content}}}
```

{{/each}}

{{#if referencesList}}

### Reference Images

```
{{referencesList}}
```

{{/if}}

{{#if assetsList}}

### Assets

```
{{assetsList}}
```

{{/if}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Output Format

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Respond with ONLY JSON wrapped in `<detect>` tags. No markdown fences.

### spec

{ "workType": "spec", "workTypeReasoning": "1-2 sentences: what specific feature/task scope was identified", "jobMode": "generate" | "refactor", "jobModeReasoning": "1-2 sentences" }

### ui-design

{ "workType": "ui-design", "workTypeReasoning": "1-2 sentences", "jobMode": "generate" | "refactor" | "explain", "jobModeReasoning": "1-2 sentences" }

### system-design

{ "workType": "system-design", "workTypeReasoning": "1-2 sentences", "jobMode": "generate" | "refactor" | "explain", "jobModeReasoning": "1-2 sentences", "domain": "game" | "service", "domainReasoning": "1-2 sentences", "environment": "frontend" | "backend" | "fullstack", "environmentReasoning": "1-2 sentences" }

### clarify (ambiguous between spec and system-design)

{ "workType": "clarify", "workTypeReasoning": "1-2 sentences: why you cannot confidently determine spec vs system-design" }

### error (modification requested but documents missing)

{ "workType": "error", "workTypeReasoning": "1-2 sentences", "errorMessage": "human-readable error message", "errorType": "missing_documents" }

### error (PRD analysis — out of design job scope)

{ "workType": "error", "workTypeReasoning": "1-2 sentences: directive targets PRD content, not design artifacts", "errorMessage": "human-readable message explaining PRD analysis belongs to the plan job", "errorType": "out_of_scope" }