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

| workType | Scope Criterion | Output |
|----------|----------------|--------|
| **spec** | Directive scopes to **one feature, task, or bounded change unit** | `spec-{slug}.md` |
| **ui-design** | Directive scopes to **visual appearance, interface layout, or design tokens** | `ui-*.json` |
| **system-design** | Directive scopes to **whole-system architecture or multi-component structure** | `system-design.md`, `api-contract.md`, `*-system-design.md` |
| **clarify** | Scope is **genuinely ambiguous** between spec and system-design | Asks user to choose |
| **error** | Modification requested but **target documents do not exist** | Error message |

### Constraint: Scope Determines workType, NOT Document Existence

⚠️ **CRITICAL**: The presence or absence of existing documents (system-design.md, api-contract.md, be-system-design.md, etc.) MUST NOT influence your workType decision. Document existence only affects `jobMode` (Step 2).

- Existing system docs present + feature-scoped directive → **still spec** (NOT system-design refactor)
- Existing system docs absent + architecture-scoped directive → **still system-design**

### Principle: Feature Scope vs Architecture Scope

**Observe what the directive names:**

| Observation | workType |
|-------------|----------|
| Directive names a **single feature, endpoint, flow, or change** | **spec** |
| Directive references **existing spec-*.md** by name | **spec** |
| Directive references **visual design, screens, or appearance** | **ui-design** |
| Directive references **overall architecture, system structure, or multiple components** | **system-design** |
| Directive explicitly uses **"시스템 디자인"**, **"아키텍처"**, **"system design"** | **system-design** |

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

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## STEP 2: Determine jobMode
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### Observation Protocol

Observe the **intent** of the directive with respect to existing documents:

| Observation | jobMode |
|-------------|---------|
| Directive asks to **analyze, explain, or describe** existing content | `explain` |
| Directive asks to **modify, update, or improve** a specific part of existing documents | `refactor` |
| Directive asks to **create new** content | `generate` |

**Constraint**: `explain` and `refactor` require that **documents for the same tier** exist. If they do not exist, fall back to `generate`.

⚠️ **Blind Spot**: Existing documents from a **different tier** do NOT make this `refactor`. Observe which tier the directive targets:
- Frontend directive + only `api-contract.md`/`be-system-design.md` exist → `generate` (no frontend docs to refactor)
- Backend directive + only `fe-system-design.md` exists → `generate` (no backend docs to refactor)
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

**domain**: Observe whether the project involves realtime physics/game-loop mechanics (`game`) or standard request-response services (`service`). Default: `service`.

**environment**: Observe the project structure from PRD/directive:
- Browser-only app with no dedicated backend → `frontend`
- API/server only with no frontend UI → `backend`
- Both frontend and backend in the same project → `fullstack`

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## Inputs
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### Directive

```
{{directive}}
```

{{#if prdSpec}}
### PRD

```
{{prdSpec}}
```
{{/if}}

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

<detect>
{
  "workType": "spec",
  "workTypeReasoning": "1-2 sentences: what specific feature/task scope was identified",
  "jobMode": "generate" | "refactor",
  "jobModeReasoning": "1-2 sentences"
}
</detect>

### ui-design

<detect>
{
  "workType": "ui-design",
  "workTypeReasoning": "1-2 sentences",
  "jobMode": "generate" | "refactor" | "explain",
  "jobModeReasoning": "1-2 sentences"
}
</detect>

### system-design

<detect>
{
  "workType": "system-design",
  "workTypeReasoning": "1-2 sentences",
  "jobMode": "generate" | "refactor" | "explain",
  "jobModeReasoning": "1-2 sentences",
  "domain": "game" | "service",
  "domainReasoning": "1-2 sentences",
  "environment": "frontend" | "backend" | "fullstack",
  "environmentReasoning": "1-2 sentences"
}
</detect>

### clarify (ambiguous between spec and system-design)

<detect>
{
  "workType": "clarify",
  "workTypeReasoning": "1-2 sentences: why you cannot confidently determine spec vs system-design"
}
</detect>

### error (modification requested but documents missing)

<detect>
{
  "workType": "error",
  "workTypeReasoning": "1-2 sentences",
  "errorMessage": "human-readable error message",
  "errorType": "missing_documents",
  "suggestedAction": "what the user should do instead"
}
</detect>
